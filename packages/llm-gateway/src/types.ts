import type { Origin } from '@sshk/shared'

/** 模型 provider（数据契约 §3.2）：apiKey 走 secrets.bin（safeStorage），不在此结构内 */
export interface LlmProvider {
  _id: string
  name: string
  /** local = 本地推理（Ollama 等），remote = 云 API */
  kind: 'local' | 'remote'
  baseURL: string
  model: string
  enabled: boolean
}

/** OpenAI 兼容多模态分片：文本 + 图片 data URI / URL */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  /** 纯文本，或 vision 模型的 text / image_url 组合 */
  content: string | ChatContentPart[]
}

export interface ChatRequest {
  provider: LlmProvider
  /** apiKey 由网关从 secrets 注入，绝不经渲染进程明文传递后落日志 */
  apiKey?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** SSE 回调；不传则走非流式 */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

export interface ChatResponse {
  content: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export interface HealthResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export type ProviderOrigin = Origin
