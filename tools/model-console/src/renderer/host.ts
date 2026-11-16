import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：model-console 渲染层宿主代理。
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
})
