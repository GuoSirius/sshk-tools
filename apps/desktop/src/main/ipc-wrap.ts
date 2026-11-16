/**
 * H1 统一 IPC 失败契约的宿主侧实现（plans/03 §一）：
 * - handleOk(channel, fn)：等价 ipcMain.handle，但**永不 reject**——
 *   AppError → 按归类 resolve { ok:false }；意外异常 → code=unknown + 打日志。
 * - wrapIpcHandler(fn)：给代理层复用（guardedIpcMain / 沙箱转发）。
 * 渲染端由 preload invoke 出口统一解包（ok 取 data / !ok 抛 Error），工具层零改动。
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError, isIpcResult } from '@sshk/shared'
import type { IpcResult } from '@sshk/shared'
import { logger } from './logger'

type Handler<T> = (event: IpcMainInvokeEvent, ...args: any[]) => T | Promise<T>

function toResult(err: unknown, channel: string): IpcResult<never> {
  if (err instanceof AppError) {
    // 预期内业务失败：warn 级落盘（含归类），终端不再刷堆栈
    logger.warn('ipc', `${channel} 业务失败（${err.code}）：${err.message}`)
    return { __ipc: true, ok: false, code: err.code, message: err.message }
  }
  // 意外异常 = 真 bug：保留终端日志便于排查，但同样不 reject
  console.error(`[ipc] ${channel} 未预期异常：`, err)
  logger.error('ipc', `${channel} 未预期异常：${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined)
  return {
    __ipc: true,
    ok: false,
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err),
  }
}

/** 统一包装：业务函数抛错一律转 IpcResult；返回值若已是 IpcResult 则原样透传 */
export function wrapIpcHandler<T>(channel: string, handler: Handler<T>): Handler<IpcResult<T>> {
  return async (event, ...args) => {
    try {
      const data = await handler(event, ...args)
      return isIpcResult(data) ? (data as IpcResult<T>) : { __ipc: true, ok: true, data }
    } catch (err) {
      return toResult(err, channel)
    }
  }
}

/** ipcMain.handle 的永不 reject 版本：宿主主进程注册一律用它（门禁 check:ipc 强制） */
export function handleOk<T>(channel: string, handler: Handler<T>): void {
  ipcMain.handle(channel, wrapIpcHandler(channel, handler))
}
