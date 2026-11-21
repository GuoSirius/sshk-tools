import { BrowserWindow, app } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getEnvBool, IPC_CHANNELS } from '@sshk/shared'
import { APP_RENDERER_URL } from './renderer-protocol'
import { allowWindowDrop } from './win32-drop'
import { logger } from './logger'

const here = path.dirname(fileURLToPath(import.meta.url))
const preloadScript = path.join(here, '../preload/index.cjs')
const iconFile = path.join(here, '../../build/icon.png')

/** 主窗口单例与退出标志（P3-1 自 index.ts 拆出；ipc 各域经 getMainWindow 取用） */
let mainWindow: BrowserWindow | null = null
/** 退出中标志：关闭确认通过后由渲染层回调置位，放行 before-quit / close 链路 */
let quitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 渲染层确认关闭后置位（ipc/app.ts appConfirmClose），放行 close 链路真正退出 */
export function markQuitting(): void {
  quitting = true
}

export interface WindowDeps {
  isDev: boolean
  /** 「关闭时最小化到托盘」判定（托盘可用 + 配置开启时点关闭=隐藏），宿主注入闭包 */
  hideToTrayOnClose: () => boolean
  /** before-quit 退出清理（沙箱回收/分享服务落盘/NeDB 压缩/传输队列落盘），宿主注入 */
  onBeforeQuit: () => void
}

/** 应用级生命周期事件（quit/close 链路一并随迁，P3-1）：启动时注册一次 */
export function wireWindowLifecycle(deps: Pick<WindowDeps, 'onBeforeQuit'>): void {
  app.on('before-quit', () => {
    quitting = true
    deps.onBeforeQuit()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

export function createWindow(deps: WindowDeps): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    icon: iconFile,
    show: false,
    backgroundColor: '#0B0E1C',
    webPreferences: {
      preload: preloadScript,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 浏览器式刷新：F5 / Ctrl(Cmd)+R 普通刷新，Shift 或 Ctrl+F5 忽略缓存
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const mod = input.control || input.meta
    if (key !== 'f5' && !(mod && key === 'r')) return
    event.preventDefault()
    const force = input.shift || (input.control && key === 'f5')
    if (force) mainWindow?.webContents.reloadIgnoringCache()
    else mainWindow?.webContents.reload()
  })

  // 渲染层 console 落盘（warn/error）：打包版排查「高亮丢失 / 弹框异常」等只有现场才有的问题时，
  // 不再依赖用户开 DevTools——日志文件里直接看渲染层报错（console-message Electron 35+ 为 detail 对象，兼容旧签名）
  mainWindow.webContents.on('console-message', (_event, ...args: unknown[]) => {
    const detail = args[0] as { level?: number | string; message?: string } | number
    const level = typeof detail === 'object' ? (detail.level ?? 0) : (detail as number)
    const message = typeof detail === 'object' ? (detail.message ?? '') : String(args[1] ?? '')
    if (typeof level === 'number' && level >= 2 && message) {
      logger.warn('renderer', `[console] ${message}`)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 管理员模式拖放放行：应用清单强制 requireAdministrator，UIPI 会拦截 Explorer 的拖入消息；
    // 对窗口放行 WM_DROPFILES / WM_COPYGLOBALDATA 后普通权限资源管理器可拖文件进窗口（非 Windows 静默跳过）
    void allowWindowDrop(mainWindow)
    if (deps.isDev) mainWindow?.webContents.openDevTools()
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // 关闭二次确认（防误触退出）：dev 不拦截；确认后置 quitting 放行 before-quit 链路。
  // 关闭动作通知渲染层，使用与主题色匹配的 ElMessageBox 确认（原生 dialog 与主题不搭）。
  mainWindow.on('close', (event) => {
    if (quitting || deps.isDev) return
    event.preventDefault()
    // 「关闭时最小化到托盘」开启（用户 2026-11-18）：点关闭 = 隐藏到托盘不退出；
    // 托盘不可用（设置里关了系统托盘/创建失败）时回落二次确认退出，避免窗口藏起来找不到
    if (deps.hideToTrayOnClose()) {
      mainWindow!.hide()
      return
    }
    // 交给渲染层弹出主题色确认框；用户确认后渲染层回调 app:confirmClose 真正退出
    mainWindow!.webContents.send(IPC_CHANNELS.appRequestClose)
  })

  // 加载通道统一（用户 2026-11-18 拍板）：打包版一律 app://（file:// 是 opaque origin，
  // fetch/CORS/Worker/动态 chunk 行为与 dev http 不一致，是 dev/打包差异的温床）；
  // dev 默认走 dev server http，SSHK_DEV_APP_PROTOCOL=1 时也走 app:// 便于同协议排查。
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const devUseApp = deps.isDev && getEnvBool('SSHK_DEV_APP_PROTOCOL', false)
  if (deps.isDev && devUrl && !devUseApp) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadURL(APP_RENDERER_URL)
}
