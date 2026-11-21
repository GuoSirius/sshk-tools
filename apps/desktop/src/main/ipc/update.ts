import { IPC_CHANNELS } from '@sshk/shared'
import { handleOk } from '../ipc-wrap'
import { logger } from '../logger'
import { resetDevUpdatePendingCache, updateDevCheck } from '../update-dev-fake'
import { autoUpdater, beginUpdateCheck, endUpdateCheck, getUpdateState, pushUpdate } from '../updater'
import type { IpcContext } from './context'

/** 更新四通道（P3-1 registerIpc 拆分：GetState/Check/Download/QuitAndInstall；状态机在 ../updater） */
export function registerUpdateIpc(ctx: IpcContext): void {
  handleOk(IPC_CHANNELS.updateGetState, () => getUpdateState())
  handleOk(IPC_CHANNELS.updateCheck, async () => {
    if (ctx.autoUpdateDisabled) { pushUpdate({ phase: 'disabled' }); return { disabled: true } }
    if (ctx.isDev && !updateDevCheck) { pushUpdate({ phase: 'dev' }); return { dev: true } }
    // P1-3（A11/Q-20）：检查互斥闸门——连点/并发触发只放行一次，避免状态机互相踩踏
    if (!beginUpdateCheck()) return { checking: true }
    // dev 更新测试：每次检查前清 pending 缓存 → 每次都重新下载，进度条可反复观察（KEEP_CACHE=1 保留）
    if (updateDevCheck) resetDevUpdatePendingCache()
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version ?? null
      // electron-updater 已按 semver 判定（含降级拦截）：装机 1.3.0 vs 线上 1.2.0 → false。
      // 此前这里用字符串不等号自判（「1.2.0」!==「1.3.0」→ true），装了最新版仍误报「发现新版本
      // 并已开始下载」，而内核实为 not-available → 按钮状态与进度都不动（2026-11-18 用户实测事故）
      const updateAvailable = result?.isUpdateAvailable === true
      return { dev: false, updateAvailable, version }
    } catch (err) {
      return { error: (err as Error).message }
    } finally {
      endUpdateCheck()
    }
  })
  handleOk(IPC_CHANNELS.updateDownload, async () => {
    if (ctx.autoUpdateDisabled) return false
    if (ctx.isDev && !updateDevCheck) return false
    // P1-3：下载单路径——autoDownload=true 下 available 即自动开下，手动重复触发不再叠加
    if (getUpdateState().phase === 'downloading' || getUpdateState().phase === 'downloaded') return true
    await autoUpdater.downloadUpdate()
    return true
  })
  handleOk(IPC_CHANNELS.updateQuitAndInstall, () => {
    if (ctx.autoUpdateDisabled) return { dev: false }
    if (updateDevCheck) {
      // dev 测试：只验证下载流程，绝不真装（否则会替换掉正在开发的 install 目录）
      logger.info('updater', 'dev 更新测试模式：拦截安装，仅下载不落盘安装')
      return { dev: true }
    }
    autoUpdater.quitAndInstall()
    return { dev: false }
  })
}
