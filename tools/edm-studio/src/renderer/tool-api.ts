import { ElMessageBox } from 'element-plus'

/** EDM 工具内类型与通道封装（各页面通用；Q-2 收敛：原 tool-store.ts 更名——它只做 API/类型封装、不持有状态，避免与 store.ts 双 store 混淆） */
export interface Named { _id: string; name: string; [k: string]: unknown }
export interface BrandRow extends Named { code: string }
export interface VersionRow extends Named { version: number; label?: string; type?: string; source?: { html: string; css?: string; cssMode?: string }; templateId?: string; fragmentId?: string; slots?: { key: string; type: string }[]; policy?: { blacklist: string[]; whitelist: string[] }; sampleData?: Record<string, unknown>; fields?: unknown[] }
export interface PlacementRow { slot: string; fragmentVersionId: string; order?: number; repeat?: number; data?: Record<string, unknown> }
export interface MailRow extends Named { origin?: 'system' | 'custom'; brandId: string; templateVersionId: string; bindings?: PlacementRow[]; outputs?: Record<string, string>; lastGeneratedAt?: string; data?: Record<string, unknown> }

/**
 * window.api 由桌面端 preload 注入（全局类型声明在 apps/desktop env.d.ts）。
 * edm-studio 独立 tsc 不引入桌面端 env.d.ts，这里做**本地类型化**：
 * 不全局扩充 Window（避免与桌面端 interface Window 声明合并冲突），仅局部断言。
 */
interface SshkOsApi {
  clipboardWrite(text: string): Promise<unknown>
  shellOpen(target: string): Promise<unknown>
  pickSave(opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }): Promise<string>
}
interface SshkLlmApi {
  providers(): Promise<LlmProviderLite[]>
  chat(provider: unknown, messages: { role: 'system' | 'user' | 'assistant'; content: string }[], options?: { onDelta?: boolean; model?: string }): Promise<{ content: string; model: string }>
}
/** 应用级配置读写（工具级配置键 tools.<toolId>.* 与应用键 app.* 均经此通道）；onChanged=主进程广播订阅 */
interface SshkConfigApi {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<boolean>
  onChanged(callback: (payload: { namespace: string; key: string }) => void): () => void
}
/** D-Q2 AI 文案助手用的 Provider 只读视图（不含密钥） */
export interface LlmProviderLite {
  _id: string
  name: string
  kind: string
  baseURL: string
  model: string
  enabled: boolean
  hasApiKey: boolean
}
interface SshkApi {
  edm: { api(action: string, data?: Record<string, unknown>): Promise<unknown> }
  os: SshkOsApi
  llm: SshkLlmApi
  config: SshkConfigApi
}
function sshkApi(): SshkApi {
  return (window as unknown as { api: SshkApi }).api
}
export const api = <T = unknown>(action: string, data?: Record<string, unknown>): Promise<T> =>
  sshkApi().edm.api(action, data) as Promise<T>
/** os 通道（剪贴板 / 打开产物 / 导出另存为，MailsPage 用） */
export const osApi = (): SshkOsApi => sshkApi().os
/** llm 通道（D-Q2 AI 文案助手：应用级 Provider 清单 + 按能力调用 chat） */
export const llmApi = (): SshkLlmApi => sshkApi().llm
/** config 通道（EDM 工具级 AI Provider/模型覆盖：tools.edm-studio.ai.*） */
export const configApi = (): SshkConfigApi => sshkApi().config
/** 配置变更订阅（开发者模式开关等应用键变更即时刷新本工具门控） */
export const configOnChanged = (callback: (payload: { namespace: string; key: string }) => void): (() => void) =>
  sshkApi().config.onChanged(callback)
/** EDM 工具级 AI 配置键（manifest configGroups 声明，SettingsPage 渲染） */
export const AI_PROVIDER_KEY = 'tools.edm-studio.ai.providerId'
export const AI_MODEL_KEY = 'tools.edm-studio.ai.model'

/** 系统内容（R8 播种，origin='system'）只读：编辑/删除不可用，派生走「另存为」 */
export function isSystem(row: Named): boolean {
  return row.origin === 'system'
}

/** 统一删除确认（危险操作二次确认） */
export async function confirmRemove(title: string, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除「${name}」？记录将归档。`, title, { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
  } catch {
    return
  }
  await run()
}
