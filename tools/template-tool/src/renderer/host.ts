import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：template-tool 渲染层宿主代理（骨架示范）。
 * 工具自有通道走 window.api.ipc.invoke（HomePage 有示例，属工具直连宿主转发，不在本代理内）。
 */
export const host = createSafeHost({
  config: { get: C.configGet, set: C.configSet },
  upload: { single: C.uploadSingle, profiles: C.uploadProfiles, listImages: C.uploadListImages },
})
