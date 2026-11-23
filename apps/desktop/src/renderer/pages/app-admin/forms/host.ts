import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：表单设计（plans/13 B1/C）渲染层宿主代理。
 * 桥接方法与 window.api.form / window.api.formControl 同形。
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
})
