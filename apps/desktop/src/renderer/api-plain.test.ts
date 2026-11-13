import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { installPlainApi } from './api-plain'
import { toPlainArg } from './plain'

declare global {
  var sshkApiBridge: unknown
  var api: unknown
}

describe('渲染层 contextBridge 边界脱壳', () => {
  it('从 sshkApiBridge 组装 window.api：Vue Proxy 入参在边界前脱壳', () => {
    const received: unknown[][] = []
    globalThis.sshkApiBridge = {
      llm: { chat: (...args: unknown[]) => { received.push(args); return Promise.resolve({ content: 'ok' }) } },
      config: { set: (key: string, value: unknown) => { received.push([key, value]); return Promise.resolve(true) } },
    }
    globalThis.api = undefined
    installPlainApi()

    const provider = reactive({ _id: 'prv_1', name: 'Agnes', tags: reactive(['a', 'b']) })
    const api = globalThis.api as {
      llm: { chat: (...a: unknown[]) => Promise<unknown> }
      config: { set: (k: string, v: unknown) => Promise<boolean> }
    }
    void api.llm.chat(provider, [{ role: 'user', content: 'hi' }])
    const chatArgs = received[0] as unknown[]
    expect(JSON.stringify(chatArgs)).toContain('"_id":"prv_1"')
    // 组装后的 api 方法收到的必须是普通对象（可结构化克隆），而不是 Proxy
    expect(Object.getPrototypeOf(chatArgs[0] as object)).toBe(Object.prototype)

    void api.config.set('app.llm.providers', reactive([provider]))
    const setArgs = received[1] as unknown[]
    expect(Object.getPrototypeOf((setArgs[1] as unknown[])[0] as object)).toBe(Object.prototype)
  })

  it('监听注册的回调函数原样传递，不被脱壳丢弃', () => {
    const calls: unknown[] = []
    globalThis.sshkApiBridge = { llm: { onDelta: (cb: unknown) => { calls.push(cb) } } }
    globalThis.api = undefined
    installPlainApi()
    const callback = vi.fn()
    ;(globalThis.api as { llm: { onDelta: (cb: unknown) => void } }).llm.onDelta(callback)
    expect(calls[0]).toBe(callback)
  })

  it('toPlainArg：普通值与回调原样、Proxy 深层脱壳、循环引用安全', () => {
    const callback = () => 1
    expect(toPlainArg(callback)).toBe(callback)
    const nested = reactive({ a: { b: reactive({ c: 1 }) } })
    const out = toPlainArg(nested) as { a: { b: { c: number } } }
    expect(out.a.b.c).toBe(1)
    const loop: Record<string, unknown> = reactive({})
    loop['self'] = loop
    const cloned = toPlainArg(loop) as Record<string, unknown>
    expect(cloned['self']).toBe(cloned)
  })
})
