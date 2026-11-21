import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：share-manager（分享管理）渲染层宿主代理。
 * 路由/日志/生命周期全部走宿主注册的 shareHub:* 通道；配置走 config get/set。
 * 路由特权（plans/12）：本工具调用不传 toolId（宿主语义 = 管理全部）。
 */
export const host = createSafeHost({
  shareHub: {
    list: C.shareHubList,
    revoke: C.shareHubRevoke,
    renew: C.shareHubRenew,
    status: C.shareHubStatus,
    logs: C.shareHubLogs,
    exportLogs: C.shareHubExportLogs,
    deleteLogs: C.shareHubDeleteLogs,
    clearLogs: C.shareHubClearLogs,
  },
  shareHubControl: {
    start: C.shareHubControl,
    restart: C.shareHubControl,
    stop: C.shareHubControl,
    clear: C.shareHubControl,
  },
  config: { get: C.configGet, set: C.configSet },
  os: { pickSave: C.osPickSave, pickDir: C.osPickDir, writeText: C.osWriteText, clipboardWrite: C.osClipboardWrite },
})
