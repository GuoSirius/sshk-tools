/**
 * 宿主能力调用（跨版本安全 · 应用级共享能力）。
 *
 * 背景：Electron 的 preload 只在【窗口创建时】注入一次 contextBridge 快照。
 * dev 下渲染层 HMR 会即时更新界面，但不会重放 preload —— 于是会出现
 * 「新按钮 + 旧宿主」：直接调新增的 window.api.xxx 会抛
 * "window.api.xxx is not a function"。打包版热更 UI / 旧进程同理。
 *
 * 三层策略（任何工具调用宿主新增能力都走这里，不要裸调）：
 *   1) 具名方法存在 → 直接调用（正常路径）
 *   2) 具名方法缺失 → 回退通用 ipc.invoke(channel, ...)：该通道是宿主的长期稳定
 *      能力，旧快照里也有；只要主进程已注册对应 handler，功能仍可用
 *   3) 通用通道也不可用 / 调用失败 → 抛出可操作提示，不再把内部
 *      "is not a function" / "No handler registered" 丢给用户
 *
 * 另提供 hostApiMissing() 供页面加载时自检并显示提示条 + 一键重载窗口。
 * 本模块不依赖 @sshk/shared / DOM 框架，纯函数，便于任何工具复用。
 */
type AnyFn = (...args: unknown[]) => unknown
type ApiBag = Record<string, Record<string, unknown> | undefined>

export interface HostApiSpec {
  /** window.api 上的命名空间，如 upload / app */
  group: string
  /** 命名空间下的方法名，如 test / getSecret */
  method: string
  /** 主进程注册的 IPC 通道（唯一真相源为 @sshk/shared 的 IPC_CHANNELS） */
  channel: string
  /** 面向用户的中文能力名，用于自检提示 */
  label: string
}

/** 版本漂移时的统一话术：先重载窗口（会重新注入 preload），不行再完全重启应用 */
export const HOST_API_STALE_HINT =
  '宿主能力尚未就绪：界面已更新，但当前窗口仍在使用启动时的旧桥接。请点页面顶部「重载窗口」；若仍失败，请完全退出应用并重新启动（开发模式重启 pnpm dev）。'

function apiBag(): ApiBag {
  return (globalThis as unknown as { api?: ApiBag }).api ?? {}
}

/** 具名方法是否可用（旧宿主快照会返回 false） */
export function hasHostApi(spec: HostApiSpec): boolean {
  return typeof apiBag()[spec.group]?.[spec.method] === 'function'
}

/** 批量自检：返回缺失的能力名，空数组表示全部就绪 */
export function hostApiMissing(specs: readonly HostApiSpec[]): string[] {
  return specs.filter((spec) => !hasHostApi(spec)).map((spec) => spec.label)
}

/**
 * 调用宿主能力。具名方法优先，缺失时经通用 ipc 通道兜底。
 * 任何一层失败都统一包装成带操作指引的错误，避免裸 TypeError 暴露给用户。
 */
export async function callHostApi<T>(spec: HostApiSpec, ...args: unknown[]): Promise<T> {
  const named = apiBag()[spec.group]?.[spec.method]
  if (typeof named === 'function') {
    return (await (named as AnyFn)(...args)) as T
  }

  const generic = apiBag().ipc?.invoke
  if (typeof generic === 'function') {
    try {
      return (await (generic as AnyFn)(spec.channel, ...args)) as T
    } catch (err) {
      throw new Error(`${HOST_API_STALE_HINT}（${(err as Error).message}）`)
    }
  }
  throw new Error(HOST_API_STALE_HINT)
}

/**
 * 重载当前窗口：Electron 会在页面重新加载时重新执行 preload，
 * 因此这是让新宿主能力生效最轻量的操作，无需退出应用。
 */
export async function reloadHostWindow(force = true): Promise<void> {
  const reload = apiBag().app?.reload
  if (typeof reload === 'function') {
    await (reload as AnyFn)(force)
    return
  }
  if (typeof globalThis.location?.reload === 'function') globalThis.location.reload()
}
