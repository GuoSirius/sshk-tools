import { ref } from 'vue'
import type { ChatMessage } from '../ai'

/**
 * 表单 AI 文案助手的宿主通道组合式函数（2026-11-24 收敛）：
 * EDM SampleForm 与表单设计 FormsManagePage 的 ensureProvider/chat 逻辑同源
 * （此前两处各写一份 ~40 行，Provider 解析口径漂移风险）。
 *
 * Provider 解析链（两宿主一致）：模块/工具级 providerKey 指定 → 未指定则跟随应用激活
 * Provider（activeProviderKey，默认 app.llm.activeProviderId）→ 再回落清单首个启用项。
 * 模型链：模块/工具级 modelKey 覆盖 → Provider 默认模型 → Provider 回退模型（main 侧组装）。
 *
 * 通道经 channels 注入（宿主桥接差异隔离）：EDM 走 tool-api shim（容忍旧宿主无 config
 * 通道），app-admin 模块页直用 window.api。纯状态机不触 window，便于单测。
 */
export interface AiChatChannels {
  /** 读工具/模块级配置（Provider id、模型覆盖） */
  configGet(key: string): Promise<unknown>
  /** Provider 清单（enabled 过滤在内部做） */
  providers(): Promise<Array<{ _id: string; enabled: boolean }>>
  /** 发起对话；options.model 为模块/工具级模型覆盖 */
  chat(provider: unknown, messages: ChatMessage[], options?: { model?: string }): Promise<{ content: string }>
}

export interface UseAiChatOptions {
  /** 工具/模块级 Provider 配置键（如 tools.edm-studio.ai.providerId / app.modules.formManager.ai.providerId） */
  providerKey: string
  /** 工具/模块级模型覆盖配置键 */
  modelKey: string
  /** 未指定 Provider 时跟随应用激活 Provider 的配置键 */
  activeProviderKey?: string
  channels: AiChatChannels
}

export function useAiChat(options: UseAiChatOptions) {
  const loading = ref(false)
  const noProvider = ref(true)
  let provider: { _id: string } | null = null
  let modelOverride = ''

  /** 解析可用 Provider（未配置返回 false，调用方给结构化提示） */
  async function ensureProvider(): Promise<boolean> {
    try {
      let wantId = ''
      try { wantId = String(await options.channels.configGet(options.providerKey) ?? '').trim() } catch { /* 旧宿主无 config 通道时忽略 */ }
      const list = await options.channels.providers()
      if (wantId) {
        provider = list.find((p) => p.enabled && p._id === wantId) ?? null
      } else {
        let activeId = ''
        try { activeId = String(await options.channels.configGet(options.activeProviderKey ?? 'app.llm.activeProviderId') ?? '').trim() } catch { /* 忽略 */ }
        provider = list.find((p) => p.enabled && p._id === activeId) ?? list.find((p) => p.enabled) ?? null
      }
      try { modelOverride = String(await options.channels.configGet(options.modelKey) ?? '').trim() } catch { modelOverride = '' }
    } catch {
      provider = null
      modelOverride = ''
    }
    noProvider.value = !provider
    return Boolean(provider)
  }

  async function chat(messages: ChatMessage[]): Promise<string> {
    if (!provider) throw new Error('请先在「模型管理」配置并启用模型 Provider')
    const res = await options.channels.chat(provider, messages, modelOverride ? { model: modelOverride } : undefined)
    return res.content
  }

  return { loading, noProvider, ensureProvider, chat }
}
