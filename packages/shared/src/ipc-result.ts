/**
 * H1 统一 IPC 失败契约（plans/03 §一）：
 * 主进程 handler **永不 reject**——预期内业务失败（校验不通过、连不上、权限拒绝）
 * 不是异常，reject 只会让 Electron 往终端刷 "Error occurred in handler" 堆栈。
 *
 * 三层配合：
 *   1) 主进程 ipc-wrap.handleOk / guardedIpcMain 包装：捕获后 resolve IpcResult
 *   2) preload invoke 出口统一解包：__ipc 标记结果 → ok 取 data / !ok 抛 Error(message)
 *   3) 渲染层零改动：拿到的仍是 data，或被 try/catch 捕获 message
 *
 * `__ipc` 品牌标记用于区分「包装结果」与业务数据中恰好像 {ok:...} 的对象
 *（dev-tools 的 run() 就返回 {ok:true, output}），避免误伤。
 */

export type IpcErrorCode = 'validation' | 'io' | 'timeout' | 'upstream' | 'permission' | 'unknown'

export interface IpcOk<T> {
  __ipc: true
  ok: true
  data: T
}

export interface IpcErr {
  __ipc: true
  ok: false
  code: IpcErrorCode
  message: string
}

export type IpcResult<T> = IpcOk<T> | IpcErr

/** 预期内业务错误：handleOk 按给定 code 归类，不打堆栈 */
export class AppError extends Error {
  readonly code: IpcErrorCode

  constructor(message: string, code: IpcErrorCode = 'validation') {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

/** preload / 单测共用：识别主进程包装过的结果 */
export function isIpcResult(value: unknown): value is IpcResult<unknown> {
  return (
    typeof value === 'object' && value !== null &&
    (value as { __ipc?: unknown }).__ipc === true &&
    ((value as { ok?: unknown }).ok === true || (value as { ok?: unknown }).ok === false)
  )
}
