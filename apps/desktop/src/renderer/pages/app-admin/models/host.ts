import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：模型管理模块（原 model-console 工具，P4-8 随迁应用本体）渲染层宿主代理。
 * 事件订阅类（llm.onDelta）不登记、直通具名方法。
 */
export const host = createSafeHost({
  config: { get: C.configGet, set: C.configSet },
  llm: {
    chat: C.llmChat,
    listModels: C.llmListModels,
    healthCheck: C.llmHealthCheck,
    setApiKey: C.llmSetApiKey,
    getApiKey: C.llmGetApiKey,
    providers: C.llmProviders,
    providerModels: C.llmProviderModels,
  },
  usage: {
    stats: C.usageStats,
    clear: C.usageClear,
  },
  os: { pickSave: C.osPickSave, writeText: C.osWriteText },
})
