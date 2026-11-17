/**
 * Windows UIPI 拖放放行（用户 2026-11-17 验收项：管理员模式依然无法拖入文件）。
 *
 * 根因：应用清单 requestedExecutionLevel=requireAdministrator（始终以管理员/HIL 运行），
 * 而资源管理器是普通权限（MIL）。UIPI 默认阻止低完整性进程向高完整性窗口投递消息。
 * Chromium 的文件拖放走 OLE（RegisterDragDrop/DoDragDrop），消息面远不止
 * WM_DROPFILES/WM_COPYGLOBALDATA —— 拖放循环期间源进程会向目标窗口投递鼠标/键盘消息，
 * 这些同样被 UIPI 拦截，只放行两条会"还是拖不进"。本版按 Qt/Win32 社区成熟清单
 * 放行完整消息集（微软官方也确认 ChangeWindowMessageFilterEx 是唯一 API 级解法，
 * 只是安全上不推荐——本应用强制管理员运行，接受该取舍）。
 *
 * 健壮性（用户验收项2）：koffi 可用性全链路打日志——加载失败 / 句柄异常 / 调用失败
 * 都 console.warn 具体原因，不再静默降级导致无法诊断。
 */
import { BrowserWindow } from 'electron'

// Win32 消息：OLE 拖放完整集（WM_DROPFILES/WM_COPYGLOBALDATA 为经典拖放；鼠标/键盘为 OLE 拖放循环投递）
const DROP_MESSAGES: Array<[number, string]> = [
  [0x0233, 'WM_DROPFILES'],
  [0x0049, 'WM_COPYGLOBALDATA'],
  [0x0200, 'WM_MOUSEMOVE'],
  [0x0201, 'WM_LBUTTONDOWN'],
  [0x0202, 'WM_LBUTTONUP'],
  [0x0203, 'WM_LBUTTONDBLCLK'],
  [0x0204, 'WM_RBUTTONDOWN'],
  [0x0205, 'WM_RBUTTONUP'],
  [0x0207, 'WM_MBUTTONDOWN'],
  [0x0208, 'WM_MBUTTONUP'],
  [0x0100, 'WM_KEYDOWN'],
  [0x0101, 'WM_KEYUP'],
  [0x0102, 'WM_CHAR'],
  [0x0104, 'WM_SYSKEYDOWN'],
  [0x0105, 'WM_SYSKEYUP'],
]
const MSGFLT_ALLOW = 1

/** 已放行过的窗口句柄，避免重复调用 */
const allowed = new WeakSet<BrowserWindow>()

/**
 * 对指定窗口放行 UIPI 拖放消息。仅 Windows 生效；任何失败都 warn 具体原因（不静默）。
 * 需在窗口句柄可用后调用（ready-to-show 后）。
 */
export async function allowWindowDrop(win: BrowserWindow | null): Promise<void> {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || allowed.has(win)) return
  let hwnd: bigint
  try {
    const handle = win.getNativeWindowHandle()
    hwnd = handle.length === 8 ? handle.readBigInt64LE(0) : BigInt(handle.readUInt32LE(0))
    if (!hwnd) {
      console.warn('[sshk] UIPI 放行跳过：窗口句柄为 0（窗口尚未就绪）')
      return
    }
  } catch (err) {
    console.warn('[sshk] UIPI 放行失败：无法取窗口句柄', err)
    return
  }

  // 只用到 load/func 两个方法，用最小结构类型避免 koffi 各版本导出声明差异（3.x default 导出类型缺内部字段）
  type KoffiLike = {
    load(name: string): { func(sig: string): (...args: unknown[]) => unknown }
  }
  const fromDefault = (m: unknown): KoffiLike | null => (m && typeof m === 'object' ? ((m as { default?: unknown }).default ?? m) as unknown as KoffiLike : null)
  let koffi: KoffiLike | null = null
  // 动态 import：koffi 是可选原生依赖，缺失时不阻断应用（打包环境未带 native 也能启动）
  try {
    koffi = fromDefault(await import(/* @vite-ignore */ 'koffi'))
  } catch (err) {
    // dev 下走上面（node_modules）；打包版 koffi 放 extraResources，从 resourcesPath 兜底加载
    try {
      const { pathToFileURL } = await import('node:url')
      const { join } = await import('node:path')
      const { existsSync } = await import('node:fs')
      const candidate = join(process.resourcesPath, 'koffi', 'index.js')
      if (existsSync(candidate)) koffi = fromDefault(await import(/* @vite-ignore */ pathToFileURL(candidate).href))
    } catch (err2) {
      console.warn('[sshk] UIPI 放行不可用：koffi 加载失败（管理员拖拽不生效，普通权限不受影响）', err, err2)
      return
    }
    if (!koffi) {
      console.warn(`[sshk] UIPI 放行不可用：koffi 未随包分发（${process.resourcesPath}/koffi 缺失）`)
      return
    }
  }
  if (!koffi) {
    console.warn('[sshk] UIPI 放行不可用：koffi 模块导出为空')
    return
  }

  try {
    const user32 = koffi.load('user32.dll')
    const change = user32.func('bool ChangeWindowMessageFilterEx(void* hwnd, uint msg, uint action, void* pfnChangeFilter)')
    const failed: string[] = []
    for (const [msg, name] of DROP_MESSAGES) {
      // void* 参数直接传句柄数值（koffi 接受 bigint/number 作为指针地址，不要用 koffi.pointer——那是类型构造）
      try {
        const ok = change(hwnd, msg, MSGFLT_ALLOW, null)
        if (!ok) failed.push(name)
      } catch {
        failed.push(name)
      }
    }
    allowed.add(win)
    if (failed.length) console.warn(`[sshk] UIPI 放行部分失败（hwnd=${hwnd}）：${failed.join('、')}——管理员拖拽可能仍受限`)
    else console.info(`[sshk] UIPI 放行完成（hwnd=${hwnd}，${DROP_MESSAGES.length} 条消息）：管理员模式拖拽应已可用`)
  } catch (err) {
    console.warn('[sshk] UIPI 放行失败：user32 调用异常', err)
  }
}
