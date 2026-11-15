import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOST_API_STALE_HINT,
  callHostApi,
  hasHostApi,
  hostApiMissing,
  reloadHostWindow,
  type HostApiSpec,
} from './host-api'

const spec: HostApiSpec = {
  group: 'upload',
  method: 'test',
  channel: 'upload:test',
  label: '连接测试',
}

function setApi(value: unknown): void {
  ;(globalThis as unknown as { api?: unknown }).api = value
}

afterEach(() => {
  setApi(undefined)
})

describe('宿主能力调用（跨版本安全）', () => {
  it('具名方法存在时直接调用，不走通用通道', async () => {
    const generic = vi.fn()
    setApi({
      upload: { test: async (n: number) => `ok:${n}` },
      ipc: { invoke: generic },
    })
    expect(hasHostApi(spec)).toBe(true)
    expect(await callHostApi<string>(spec, 7)).toBe('ok:7')
    expect(generic).not.toHaveBeenCalled()
  })

  it('旧 preload 快照缺具名方法时，回退通用 ipc 通道并保持入参', async () => {
    const generic = vi.fn(async (channel: string, req: unknown) => `${channel}:${JSON.stringify(req)}`)
    setApi({ upload: { getConfig: async () => ({}) }, ipc: { invoke: generic } })
    expect(hasHostApi(spec)).toBe(false)
    expect(hostApiMissing([spec])).toEqual(['连接测试'])
    expect(await callHostApi<string>(spec, { a: 1 })).toBe('upload:test:{"a":1}')
    expect(generic).toHaveBeenCalledWith('upload:test', { a: 1 })
  })

  it('主进程也未注册时，给出可操作提示而非 is not a function', async () => {
    setApi({ ipc: { invoke: async () => { throw new Error("No handler registered for 'upload:test'") } } })
    await expect(callHostApi(spec, {})).rejects.toThrow(HOST_API_STALE_HINT)
    await expect(callHostApi(spec, {})).rejects.toThrow('No handler registered')
  })

  it('通用通道也没有时，仍给出可操作提示', async () => {
    setApi({ upload: {} })
    await expect(callHostApi(spec, {})).rejects.toThrow('重载窗口')
  })

  it('批量自检只返回缺失项', () => {
    const other: HostApiSpec = { group: 'upload', method: 'getSecret', channel: 'upload:secret:get', label: '密钥回显' }
    setApi({ upload: { test: () => Promise.resolve('') } })
    expect(hostApiMissing([spec, other])).toEqual(['密钥回显'])
  })

  it('重载窗口优先走宿主 app.reload(true)', async () => {
    const reload = vi.fn(async () => true)
    setApi({ app: { reload } })
    await reloadHostWindow()
    expect(reload).toHaveBeenCalledWith(true)
  })
})
