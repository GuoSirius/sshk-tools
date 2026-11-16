import type { ChatRequest, ChatResponse, HealthResult, LlmProvider } from './types.js'

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) h['authorization'] = `Bearer ${apiKey}`
  return h
}

/** OpenAI 兼容 /v1/chat/completions；onDelta 存在时走 SSE 流式。
 *  模型优先级：req.model（工具自选）> provider.model（默认）> provider.fallbackModel（回退，
 *  由 chatWithFallback 展开为模型链依次尝试）。 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const { provider, messages, apiKey, temperature, maxTokens, onDelta, signal } = req
  const model = req.model?.trim() || provider.model
  const stream = typeof onDelta === 'function'
  const res = await fetch(`${trimBase(provider.baseURL)}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    signal,
    body: JSON.stringify({
      model,
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
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      },
    }
  }

  // D-V3：端点不支持 SSE 时（请求了 stream 但 content-type 是 JSON）降级为整包解析，
  // 避免 JSON 文本进 SSE 行解析后 content 为空导致回复空白；streamed=false 供 UI 标注
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      },
      streamed: false,
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
  return { content, model }
}

/**
 * 模型链回退调用：按 models 依次尝试（去重去空），每个模型失败后额外重试 retries 次；
 * 全部耗尽后抛最后一个错误，由上层进入正常异常流程。
 * 优先级示例（badge 视觉识别）：工具自选模型 → Provider 默认模型 → 回退模型。
 * 安全约束：流式调用且 delta 已输出过时立即抛错——回退/重试会重放整段内容导致重复。
 */
export async function chatWithFallback(
  req: ChatRequest,
  models: string[],
  retries = 0,
): Promise<ChatResponse> {
  const chain = [...new Set(models.map((m) => (m ?? '').trim()).filter(Boolean))]
  if (chain.length === 0) throw new Error('模型链为空：请先在 Provider 配置默认模型名')
  const maxAttempts = Math.max(1, Math.floor(retries) + 1)
  const onDelta = req.onDelta
  let emitted = false
  const wrapped = onDelta
    ? (delta: string): void => {
        emitted = true
        onDelta(delta)
      }
    : undefined
  let lastErr: unknown
  for (const model of chain) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await chat({ ...req, model, onDelta: wrapped })
      } catch (err) {
        lastErr = err
        if (emitted) throw err
        // attempt < maxAttempts 时重试同一模型；耗尽后跳出进入链上下一个模型
        if (attempt >= maxAttempts) break
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** /v1/models 列表 */
export async function listModels(provider: LlmProvider, apiKey?: string): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(`${trimBase(provider.baseURL)}/models`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    throw new Error(`无法连接 ${provider.baseURL}/models：${(err as Error).message}；可手动输入模型名`)
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403
      ? '（API Key 无效 / 未配置 / 无权限）'
      : res.status === 404
        ? '（该端点不支持 /models）'
        : ''
    throw new Error(`获取模型列表失败 HTTP ${res.status}${hint}；可手动输入模型名，不影响保存`)
  }
  const json = (await res.json()) as { data?: { id?: string }[] }
  return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)
}

/** 健康检查：models 或 chat 轻探测，返回时延 */
export async function healthCheck(provider: LlmProvider, apiKey?: string): Promise<HealthResult> {
  const started = performance.now()
  try {
    const res = await fetch(`${trimBase(provider.baseURL)}/models`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, latencyMs }
    return { ok: true, message: `连接正常（${latencyMs}ms）`, latencyMs }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
