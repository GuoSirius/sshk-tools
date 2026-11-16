import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：edm-studio 渲染层宿主代理。
 * 事件订阅类（upload.onProgress）不登记、直通具名方法。
 */
export const host = createSafeHost({
  os: { clipboardWrite: C.osClipboardWrite, readDataUri: C.osReadDataUri, pickFile: C.osPickFile },
  upload: { single: C.uploadSingle, batch: C.uploadBatch },
})
