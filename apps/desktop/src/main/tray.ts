import { Menu, Tray } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getMainWindow } from './window'

const here = path.dirname(fileURLToPath(import.meta.url))
const trayIconFile = path.join(here, '../../build/tray.png')

let tray: Tray | null = null

/** 托盘可用性（窗口 close 链路「最小化到托盘」回落判定用） */
export function getTray(): Tray | null {
  return tray
}

export function createTray(): void {
  try {
    tray = new Tray(trayIconFile)
    tray.setToolTip('sshk-tools')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主界面', click: () => getMainWindow()?.show() },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ]))
    tray.on('click', () => getMainWindow()?.show())
  } catch (err) {
    console.warn('[sshk] 托盘图标暂不可用：', err)
  }
}
