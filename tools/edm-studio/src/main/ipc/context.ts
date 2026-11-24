import { app } from 'electron'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError, IPC_CHANNELS, TOOL_IDS, SSHK_DEV, isDevFeaturesEnabled } from '@sshk/shared'
import type { Repository } from '@sshk/repository'

/**
 * EDM Studio IPC 上下文（P6-5 自 ipc.ts 拆分，#156 · B37-F7）：
 * EdmIpcDeps + 各域 action 共用的口径工具（payload 取值 / 路径限定 / 系统门控 / 只读断言）。
 * H1 契约保持现状：工具 main 不走 handleOk/wrapIpcHandler，单通道 edm:api 白名单分发，handler 永不 reject 由宿主包装层兜底。
 */
export interface EdmIpcDeps {
  repository: Repository
  outputRoot: string
  /** 应用配置（只读）；系统内容编辑门控用（R12：!isPackaged || app.developerMode） */
  config?: { get(key: string): unknown }
}

export type Payload = Record<string, unknown>
/** 单个 action 处理器签名（data 为 edm:api 通道的 data 段） */
export type ActionHandler = (data: Payload) => Promise<unknown>

export interface EdmIpcContext {
  repo: Repository
  outputRoot: string
  config?: { get(key: string): unknown }
  str(p: Payload, key: string): string
  obj(p: Payload, key: string): Payload
  /** 系统内容只读（R8）：origin='system' 的实体禁止在 NeDB 侧编辑/删除/派生新版本，改 = saveAsNew 派生副本 */
  assertMutable(name: Parameters<Repository['get']>[0], id: string): Promise<void>
  // ── 系统内容编辑门控（R12）：devFeatures 唯一口径（D-2 · P0-2）：dev 恒全权；打包版需 developerMode。main 端校验为安全边界 ──
  //    2026-11-24 收窄：门控只拦「设计」写入（meta/njk/css），sample.yaml（示例数据）放开走覆盖层，见 content.ts + sample-overlay.ts
  systemEditable(): boolean
  assertSystemEditable(): void
  /** 限制在指定根内（越权即拒）；返回绝对路径 */
  confine(root: string, file: string): string
  /** 系统内容根（R6 双模解析，见 resolveEdmRoot 实现） */
  resolveEdmRoot(): string
  /** R24 内容根解析：system=系统文件根（assets/edm）；custom=自定义文件根（userData/custom-edm） */
  resolveContentRoot(source: string): string
  /** 示例数据覆盖层根（2026-11-24：只读系统内容的 sample.yaml 用户改动落 userData，设计文件不进这里） */
  resolveOverrideRoot(): string
  /** 相对路径规范化（POSIX 分隔，渲染层统一用 /） */
  relOf(file: string): string
}

/** 系统内容文件允许的扩展名（白名单防误写垃圾文件；css 文件名随意） */
export const SYSTEM_FILE_EXTS = new Set(['.css', '.yaml', '.yml', '.njk'])

/**
 * 系统内容根（R6 双模解析）：
 * - 打包态：随包发布于 resources/edm-studio/assets/edm（R11：electron-builder extraResources）。
 * - 开发态：apps/desktop 在仓库根下两级，工具源码位于 <repo>/tools/edm-studio/assets/edm。
 * 外部安装包（plugin.source='external'）模式依赖 runtime-installer 解压落点，待该模块落地后
 * 再按 manifest.plugin.source 切换 baseDir，此处预留 source 入参。
 */
function resolveEdmRoot(_source: string = 'builtin', _baseDir?: string): string {
  // 判据唯一化（P0-1）：打包态 SSHK_DEV=false → resourcesPath；dev/preview（源码仓库运行）→ 仓库工具目录
  if (!SSHK_DEV) {
    return path.join(process.resourcesPath, TOOL_IDS.edmStudio, 'assets', 'edm')
  }
  return path.resolve(app.getAppPath(), '../../tools/edm-studio/assets/edm')
}

export function createEdmIpcContext(deps: EdmIpcDeps): EdmIpcContext {
  const repo = deps.repository

  function str(p: Payload, key: string): string {
    return String(p[key] ?? '')
  }
  function obj(p: Payload, key: string): Payload {
    return (p[key] as Payload) ?? {}
  }
  async function assertMutable(name: Parameters<Repository['get']>[0], id: string): Promise<void> {
    const doc = await repo.get(name, id)
    if (doc && (doc as { origin?: string }).origin === 'system') throw new AppError('系统内容只读：请用「另存为」派生自定义副本')
  }
  function systemEditable(): boolean {
    return isDevFeaturesEnabled(SSHK_DEV, deps.config?.get('app.developerMode') === true)
  }
  function assertSystemEditable(): void {
    if (!systemEditable()) throw new AppError('系统内容在当前模式下只读（打包版需开启开发者模式）')
  }
  function confine(root: string, file: string): string {
    const abs = path.resolve(root, file)
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new AppError('越权路径', 'permission')
    return abs
  }
  function resolveContentRoot(source: string): string {
    if (source === 'custom') return path.join(app.getPath('userData'), 'custom-edm')
    return resolveEdmRoot()
  }
  function resolveOverrideRoot(): string {
    return path.join(app.getPath('userData'), 'system-edm-override')
  }
  function relOf(file: string): string {
    return path.resolve(resolveEdmRoot(), file).split(path.sep).join('/')
  }

  return {
    repo, outputRoot: deps.outputRoot, config: deps.config,
    str, obj, assertMutable, systemEditable, assertSystemEditable, confine,
    resolveEdmRoot, resolveContentRoot, resolveOverrideRoot, relOf,
  }
}

/** IpcMainInvokeEvent 透传（聚合入口的 ipc.handle 形参类型） */
export type EdmInvokeEvent = IpcMainInvokeEvent

/** IPC 通道名（聚合入口 ipc.handle 用；保持原单通道白名单分发契约） */
export const EDM_API_CHANNEL = IPC_CHANNELS.edmApi
