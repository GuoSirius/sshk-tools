import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, Tray, Menu } from 'electron'
// electron-updater 是 CJS 模块：ESM 主进程必须默认导入再解构（具名导入运行时报错）
import electronUpdaterPkg from 'electron-updater'
const { autoUpdater } = electronUpdaterPkg
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { IPC_CHANNELS } from '@sshk/shared'
import { chat, healthCheck, listModels, type LlmProvider } from '@sshk/llm-gateway'
import { registerBadgeIpc } from '@sshk/badge-studio/main'
import { registerEdmIpc } from '@sshk/edm-studio/main'
import { setupServices, type AppServices } from './services'

const here = path.dirname(fileURLToPath(import.meta.url))
const rendererHtml = path.join(here, '../renderer/index.html')
const preloadScript = path.join(here, '../preload/index.cjs')
const iconFile = path.join(here, '../../build/icon.png')
const trayIconFile = path.join(here, '../../build/tray.png')

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let services: AppServices | null = null

function createWindow(): void {
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(rendererHtml)
}

function createTray(): void {
  try {
    tray = new Tray(trayIconFile)
    tray.setToolTip('sshk-tools')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主界面', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ]))
    tray.on('click', () => mainWindow?.show())
  } catch (err) {
    console.warn('[sshk] 托盘图标暂不可用：', err)
  }
}

function readProvider(_event: unknown, provider: LlmProvider): LlmProvider {
  // 最小校验：baseURL 必须 http(s)，防 file:/ftp: 等协议滥用
  if (!/^https?:\/\//i.test(provider?.baseURL ?? '')) {
    throw new Error('baseURL 必须是 http(s) 地址')
  }
  return provider
}

function registerIpc(): void {
  const cfg = services!.config

  // ── 配置 ──
  ipcMain.handle(IPC_CHANNELS.configGet, (_event, key: string) => cfg.get(key) ?? null)
  ipcMain.handle(IPC_CHANNELS.configSet, (_event, key: string, value: unknown) => {
    cfg.set(key, value)
    return true
  })
  cfg.onChanged((namespace, key) => {
    if (namespace === 'app' && key === 'themeMode') {
      const mode = cfg.get('app.themeMode')
      nativeTheme.themeSource = mode === 'system' ? 'system' : mode === 'light' ? 'light' : 'dark'
    }
    mainWindow?.webContents.send(IPC_CHANNELS.configChanged, { namespace, key })
  })
  // 启动时同步一次主题
  const themeMode = cfg.get('app.themeMode')
  nativeTheme.themeSource = themeMode === 'system' ? 'system' : themeMode === 'light' ? 'light' : 'dark'

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.appOpenDataDir, () => shell.openPath(app.getPath('userData')))

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.themeSystemChanged)
  })

  // ── 更新 ──
  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    if (isDev) return { dev: true }
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version ?? null
    return { updateAvailable: Boolean(version && version !== app.getVersion()), version }
  })
  ipcMain.handle(IPC_CHANNELS.updateQuitAndInstall, () => {
    autoUpdater.quitAndInstall()
  })

  // ── LLM（M7）：apiKey 由主进程从 secrets.bin 注入，渲染层永不接触明文 ──
  ipcMain.handle(IPC_CHANNELS.llmChat, (_event, provider: LlmProvider, messages: unknown, options?: { onDelta?: boolean }) => {
    const p = readProvider(_event, provider)
    const apiKey = services!.getApiKey(p._id)
    if (options?.onDelta && mainWindow) {
      return chat({
        provider: p,
        apiKey,
        messages: messages as never,
        onDelta: (delta) => mainWindow?.webContents.send(IPC_CHANNELS.llmChat, { delta }),
      })
    }
    return chat({ provider: p, apiKey, messages: messages as never })
  })
  ipcMain.handle(IPC_CHANNELS.llmListModels, (_event, provider: LlmProvider) =>
    listModels(readProvider(_event, provider), services!.getApiKey(provider?._id ?? '')))
  ipcMain.handle(IPC_CHANNELS.llmHealthCheck, (_event, provider: LlmProvider) =>
    healthCheck(readProvider(_event, provider), services!.getApiKey(provider?._id ?? '')))
  ipcMain.handle(IPC_CHANNELS.llmSetApiKey, (_event, providerId: string, apiKey: string) => {
    services!.setApiKey(providerId, String(apiKey ?? ''))
    return true
  })

  // ── Badge Studio（M6）：原 HTML 只读、副本打标、覆盖式海报产物 ──
  registerBadgeIpc(ipcMain, {
    repository: services!.repository,
    outputRoot: services!.outputRoot,
  })

  // ── EDM Studio（M4/M5）：品牌树、模板片段、三阶段渲染、邮件与分享 ──
  registerEdmIpc(ipcMain, {
    repository: services!.repository,
    outputRoot: services!.outputRoot,
  })

  // ── OS 能力（M7）：文件选择 / 剪贴板 / shell 白名单 ──
  ipcMain.handle(IPC_CHANNELS.osPickFile, async (_event, opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts?.filters,
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC_CHANNELS.osPickDir, async (_event) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })
  ipcMain.handle(IPC_CHANNELS.osClipboardWrite, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  // shell 白名单：只允许 https/http 链接与已存在文件
  ipcMain.handle(IPC_CHANNELS.osShellOpen, async (_event, target: string) => {
    const t = String(target ?? '')
    if (/^https?:\/\//i.test(t)) return void shell.openExternal(t)
    if (await shell.openPath(t)) throw new Error(`拒绝打开: ${t}`)
    return true
  })
}

function setupAutoUpdate(): void {
  if (isDev) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
    console.warn('[sshk] 自动更新检查失败：', err)
  })
}

void app.whenReady().then(() => {
  services = setupServices()
  registerIpc()
  createTray()
  createWindow()
  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
