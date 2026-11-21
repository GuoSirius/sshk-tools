import { nativeTheme } from 'electron'
import { AppError, IPC_CHANNELS } from '@sshk/shared'
import { isDevOpAuthorized } from '../dev-access'
import { handleOk } from '../ipc-wrap'
import { applyAutoInstallOnAppQuit } from '../updater'
import type { IpcContext } from './context'

/** 配置读写 + 主题跟随（P3-1 registerIpc 拆分：configGet/Set/onChanged + theme） */
export function registerConfigIpc(ctx: IpcContext): void {
  const cfg = ctx.services.config

  handleOk(IPC_CHANNELS.configGet, (_event, key: string) => cfg.get(key) ?? null)
  handleOk(IPC_CHANNELS.configSet, (_event, key: string, value: unknown) => {
    // 打包版「关 → 开」开发者模式必须先在本会话通过访问密钥校验；
    // 已是开启状态再保存、或关闭，都不需要口令，避免误伤正常配置保存。
    if (key === 'app.developerMode' && value === true && !ctx.isDev &&
        !Boolean(cfg.get('app.developerMode')) && !isDevOpAuthorized('developerMode')) {
      throw new AppError('开启开发者模式需要先通过访问密钥验证', 'permission')
    }
    cfg.set(key, value)
    return true
  })
  cfg.onChanged((namespace, key) => {
    if (namespace === 'app' && key === 'themeMode') {
      const mode = cfg.get('app.themeMode')
      nativeTheme.themeSource = mode === 'system' ? 'system' : mode === 'light' ? 'light' : 'dark'
    }
    // 开关改动即时生效，不必重启应用
    if (namespace === 'app' && key === 'autoInstallOnAppQuit') {
      applyAutoInstallOnAppQuit(Boolean(cfg.get('app.autoInstallOnAppQuit')))
    }
    ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.configChanged, { namespace, key })
  })
  const themeMode = cfg.get('app.themeMode')
  nativeTheme.themeSource = themeMode === 'system' ? 'system' : themeMode === 'light' ? 'light' : 'dark'

  nativeTheme.on('updated', () => {
    ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.themeSystemChanged)
  })
}
