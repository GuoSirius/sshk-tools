import { computed, ref, watch } from 'vue'
import { toolConfigKey, entityId } from '@sshk/shared'
import { host } from './host'
import { createTypingSmoothener } from './typing-smoothener'

/**
 * 模型控制台共享状态（模块级单例）：
 * - toolId 由壳注入（单一来源 = manifest.id → 宿主 :tool-id prop），config key 动态拼装，源码零硬编码；
 * - providers/health/presets 供 Provider 页与对话页共享；
 * - 对话状态（messages 等）放这里而非组件内：菜单切换会卸载页面组件，
 *   模块单例保证「切走再切回，消息不丢」（与拆分前单文件行为一致）。
 */
export const toolId = ref('')

/** CR-25③（P0-7）：格式统一走 shared toolConfigKey，本包装只注入本工具 toolId */
export function configKey(key: string): string {
  return toolConfigKey(toolId.value, key)
}

export interface Provider {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  /** 默认模型名：调用链首位 */
  model: string
  /** 回退模型名：默认模型失败（含重试耗尽）后自动回退再试，可留空 */
  fallbackModel?: string
  /** 每个模型失败后的额外重试次数（0-5），默认 0 */
  maxRetries?: number
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
export interface ChatMessage { role: 'user' | 'assistant'; content: string; error?: boolean; nonStream?: boolean }
export const messages = ref<ChatMessage[]>([])
export const chatProviderId = ref('')
export const chatting = ref(false)
// 输入草稿也放单例：切到 Provider 页再切回，草稿不丢
export const chatInput = ref('')
/** D-V3-2 打字平滑开关（默认开）：积压分片按节拍释放，避免端点聚合大分片时「一下子输出」 */
export const typeSmooth = ref(true)

export const activeProvider = computed<Provider | null>(
  () => providers.value.find((p) => p._id === chatProviderId.value) ?? null,
)

export async function load(): Promise<void> {
  const saved = (await host.config.get('app.llm.providers')) as Provider[] | null
  providers.value = Array.isArray(saved) ? saved : []
  // CR-37（P1-6）：连通状态不再持久化（app.llm.health 双轨已清）——内存态随会话，测速结果本就是临时诊断信息
  const rawPresets = (await host.config.get(configKey('modelPresets'))) as ModelPreset[] | null
  presets.value = Array.isArray(rawPresets)
    ? rawPresets.filter((p) => p && typeof p.baseURL === 'string' && Array.isArray(p.models))
    : []
  // 记忆上次选择的模型（Provider）：下次进入对话调试保持同一选择
  const savedChat = (await host.config.get(configKey('chat.providerId'))) as string | null
  if (typeof savedChat === 'string' && providers.value.some((p) => p._id === savedChat)) {
    chatProviderId.value = savedChat
  }
  // 打字平滑开关持久化（未配置默认开）
  const savedSmooth = await host.config.get(configKey('chat.typeSmooth'))
  typeSmooth.value = savedSmooth !== false
}

// ── D-V3-2 打字平滑：分片入队节拍释放（模块单例，壳的 onDelta 与 ChatPage 的 flush 共用） ──
const smooth = createTypingSmoothener((text) => {
  if (!chatting.value) return
  const last = messages.value[messages.value.length - 1]
  if (last && last.role === 'assistant') last.content += text
})

/** 流式分片入口：平滑开 → 入队节拍释放；关 → 直接追加（ModelConsolePage 壳调用） */
export function appendDelta(delta: string): void {
  if (!chatting.value) return
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'assistant') return
  if (typeSmooth.value) smooth.push(delta)
  else last.content += delta
}

/** 流结束时立即释放平滑积压（避免结尾内容一次性跳变），ChatPage 收尾调用 */
export function flushDelta(): void {
  smooth.flush()
}

// 选择变化时持久化（记忆模型）——模块级注册，单例只挂一次
watch(chatProviderId, (id) => {
  if (id) void host.config.set(configKey('chat.providerId'), id)
})

// 打字平滑开关持久化
watch(typeSmooth, (value) => {
  void host.config.set(configKey('chat.typeSmooth'), value)
})

export async function persist(): Promise<void> {
  await host.config.set('app.llm.providers', providers.value)
}

export function newProviderId(): string {
  return entityId('prv')
}
