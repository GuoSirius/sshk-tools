import type { BrowserWindow } from 'electron'
import type { LlmProvider } from '@sshk/llm-gateway'
import type {
  ToolCatalogPayload,
  ToolDescriptor,
  ToolOverrides,
  ToolPluginStatus,
} from '@sshk/shared'
import type { AppServices } from '../services'
import type { FsRuntime } from '../modules/file/runtime'

/**
 * registerIpc 各域文件共享的装配上下文（P3-1 拆分，B14/B20/O2）：
 * index.ts 在 whenReady 组装一次，各 registerXxxIpc(ctx) 只读消费；
 * 运行时回写走显式 setter（setFsRuntime），插件状态经 catalog get/set。
 */
export interface IpcContext {
  services: AppServices
  isDev: boolean
  /** SSHK_APP_AUTO_UPDATE=0 / 构建期禁用（分发定制场景）；update 域消费 */
  autoUpdateDisabled: boolean
  getMainWindow: () => BrowserWindow | null
  allManifests: () => ToolDescriptor[]
  buildCatalog: () => ToolCatalogPayload
  isToolActive: (id: string) => boolean
  assertKnownTool: (id: string) => void
  /** 渲染层直传 Provider 的 baseURL 白名单校验（llm 域） */
  readProvider: (_event: unknown, provider: LlmProvider) => LlmProvider
  readRecord: <T>(key: string) => Record<string, T>
  pickOverrides: (raw: unknown) => ToolOverrides
  isElevated: () => boolean
  getPluginStatus: () => Record<string, ToolPluginStatus>
  setPluginStatus: (next: Record<string, ToolPluginStatus>) => void
  /** fs 域创建 FsRuntime 后回写引用（before-quit 传输队列落盘用） */
  setFsRuntime: (rt: FsRuntime | null) => void
}
