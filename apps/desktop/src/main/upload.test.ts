import { describe, expect, it, vi } from 'vitest'
import { UploadRuntime } from './upload'
import type { AppServices } from './services'

/**
 * N11 回归：连接测试属于「用户填错配置」的预期内结果。
 * ipcMain.handle 只要 reject，Electron 就会往主进程终端打印
 * "Error occurred in handler for 'upload:test'" 整段堆栈，污染控制台。
 * 因此 test() 必须把任何失败收敛成 { ok: false, message }，绝不抛。
 */
function createRuntime(): UploadRuntime {
  const services = {
    config: { get: vi.fn(() => undefined) },
    host: { getToolSecret: vi.fn(() => '') },
  } as unknown as AppServices
  return new UploadRuntime({ services, onProgress: () => {} })
}

describe('UploadRuntime.test 结构化结果', () => {
  it('远程配置不完整时返回失败结果而不是抛异常', async () => {
    const res = await createRuntime().test({ type: 'remote', profile: { id: 'r1' } })
    expect(res.ok).toBe(false)
    expect(res.message.length).toBeGreaterThan(0)
  })

  it('云配置不完整时返回失败结果而不是抛异常', async () => {
    const res = await createRuntime().test({ type: 'cloud', profile: {} })
    expect(res.ok).toBe(false)
    expect(res.message.length).toBeGreaterThan(0)
  })

  it('请求体为空 / 缺字段也不 reject', async () => {
    const runtime = createRuntime()
    await expect(
      runtime.test(undefined as unknown as Parameters<UploadRuntime['test']>[0]),
    ).resolves.toMatchObject({ ok: false })
  })
})
