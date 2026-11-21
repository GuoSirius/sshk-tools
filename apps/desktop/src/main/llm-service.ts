import { chatWithFallback, listModels, type LlmProvider } from '@sshk/llm-gateway'
import { AppError, type LlmProviderInfo, type ToolHostProviderChatRequest } from '@sshk/shared'
import type { ConfigService, Repository } from '@sshk/repository'
import { isProviderId } from './secret-ids'
import { recordUsage } from './usage'

/**
 * 应用级 Provider 域服务（O6/N5 · P3-2 第一刀自 services.ts 拆出）：
 * 应用级 Provider 是宿主能力，不属于任何工具：
 * 所有工具通过 host.listProviders()/chatByProvider() 复用同一份配置与密钥，
 * 不需要也不允许各自再配一遍 baseURL / apiKey。
 * 密钥读写仍由 services.ts 的 SecretsStore 单一收口，本模块只读快照注入。
 */

/** 应用级 Provider 清单读取（app.llm.providers，逐项做结构校验） */
export function readProviders(config: ConfigService): LlmProvider[] {
  const raw = config.get('app.llm.providers')
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is LlmProvider => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const p = item as Record<string, unknown>
    return typeof p['_id'] === 'string'
      && typeof p['baseURL'] === 'string'
      && /^https?:\/\//i.test(p['baseURL'])
      && typeof p['model'] === 'string'
  })
}

/** 按 id 取 Provider（非法 id / 不存在一律 AppError） */
export function findProvider(config: ConfigService, providerId: string): LlmProvider {
  if (!isProviderId(providerId)) throw new AppError(`非法 Provider ID：${providerId}`)
  const provider = readProviders(config).find((p) => p._id === providerId)
  if (!provider) {
    throw new AppError(`未找到 Provider「${providerId}」，请先在「模型管理」新增或启用`)
  }
  return provider
}

export interface LlmServiceDeps {
  config: ConfigService
  /** 用量记录落库（D-Q1） */
  repository: Repository
  /** 密钥同步缓存（services 装配的 SecretsStore 快照）；本模块不写密钥 */
  currentSecrets: () => Record<string, string>
}

export interface LlmService {
  readProviders(): LlmProvider[]
  findProvider(providerId: string): LlmProvider
  listProviders(): LlmProviderInfo[]
  chatByProvider(req: ToolHostProviderChatRequest): Promise<string>
  listModelsByProvider(providerId: string, apiKey?: string): Promise<string[]>
}

/** 装配 LLM 域服务（services.ts 组装进 host 能力；渲染层 llm* IPC 经 services 消费） */
export function createLlmService(deps: LlmServiceDeps): LlmService {
  const { config, repository, currentSecrets } = deps
  return {
    readProviders: () => readProviders(config),
    findProvider: (providerId) => findProvider(config, providerId),
    listProviders(): LlmProviderInfo[] {
      return readProviders(config).map((p) => ({
        _id: p._id,
        name: p.name,
        kind: p.kind,
        baseURL: p.baseURL,
        model: p.model,
        fallbackModel: p.fallbackModel,
        enabled: p.enabled,
        // 只回布尔标记，绝不回明文；工具据此提示用户「需要去模型管理填 Key」
        hasApiKey: Boolean(currentSecrets()[p._id]),
      }))
    },
    async chatByProvider(req: ToolHostProviderChatRequest): Promise<string> {
      const provider = findProvider(config, req.providerId)
      const started = Date.now()
      // 模型链优先级：req.model（工具自选，如 badge 识别页所选）→ Provider 默认模型 → 回退模型
      const models = [...new Set(
        [req.model?.trim() ?? '', provider.model, provider.fallbackModel ?? ''].map((m) => m.trim()).filter(Boolean),
      )]
      const retries = Math.max(0, Math.min(5, Math.floor(Number(provider.maxRetries) || 0)))
      try {
        const result = await chatWithFallback(
          {
            provider,
            apiKey: currentSecrets()[provider._id] ?? '',
            messages: req.messages,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
          },
          models,
          retries,
        )
        // D-Q1 用量记录（tool）：工具经宿主能力调用模型
        recordUsage(repository, {
          providerId: provider._id,
          providerName: provider.name,
          model: result.model,
          purpose: 'tool',
          streamed: false,
          contentLength: result.content.length,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          durationMs: Date.now() - started,
          ok: true,
        })
        return result.content
      } catch (err) {
        recordUsage(repository, {
          providerId: provider._id,
          providerName: provider.name,
          model: req.model ?? provider.model,
          purpose: 'tool',
          streamed: false,
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        })
        throw err
      }
    },
    listModelsByProvider(providerId: string, apiKey?: string): Promise<string[]> {
      return listModels(
        findProvider(config, providerId),
        typeof apiKey === 'string' && apiKey ? apiKey : (currentSecrets()[providerId] ?? ''),
      )
    },
  }
}
