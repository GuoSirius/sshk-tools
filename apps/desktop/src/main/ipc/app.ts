import { app, shell } from 'electron'
import { AppError, IPC_CHANNELS } from '@sshk/shared'
import { devtoolsKeyMatches, isDevOpAuthorized, markDevOpAuthorized, type DevKeyOperation } from '../dev-access'
import { handleOk } from '../ipc-wrap'
import { markQuitting } from '../window'
import type { IpcContext } from './context'

/** 应用自身（P3-1 registerIpc 拆分：appVersion/Runtime/OpenDataDir/Reload/ConfirmClose/DevTools/VerifyKey） */
export function registerAppIpc(ctx: IpcContext): void {
  const cfg = ctx.services.config

  handleOk(IPC_CHANNELS.appVersion, () => app.getVersion())
  // 关于页运行环境信息（__APP_COMMIT__ 由 electron-vite define 注入，打包/dev 一致）
  handleOk(IPC_CHANNELS.appRuntime, () => ({
    version: app.getVersion(),
    commit: String(__APP_COMMIT__ ?? 'dev'),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  }))
  handleOk(IPC_CHANNELS.appOpenDataDir, () => shell.openPath(app.getPath('userData')))
  handleOk(IPC_CHANNELS.appReload, (_event, force?: boolean) => {
    const wc = ctx.getMainWindow()?.webContents
    if (!wc) return false
    if (force) wc.reloadIgnoringCache()
    else wc.reload()
    return true
  })
  // 渲染层确认关闭后回到主进程：置 quitting 并真正退出（close 链路见 window.ts）
  handleOk(IPC_CHANNELS.appConfirmClose, () => {
    markQuitting()
    app.quit()
    return true
  })
  // 开发者工具：会话内按操作缓存密钥（项9）——有效期内再开不重输；与「开发者模式」各自独立。
  // 打包版密钥优先级：settings.json 显式哈希 > env SSHK_APP_DEVTOOLS_KEY > 内置 sshk-tools@888
  handleOk(IPC_CHANNELS.appToggleDevTools, (_event, key?: string) => {
    if (ctx.isDev) { ctx.getMainWindow()?.webContents.toggleDevTools(); return true }
    if (!isDevOpAuthorized('devtools')) {
      if (!devtoolsKeyMatches(String(cfg.get('app.devtoolsKeyHash') ?? ''), String(key ?? ''))) {
        throw new AppError('访问密钥不正确，请核对后重试（区分大小写、符号须半角）', 'permission')
      }
      markDevOpAuthorized('devtools')
    }
    ctx.getMainWindow()?.webContents.toggleDevTools()
    return true
  })
  // 开发者模式等敏感开关：只校验口令不打开 DevTools；按操作独立缓存，互不复用
  handleOk(IPC_CHANNELS.appVerifyDevtoolsKey, (_event, key?: string, operation?: DevKeyOperation) => {
    const op: DevKeyOperation = operation === 'devtools' ? 'devtools' : 'developerMode'
    if (isDevOpAuthorized(op)) return true
    if (ctx.isDev) { markDevOpAuthorized(op); return true }
    if (!devtoolsKeyMatches(String(cfg.get('app.devtoolsKeyHash') ?? ''), String(key ?? ''))) {
      throw new AppError('访问密钥不正确，请核对后重试（区分大小写、符号须半角）', 'permission')
    }
    markDevOpAuthorized(op)
    return true
  })
}
