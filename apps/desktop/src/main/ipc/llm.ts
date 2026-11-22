import { chatWithFallback, healthCheck, listModels, type LlmProvider } from '@sshk/llm-gateway'
import { AppError, IPC_CHANNELS } from '@sshk/shared'
import { handleOk } from '../ipc-wrap'
import { logger } from '../logger'
import { recordUsage } from '../usage'
import type { IpcContext } from './context'

/** LLM（P3-1 registerIpc 拆分：宿主能力，工具可依赖，应用不依赖工具） */
export function registerLlmIpc(ctx: IpcContext): void {
  handleOk(IPC_CHANNELS.llmChat, (_event, provider: LlmProvider, messages: unknown, options?: { onDelta?: boolean; model?: string }) => {
    const p = ctx.readProvider(_event, provider)
    // 禁用拦截（2026-11-18）：应用级 Provider 被禁用后，即使渲染层缓存了元数据直连调用也拒绝
    const stored = ctx.services.host.listProviders().find((s) => s._id === p._id)
    if (stored && stored.enabled === false) {
      throw new AppError(`Provider「${stored.name}」已禁用，请先在「模型管理」启用后再调用`)
    }
    const apiKey = ctx.services.getApiKey(p._id)
    // 模型链优先级：options.model（工具自选）→ provider.model（默认）→ provider.fallbackModel（回退）
    const toolModel = typeof options?.model === 'string' && options.model.trim() ? options.model.trim() : ''
    const models = [...new Set([toolModel, p.model, p.fallbackModel ?? ''].map((m) => m.trim()).filter(Boolean))]
    const retries = Math.max(0, Math.min(5, Math.floor(Number(p.maxRetries) || 0)))
    // H3-3 埋点：chat 开始/完成/失败（模型链 + 耗时，不含任何密钥）
    const started = Date.now()
    let chunkNo = 0
    let lastAt = 0
    logger.info('llm', `chat start models=${models.join('→')}${options?.onDelta ? '（流式）' : ''}${retries ? ` retries=${retries}` : ''}`)
    const streaming = Boolean(options?.onDelta) && Boolean(ctx.getMainWindow())
    const call = chatWithFallback(
      {
        provider: p,
        apiKey,
        messages: messages as never,
        // D-V3-1：delta 到达埋点（chunk 序号/大小/间隔），dev 控制台 + 日志落盘，
        // 用于核查「一下子输出」是端点聚合大分片还是非流式整包
        ...(streaming
          ? {
              onDelta: (delta: string) => {
                const at = Date.now()
                chunkNo++
                const gap = lastAt ? at - lastAt : 0
                logger.debug('llm', `chunk#${chunkNo} size=${delta.length} gap=${gap}ms`)
                if (ctx.isDev) console.log(`[llm] chunk#${chunkNo} size=${delta.length} gap=${gap}ms`)
                lastAt = at
                ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.llmChat, { delta })
              },
            }
          : {}),
      },
      models,
      retries,
    )
    return call.then(
      (res) => {
        logger.info('llm', `chat done ${Date.now() - started}ms`)
        // D-Q1 用量记录（console 调试）：流式无 usage 时按内容长度估算 completion tokens
        recordUsage(ctx.services.repository, {
          providerId: p._id,
          providerName: p.name,
          model: res.model,
          purpose: 'console',
          streamed: Boolean(options?.onDelta) && res.streamed !== false,
          contentLength: res.content.length,
          promptTokens: res.usage?.promptTokens,
          completionTokens: res.usage?.completionTokens,
          durationMs: Date.now() - started,
          ok: true,
        })
        return res
      },
      (err) => {
        logger.error('llm', `chat failed：${(err as Error).message}`)
        recordUsage(ctx.services.repository, {
          providerId: p._id,
          providerName: p.name,
          model: models[0] ?? p.model,
          purpose: 'console',
          streamed: Boolean(options?.onDelta),
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        })
        throw err
      },
    )
  })
  // 渲染层可临时带 apiKey 做「保存前探测」；不传则读 safeStorage 中已存的密钥。
  // 临时 key 只在这一次 IPC 里使用，不落盘、不进配置。
  handleOk(IPC_CHANNELS.llmListModels, (_event, provider: LlmProvider, apiKey?: string) =>
    listModels(
      ctx.readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : ctx.services.getApiKey(provider?._id ?? ''),
    ))
  handleOk(IPC_CHANNELS.llmHealthCheck, (_event, provider: LlmProvider, apiKey?: string) =>
    healthCheck(
      ctx.readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : ctx.services.getApiKey(provider?._id ?? ''),
    ))
  handleOk(IPC_CHANNELS.llmSetApiKey, async (_event, providerId: string, apiKey: string) => {
    // F-02（2026-11-22 复核）：await 密钥落盘成功才返回——此前 fire-and-forget，失败被静默吞掉
    await ctx.services.setApiKey(providerId, String(apiKey ?? ''))
    return true
  })
  // 编辑时按需查看已存密钥：用户主动点击才下发，绝不随列表默认下发
  handleOk(IPC_CHANNELS.llmGetApiKey, async (_event, providerId: string) => {
    await ctx.services.ensureSecrets()
    return ctx.services.getApiKey(String(providerId ?? ''))
  })
  // 应用级 Provider 共享：所有工具列同一份清单、按 id 复用密钥，禁止各自重复配置
  handleOk(IPC_CHANNELS.llmProviders, () => ctx.services.host.listProviders())
  handleOk(IPC_CHANNELS.llmProviderModels, (_event, providerId: string, apiKey?: string) =>
    ctx.services.host.listModelsByProvider(
      String(providerId ?? ''),
      typeof apiKey === 'string' && apiKey ? apiKey : undefined,
    ))
}
