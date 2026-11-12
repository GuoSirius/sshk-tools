import { app, BrowserWindow, ipcMain, nativeTheme, shell, Tray, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DEFAULT_THEME_MODE, IPC_CHANNELS } from '@sshk/shared'

const here = path.dirname(fileURLToPath(import.meta.url))
const rendererHtml = path.join(here, '../renderer/index.html')
const preloadScript = path.join(here, '../preload/index.cjs')
const iconFile = path.join(here, '../../build/icon.png')
const trayIconFile = path.join(here, '../../build/tray.png')

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// M1 用内存态占位；M3 由 packages/config 接管并持久化到 userData
const settings = new Map<string, unknown>([['app.themeMode', DEFAULT_THEME_MODE]])

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

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.configGet, (_event, key: string) => settings.get(key) ?? null)

  ipcMain.handle(IPC_CHANNELS.configSet, (_event, key: string, value: unknown) => {
    settings.set(key, value)
    if (key === 'app.themeMode') {
      nativeTheme.themeSource = value === 'system' ? 'system' : value === 'light' ? 'light' : 'dark'
    }
    return true
  })

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.appOpenDataDir, () => shell.openPath(app.getPath('userData')))

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.themeSystemChanged)
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createTray()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
