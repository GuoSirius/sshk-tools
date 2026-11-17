/**
 * Windows UIPI 拖放放行（用户 2026-11-17 验收项：管理员模式依然无法拖入文件）。
 *
 * 根因：应用清单 requestedExecutionLevel=requireAdministrator（始终以管理员/HIL 运行），
 * 而 Windows 资源管理器是普通权限（MIL）。UIPI 默认阻止低完整性进程向高完整性窗口投递
 * WM_DROPFILES / WM_COPYGLOBALDATA 消息 → 拖放消息根本进不到 Electron 窗口，
 * 渲染层的 dragenter/dragover preventDefault 再正确也无济于事。
 *
 * 解法：主进程调 user32!ChangeWindowMessageFilterEx(hwnd, msg, MSGFLT_ALLOW, null)，
 * 对主窗口放行拖放相关消息。koffi 为 N-API 预编译模块（无需 electron 重编译），
 * 整个模块做可选加载：非 Windows / 模块缺失 / 调用失败全部静默降级，绝不影响启动。
 */
import { BrowserWindow } from 'electron'

// Win32 常量
const WM_DROPFILES = 0x0233
const WM_COPYGLOBALDATA = 0x0049 // 拖放时 shell 传递 CF_HDROP 用的私有消息
const MSGFLT_ALLOW = 1

/** 已放行过的窗口句柄，避免重复调用 */
const allowed = new WeakSet<BrowserWindow>()

/**
 * 对指定窗口放行 UIPI 拖放消息。仅 Windows 生效，任何失败静默忽略。
 * 需在窗口句柄可用后调用（did-finish-load 或 createWindow 末尾 getNativeWindowHandle 非空时）。
 */
export async function allowWindowDrop(win: BrowserWindow | null): Promise<void> {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || allowed.has(win)) return
  let hwnd: bigint
  try {
    const handle = win.getNativeWindowHandle()
    hwnd = handle.length === 8 ? handle.readBigInt64LE(0) : BigInt(handle.readUInt32LE(0))
    if (!hwnd) return
  } catch {
    return
  }

  // 只用到 load/func 两个方法，用最小结构类型避免 koffi 各版本导出声明差异（3.x default 导出类型缺内部字段）
  type KoffiLike = {
    load(name: string): { func(sig: string): (...args: unknown[]) => unknown }
  }
  let koffi: KoffiLike | null = null
  // 动态 import：koffi 是可选原生依赖，缺失时不阻断应用（打包环境未带 native 也能启动）
  try {
    koffi = ((await import(/* @vite-ignore */ 'koffi')).default ?? null) as unknown as KoffiLike | null
  } catch {
    // dev 下走上面（node_modules）；打包版 koffi 放 extraResources，从 resourcesPath 兜底加载
    try {
      const { pathToFileURL } = await import('node:url')
      const { join } = await import('node:path')
      const { existsSync } = await import('node:fs')
      const candidate = join(process.resourcesPath, 'koffi', 'index.js')
      if (existsSync(candidate)) koffi = ((await import(/* @vite-ignore */ pathToFileURL(candidate).href)).default ?? null) as unknown as KoffiLike | null
    } catch { /* 打包版未带 native：静默降级 */ }
  }
  if (!koffi) return

  try {
    const user32 = koffi.load('user32.dll')
    const change = user32.func('bool ChangeWindowMessageFilterEx(void* hwnd, uint msg, uint action, void* pfnChangeFilter)')
    for (const msg of [WM_DROPFILES, WM_COPYGLOBALDATA]) {
      // void* 参数直接传句柄数值（koffi 接受 bigint/number 作为指针地址，不要用 koffi.pointer——那是类型构造）
      try { change(hwnd, msg, MSGFLT_ALLOW, null) } catch { /* 单条失败不影响其它 */ }
    }
    allowed.add(win)
  } catch {
    /* user32 加载 / 调用失败：静默降级，保持原拖拽行为 */
  }
}
