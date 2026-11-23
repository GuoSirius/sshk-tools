import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：表单设计（plans/13 B1/C）渲染层宿主代理。
 * 桥接方法与 window.api.form / window.api.formControl 同形。
 * upload / os 段（2026-11-24）：图片字段「选择图片」走 FilePickerDialog（与 EDM 同源，
 * createHostImageLibrary 桥接）；clipboardWrite 供图片 URL 一键复制。
 * 事件订阅类（upload.onProgress）不登记、直通具名方法。
 */
export const host = createSafeHost({
  form: {
    list: C.formList,
    get: C.formGet,
    save: C.formSave,
    remove: C.formRemove,
  },
  formControl: {
    list: C.formControlList,
    get: C.formControlGet,
    save: C.formControlSave,
    remove: C.formControlRemove,
  },
  os: { clipboardWrite: C.osClipboardWrite },
  upload: {
    single: C.uploadSingle,
    batch: C.uploadBatch,
    profiles: C.uploadProfiles,
    listImages: C.uploadListImages,
    listDirectories: C.uploadListDirectories,
  },
})
