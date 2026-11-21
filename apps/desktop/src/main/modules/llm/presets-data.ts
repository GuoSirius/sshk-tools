/**
 * 模型管理模块默认预设数据（P4-8b · 台账#156 · D53 应用本体边界 · C-3）：
 * 原 tools/model-console/tool.manifest.json 的 `defaults`（defaultProviders + modelPresets）
 * 随三工具包退役搬入应用本体——manifest → 数据对象语义等价，内容零改动。
 *
 * - DEFAULT_PROVIDER_SEEDS：seedDefaultProviders（main/migrations.ts）播种 `app.llm.providers`
 *   的唯一数据源（只含公开端点与模型名，绝不含密钥；密钥由用户在模型配置页填写）；
 * - MODEL_MANAGER_PRESETS：模型配置页「快速预设」数据源，经 app.modules.modelManager.modelPresets
 *   配置默认值下发（P4-8c 键迁移后渲染层 state.ts 从新前缀读取；键迁移映射见 P4-8c 提交说明）。
 */

/** 默认 Provider 播种（原 manifest defaults.defaultProviders，collectDefaultProviders 同构校验已前置保证） */
export const DEFAULT_PROVIDER_SEEDS = [
  {
    _id: 'prv_agnesai',
    name: 'Agnes AI',
    kind: 'remote' as const,
    baseURL: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-3.0-flash',
    enabled: true,
  },
] as const

/** 快速预设 7 家（原 manifest defaults.modelPresets） */
export const MODEL_MANAGER_PRESETS = [
  {
    id: 'agnes',
    name: 'Agnes AI',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    kind: 'remote' as const,
    defaultModel: 'agnes-3.0-flash',
    models: ['agnes-3.0-flash', 'agnes-3.0-pro'],
    hint: '填 API Key 即可；模型名可点「拉取模型列表」实时查询',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    kind: 'remote' as const,
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    hint: '官方 /v1 端点',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    kind: 'remote' as const,
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: 'OpenAI 兼容端点',
  },
  {
    id: 'dashscope',
    name: '通义千问（兼容模式）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    kind: 'remote' as const,
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    hint: '阿里云百炼 OpenAI 兼容模式',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    kind: 'remote' as const,
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4'],
    hint: 'OpenAI 兼容端点',
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    kind: 'local' as const,
    defaultModel: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    hint: '本机推理无需 API Key；模型列表由本机 /models 真实返回',
  },
  {
    id: 'vllm',
    name: '自部署 vLLM / LM Studio',
    baseURL: 'http://127.0.0.1:8000/v1',
    kind: 'local' as const,
    defaultModel: '',
    models: [],
    hint: '留空模型名，保存前点「拉取模型列表」自动获取',
  },
] as const
