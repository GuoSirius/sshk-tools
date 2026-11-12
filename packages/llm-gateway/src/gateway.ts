import type { ChatRequest, ChatResponse, HealthResult, LlmProvider } from './types.js'

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

function headers(provider: LlmProvider, apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) h['authorization'] = `Bearer ${apiKey}`
  return h
}

/** OpenAI 兼容 /v1/chat/completions；onDelta 存在时走 SSE 流式 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const { provider, messages, apiKey, temperature, maxTokens, onDelta, signal } = req
  const stream = typeof onDelta === 'function'
  const res = await fetch(`${trimBase(provider.baseURL)}/chat/completions`, {
    method: 'POST',
    headers: headers(provider, apiKey),
    signal,
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`模型请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  if (!stream) {
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      model: json.model ?? provider.model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      },
    }
  }

  // SSE：data: {...} 行解析，[DONE] 结束
  const body = res.body
  if (!body) throw new Error('模型响应无内容流')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          content += delta
          onDelta?.(delta)
        }
      } catch {
        // 非 JSON 心跳行，忽略
      }
    }
  }
  return { content, model: provider.model }
}

/** /v1/models 列表 */
export async function listModels(provider: LlmProvider, apiKey?: string): Promise<string[]> {
  const res = await fetch(`${trimBase(provider.baseURL)}/models`, { headers: headers(provider, apiKey) })
  if (!res.ok) throw new Error(`获取模型列表失败 HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { id?: string }[] }
  return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)
}

/** 健康检查：models 或 chat 轻探测，返回时延 */
export async function healthCheck(provider: LlmProvider, apiKey?: string): Promise<HealthResult> {
  const started = performance.now()
  try {
    const res = await fetch(`${trimBase(provider.baseURL)}/models`, {
      headers: headers(provider, apiKey),
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, latencyMs }
    return { ok: true, message: `连接正常（${latencyMs}ms）`, latencyMs }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
