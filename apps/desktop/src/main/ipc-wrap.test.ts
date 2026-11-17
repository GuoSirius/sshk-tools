import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

import { ipcMain } from 'electron'
import { AppError, isIpcResult } from '@sshk/shared'
import { handleOk, wrapIpcHandler } from './ipc-wrap'

const eventStub = {} as never

describe('H1 统一 IPC 失败契约（handleOk / wrapIpcHandler）', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })

  it('成功结果带 __ipc 标记，data 原样返回', async () => {
    const wrapped = wrapIpcHandler('ch:ok', () => 42)
    await expect(wrapped(eventStub)).resolves.toEqual({ __ipc: true, ok: true, data: 42 })
  })

  it('async 业务正常透传返回值', async () => {
    const wrapped = wrapIpcHandler('ch:async', async () => ({ a: 1 }))
    await expect(wrapped(eventStub)).resolves.toEqual({ __ipc: true, ok: true, data: { a: 1 } })
  })

  it('AppError → 结构化失败，永不 reject，code 归类', async () => {
    const wrapped = wrapIpcHandler('ch:app', () => { throw new AppError('校验不通过', 'validation') })
    await expect(wrapped(eventStub)).resolves.toEqual({ __ipc: true, ok: false, code: 'validation', message: '校验不通过' })
  })

  it('云 SDK AccessDenied → code=permission，不刷终端堆栈', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const denied = Object.assign(new Error('You have no right to access this object because of bucket acl.'), {
      code: 'AccessDenied', status: 403, name: 'AccessDeniedError',
    })
    const wrapped = wrapIpcHandler('ch:acl', () => { throw denied })
    await expect(wrapped(eventStub)).resolves.toMatchObject({ __ipc: true, ok: false, code: 'permission' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('NoSuchBucket → code=io，同样按业务失败处理', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = wrapIpcHandler('ch:missing', () => { throw Object.assign(new Error('The specified bucket does not exist'), { code: 'NoSuchBucket' }) })
    await expect(wrapped(eventStub)).resolves.toMatchObject({ __ipc: true, ok: false, code: 'io' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('意外异常 → code=unknown 并打终端日志（不 reject）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = wrapIpcHandler('ch:boom', () => { throw new TypeError('xx is not a function') })
    const result = await wrapped(eventStub)
    expect(result).toMatchObject({ __ipc: true, ok: false, code: 'unknown' })
    expect(String((result as { message: string }).message)).toContain('not a function')
    expect(spy).toHaveBeenCalled()
  })

  it('业务数据恰好像 {ok:true}（无 __ipc 标记）不会被误判，仍作为 data 包装', async () => {
    // dev-tools run() 返回 { ok: true, output } —— 必须整体作为 data 透传
    const wrapped = wrapIpcHandler('ch:run', () => ({ ok: true, output: '已写入 x' }))
    await expect(wrapped(eventStub)).resolves.toEqual({
      __ipc: true, ok: true, data: { ok: true, output: '已写入 x' },
    })
  })

  it('已是 IpcResult 的返回值不二次包装', async () => {
    const wrapped = wrapIpcHandler('ch:pass', () => ({ __ipc: true, ok: false, code: 'io' as const, message: '直接给出' }))
    await expect(wrapped(eventStub)).resolves.toEqual({ __ipc: true, ok: false, code: 'io', message: '直接给出' })
  })

  it('handleOk 注册到 ipcMain.handle；isIpcResult 识别边界', () => {
    handleOk('ch:reg', () => true)
    expect(ipcMain.handle).toHaveBeenCalledWith('ch:reg', expect.any(Function))
    expect(isIpcResult({ __ipc: true, ok: true, data: 1 })).toBe(true)
    expect(isIpcResult({ ok: true })).toBe(false)
    expect(isIpcResult(null)).toBe(false)
    expect(isIpcResult('x')).toBe(false)
  })
})
