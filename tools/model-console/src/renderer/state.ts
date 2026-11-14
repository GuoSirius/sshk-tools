import { computed, ref, watch } from 'vue'
import { entityId } from '@sshk/shared'

/**
 * 模型控制台共享状态（模块级单例）：
 * - toolId 由壳注入（单一来源 = manifest.id → 宿主 :tool-id prop），config key 动态拼装，源码零硬编码；
 * - providers/health/presets 供 Provider 页与对话页共享；
 * - 对话状态（messages 等）放这里而非组件内：菜单切换会卸载页面组件，
 *   模块单例保证「切走再切回，消息不丢」（与拆分前单文件行为一致）。
 */
export const toolId = ref('')

export function configKey(key: string): string {
  return `tools.${toolId.value}.${key}`
}

export interface Provider {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  model: string
  enabled: boolean
}

/** 预设来自工具包自己 tool.manifest.json 的 defaults.modelPresets（不含任何密钥） */
export interface ModelPreset {
  id: string
  name: string
  baseURL: string
  kind: 'local' | 'remote'
  defaultModel: string
  models: string[]
  hint?: string
}

export interface HealthState { ok: boolean; message: string; at: string }

// ── Provider 管理 ──
export const providers = ref<Provider[]>([])
export const presets = ref<ModelPreset[]>([])
export const health = ref<Record<string, HealthState>>({})

// ── 对话调试（多轮 · 流式打字 · Markdown 回显） ──
export interface ChatMessage { role: 'user' | 'assistant'; content: string; error?: boolean }
export const messages = ref<ChatMessage[]>([])
export const chatProviderId = ref('')
export const chatting = ref(false)
// 输入草稿也放单例：切到 Provider 页再切回，草稿不丢
export const chatInput = ref('')

export const activeProvider = computed<Provider | null>(
  () => providers.value.find((p) => p._id === chatProviderId.value) ?? null,
)

export async function load(): Promise<void> {
  const saved = (await window.api.config.get('app.llm.providers')) as Provider[] | null
  providers.value = Array.isArray(saved) ? saved : []
  // 连通状态持久化：测过的 Provider 下次进来直接显示上次结果
  const savedHealth = (await window.api.config.get('app.llm.health')) as Record<string, HealthState> | null
  if (savedHealth && typeof savedHealth === 'object') health.value = savedHealth
  const rawPresets = (await window.api.config.get(configKey('modelPresets'))) as ModelPreset[] | null
  presets.value = Array.isArray(rawPresets)
    ? rawPresets.filter((p) => p && typeof p.baseURL === 'string' && Array.isArray(p.models))
    : []
  // 记忆上次选择的模型（Provider）：下次进入对话调试保持同一选择
  const savedChat = (await window.api.config.get(configKey('chat.providerId'))) as string | null
  if (typeof savedChat === 'string' && providers.value.some((p) => p._id === savedChat)) {
    chatProviderId.value = savedChat
  }
}

// 选择变化时持久化（记忆模型）——模块级注册，单例只挂一次
watch(chatProviderId, (id) => {
  if (id) void window.api.config.set(configKey('chat.providerId'), id)
})

export async function persist(): Promise<void> {
  await window.api.config.set('app.llm.providers', providers.value)
}

export function newProviderId(): string {
  return entityId('prv')
}
