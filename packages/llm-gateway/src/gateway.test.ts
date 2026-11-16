import { describe, expect, it } from 'vitest'
import { chat, chatWithFallback } from './gateway'
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

describe('chatWithFallback（模型链回退）', () => {
  const originalFetch = globalThis.fetch
  const ok = (model: string): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content: `来自${model}` } }], model }), { status: 200 })

  /** 可编程 mock：按调用序号返回 Responses，记录每次请求的 URL 与 body.model */
  function mockFetch(
    responses: (() => Response)[],
    log?: { urls: string[]; models: string[] },
  ): void {
    let call = 0
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      log?.urls.push(String(url))
      log?.models.push((JSON.parse(String(init?.body) ?? '{}') as { model?: string }).model ?? '')
      const make = responses[Math.min(call, responses.length - 1)] ?? (() => new Response('mock', { status: 500 }))
      call++
      return make()
    }) as typeof fetch
  }

  it('默认模型失败后回退到 fallbackModel，请求体使用对应模型名', async () => {
    const log = { urls: [] as string[], models: [] as string[] }
    mockFetch([() => new Response('model gone', { status: 404 }), () => ok('fb-model')], log)
    try {
      const res = await chatWithFallback(
        { provider: { ...provider, fallbackModel: 'fb-model' }, messages: [{ role: 'user', content: 'hi' }] },
        ['test-model', 'fb-model'],
      )
      expect(res.content).toBe('来自fb-model')
      expect(res.model).toBe('fb-model')
      expect(log.urls).toHaveLength(2)
      expect(log.models).toEqual(['test-model', 'fb-model'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('req.model（工具自选）在链首位时优先生效', async () => {
    const log = { urls: [] as string[], models: [] as string[] }
    mockFetch([() => ok('tool-model')], log)
    try {
      const res = await chatWithFallback(
        {
          provider: { ...provider, fallbackModel: 'fb-model' },
          model: 'tool-model',
          messages: [{ role: 'user', content: 'hi' }],
        },
        ['tool-model', 'test-model', 'fb-model'],
      )
      expect(res.content).toBe('来自tool-model')
      expect(log.urls).toHaveLength(1)
      expect(log.models).toEqual(['tool-model'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('重试次数生效：同一模型失败 2 次后第 3 次成功（retries=2）', async () => {
    const log = { urls: [] as string[], models: [] as string[] }
    mockFetch(
      [() => new Response('err1', { status: 500 }), () => new Response('err2', { status: 502 }), () => ok('test-model')],
      log,
    )
    try {
      const res = await chatWithFallback({ provider, messages: [{ role: 'user', content: 'hi' }] }, ['test-model'], 2)
      expect(res.model).toBe('test-model')
      expect(log.urls).toHaveLength(3)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('链上全部模型（含重试）失败后抛最后一个错误', async () => {
    const log = { urls: [] as string[], models: [] as string[] }
    mockFetch([() => new Response('down', { status: 503 })], log)
    try {
      await expect(
        chatWithFallback({ provider, messages: [] }, ['m1', 'm2'], 1),
      ).rejects.toThrow('HTTP 503')
      // (1+1 重试) × 2 模型 = 4 次
      expect(log.urls).toHaveLength(4)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('流式 delta 已输出后流中断：不重试不回退，立即抛错避免内容重复', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      // 先发出一个 delta 分片，随后流中断——真实网络断流路径
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半"}}]}\n\n'))
            // 异步断流：同步 error() 会清空已入队分片，无法触发 delta
            setTimeout(() => controller.error(new Error('stream broke')), 5)
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    }) as typeof fetch
    try {
      const deltas: string[] = []
      await expect(
        chatWithFallback(
          {
            provider: { ...provider, fallbackModel: 'fb' },
            messages: [{ role: 'user', content: 'hi' }],
            onDelta: (d) => deltas.push(d),
          },
          ['test-model', 'fb'],
          2,
        ),
      ).rejects.toThrow('stream broke')
      expect(deltas.join('')).toBe('半')
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('模型链去空去重；全空链直接报错', async () => {
    const log = { urls: [] as string[], models: [] as string[] }
    mockFetch([() => ok('test-model')], log)
    try {
      // [' ', 'test-model', 'test-model'] 去空去重后只调一次 test-model
      const res = await chatWithFallback({ provider, messages: [] }, [' ', 'test-model', 'test-model'])
      expect(res.model).toBe('test-model')
      expect(log.urls).toHaveLength(1)
      await expect(chatWithFallback({ provider, messages: [] }, ['', '  '])).rejects.toThrow('模型链为空')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
