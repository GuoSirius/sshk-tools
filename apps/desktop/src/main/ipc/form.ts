import { IPC_CHANNELS } from '@sshk/shared'
import type { FormSaveInput, ControlSaveInput } from '@sshk/shared'
import {
  controlGet,
  controlList,
  controlRemove,
  controlSave,
  ensureSeedControls,
  formGet,
  formList,
  formRemove,
  formSave,
} from '../modules/form/service'
import { handleOk } from '../ipc-wrap'
import type { IpcContext } from './context'

/** 表单设计域（plans/13）：form:* / formControl:* 八通道 + 启动内置控件幂等播种 */
export async function registerFormIpc(ctx: IpcContext): Promise<void> {
  const services = ctx.services

  // 内置复合控件播种（ensureSeedControls 幂等，随服务注册执行一次）
  await ensureSeedControls(services.repository)

  // ── 表单 CRUD（forms 集合）──
  handleOk(IPC_CHANNELS.formList, () => formList(services.repository))
  handleOk(IPC_CHANNELS.formGet, (_event, id: string) => formGet(services.repository, id))
  handleOk(IPC_CHANNELS.formSave, (_event, req: FormSaveInput) => formSave(services.repository, services.config, req))
  handleOk(IPC_CHANNELS.formRemove, (_event, req: { id: string; hard?: boolean }) =>
    formRemove(services.repository, req?.id, req?.hard === true))

  // ── 复合控件 CRUD（formControls 集合；builtin 只读、删除反查引用拦截）──
  handleOk(IPC_CHANNELS.formControlList, () => controlList(services.repository))
  handleOk(IPC_CHANNELS.formControlGet, (_event, id: string) => controlGet(services.repository, id))
  handleOk(IPC_CHANNELS.formControlSave, (_event, req: ControlSaveInput) => controlSave(services.repository, services.config, req))
  handleOk(IPC_CHANNELS.formControlRemove, (_event, req: { id: string; hard?: boolean }) =>
    controlRemove(services.repository, req?.id, req?.hard === true))
}
