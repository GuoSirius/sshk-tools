import { describe, expect, it } from 'vitest'
import { chat } from './gateway'
import type { LlmProvider } from './types'

const provider: LlmProvider = {
  _id: 'prv_test',
  name: '测试',
  kind: 'remote',
  baseURL: 'https://unit.test/v1',
  model: 'test-model',
  enabled: true,
}

describe('llm-gateway（本地 mock fetch）', () => {
  it('非流式 chat 解析 choices', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '你好' } }], model: 'test-model', usage: { prompt_tokens: 3, completion_tokens: 2 } }),
        { status: 200 },
      )
    }) as typeof fetch
    try {
      const res = await chat({ provider, messages: [{ role: 'user', content: 'hi' }] })
      expect(res.content).toBe('你好')
      expect(res.usage?.promptTokens).toBe(3)
      expect(calls[0]?.url).toBe('https://unit.test/v1/chat/completions')
      const body = JSON.parse(String(calls[0]?.init.body) ?? '{}') as Record<string, unknown>
      expect(body['stream']).toBe(false)
    } finally {
      globalThis.fetch = original
    }
  })

  it('流式 chat 拼接 SSE delta', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    try {
      const deltas: string[] = []
      const res = await chat({
        provider,
        messages: [{ role: 'user', content: 'hi' }],
        onDelta: (d) => deltas.push(d),
      })
      expect(deltas.join('')).toBe('你好')
      expect(res.content).toBe('你好')
    } finally {
      globalThis.fetch = original
    }
  })

  it('HTTP 错误抛出含状态码的信息', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch
    try {
      await expect(chat({ provider, messages: [] })).rejects.toThrow('HTTP 401')
    } finally {
      globalThis.fetch = original
    }
  })
})
