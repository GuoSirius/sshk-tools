import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { AppError, IPC_CHANNELS } from '@sshk/shared'
import { collectToolHealth } from '../health'
import { handleOk } from '../ipc-wrap'
import { logger } from '../logger'
import type { IpcContext } from './context'

/** OS 能力 + 日志 + 工具健康度（P3-1 registerIpc 拆分：os*、logFrontend/logs、toolsHealth） */
export function registerOsIpc(ctx: IpcContext): void {
  handleOk(IPC_CHANNELS.osPickFile, async (_event, opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? ctx.getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts?.filters,
      ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    })
    return result.canceled ? [] : result.filePaths
  })
  handleOk(IPC_CHANNELS.osPickSave, async (_event, opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? ctx.getMainWindow()
    // defaultPath 优先作为"目录/起始路径"，与 fileName 组合成默认完整路径；仅给 fileName 时退回原行为
    const base = opts?.defaultPath
      ? (opts.fileName ? join(opts.defaultPath, opts.fileName) : opts.defaultPath)
      : opts?.fileName
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: base,
      filters: opts?.extensions ? [{ name: '文件', extensions: opts.extensions }] : undefined,
    })
    return result.canceled ? '' : (result.filePath ?? '')
  })
  // 图片应用内预览：仅图片扩展名 + 10MB 上限，返回 data URI
  handleOk(IPC_CHANNELS.osReadDataUri, (_event, file: string) => {
    const target = String(file ?? '')
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(target)) throw new AppError('仅支持图片文件预览', 'io')
    const buf = readFileSync(target)
    if (buf.byteLength > 10 * 1024 * 1024) throw new AppError('图片超过 10MB，无法预览')
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    }
    const mime = mimeMap[/\.[a-z]+$/i.exec(target.toLowerCase())?.[0] ?? ''] ?? 'application/octet-stream'
    return 'data:' + mime + ';base64,' + buf.toString('base64')
  })
  // 文本写盘：路径必须来自用户经保存对话框选择（导出 HTML 等）
  handleOk(IPC_CHANNELS.osWriteText, (_event, path: string, content: string) => {
    const target = String(path || '')
    if (!target) throw new AppError('缺少写入路径', 'io')
    writeFileSync(target, String(content ?? ''), 'utf8')
    return true
  })
  // 二进制写盘（base64 → 文件）：下载 PNG 等场景；路径同样必须来自用户保存对话框
  handleOk(IPC_CHANNELS.osWriteBinary, (_event, path: string, base64: string) => {
    const target = String(path || '')
    if (!target) throw new AppError('缺少写入路径', 'io')
    if (!/^[A-Za-z0-9+/=]+$/.test(String(base64 ?? ''))) throw new AppError('内容必须是合法 base64')
    writeFileSync(target, Buffer.from(String(base64), 'base64'))
    return true
  })
  handleOk(IPC_CHANNELS.osPickDir, async (_event, opts?: { defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? ctx.getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    })
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })
  handleOk(IPC_CHANNELS.osClipboardWrite, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  handleOk(IPC_CHANNELS.osShellOpen, async (_event, target: string) => {
    const t = String(target ?? '')
    if (/^https?:\/\//i.test(t)) return void shell.openExternal(t)
    if (await shell.openPath(t)) throw new AppError(`拒绝打开: ${t}`, 'permission')
    return true
  })
  handleOk(IPC_CHANNELS.osIsElevated, () => ctx.isElevated())

  // ── H3 日志落盘：渲染层日志汇入 + 日志目录信息 / 清空 ──
  ipcMain.on(IPC_CHANNELS.logFrontend, (_event, payload: { level?: string; scope?: string; msg?: string; detail?: unknown }) => {
    const level = (['debug', 'info', 'warn', 'error'].includes(String(payload?.level)) ? payload!.level : 'info') as 'debug' | 'info' | 'warn' | 'error'
    logger[level](String(payload?.scope ?? 'renderer').slice(0, 40), String(payload?.msg ?? '').slice(0, 4000), payload?.detail)
  })
  handleOk(IPC_CHANNELS.logDirGet, () => logger.describe())
  handleOk(IPC_CHANNELS.logClean, () => ({ removed: logger.clean() }))

  // ── N2 工具健康度面板：目录裁决 + 插件状态 + 日志 error 检索 ──
  handleOk(IPC_CHANNELS.toolsHealth, () => collectToolHealth(ctx.buildCatalog(), ctx.allManifests()))
}
