import type { IpcMain } from 'electron'
import {
  IPC_CHANNELS,
  type ToolDescriptor,
  type ToolHostCapabilities,
  type ToolPluginStatus,
} from '@sshk/shared'
import type { Repository } from '@sshk/repository'
import { MAIN_LOADERS, MANIFESTS } from './discovery'

/** 宿主注入给插件的能力集合（工具可依赖应用） */
export interface PluginDeps {
  repository: Repository
  outputRoot: string
  host: ToolHostCapabilities
}

/** 插件 main 入口契约：必须默认导出（或具名 register）一个注册函数 */
type RegisterFn = (ipcMain: IpcMain, deps: PluginDeps) => void

export interface PluginHost {
  ipcMain: IpcMain
  repository: Repository
  outputRoot: string
  host: ToolHostCapabilities
  /** 每次 IPC 调用时实时裁决：禁用 / 缺依赖 / 缺权限的工具拒绝服务 */
  isActive: (toolId: string) => boolean
}

const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC_CHANNELS))

/** 给插件的 ipcMain 代理：每次调用都校验工具当前是否可用 */
function guardedIpcMain(ipcMain: IpcMain, toolId: string, isActive: (id: string) => boolean): IpcMain {
  const guard = {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      ipcMain.handle(channel, async (...args: unknown[]) => {
        if (!isActive(toolId)) {
          throw new Error(`工具「${toolId}」当前不可用（已禁用 / 缺依赖 / 缺权限 / 插件未加载）`)
        }
        return (handler as (...a: unknown[]) => unknown)(...args)
      }),
  }
  return guard as unknown as IpcMain
}

/** 插件加载失败时注册明确拒绝 handler，避免 Electron 的 "No handler registered" */
function rejectAll(ipcMain: IpcMain, tool: ToolDescriptor, message: string): void {
  for (const channel of tool.plugin?.channels ?? []) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      console.warn(`[sshk] 工具 ${tool.id} 声明了非白名单通道 ${channel}，已忽略`)
      continue
    }
    try {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => { throw new Error(message) })
    } catch (err) {
      console.warn(`[sshk] 工具 ${tool.id} 通道 ${channel} 拒绝 handler 注册失败：`, err)
    }
  }
}

/**
 * 按清单逐个加载插件，任一插件失败只影响它自己：
 * - 不抛错、不中断宿主启动
 * - 该工具标记 loaded=false（桌面隐藏并给出原因）
 * - 它的专属通道注册明确拒绝 handler，其它工具照常工作
 */
export async function loadToolPlugins(
  host: PluginHost,
  tools: ToolDescriptor[] = MANIFESTS,
): Promise<Record<string, ToolPluginStatus>> {
  const status: Record<string, ToolPluginStatus> = {}
  for (const tool of tools) {
    if (!tool.plugin?.main) {
      // 无 main 入口的工具只消费宿主能力（如 model-console 用 llm/* IPC）
      status[tool.id] = { loaded: true }
      continue
    }
    try {
      const loader = MAIN_LOADERS[tool.id]
      if (!loader) throw new Error('清单声明了 main 入口，但未找到约定的 src/main/index.ts')
      const mod = await loader() as Record<string, unknown>
      // 不再「随便挑一个函数」：曾误挑 parseDatasource 导致 IPC 一个都没注册，
      // 现在只认明确的 default / register 导出，契约不清晰就判加载失败。
      const candidate = mod['default'] ?? mod['register']
      if (typeof candidate !== 'function') {
        throw new Error(`插件 main 入口 ${tool.plugin?.main ?? ''} 未默认导出注册函数`)
      }
      ;(candidate as RegisterFn)(guardedIpcMain(host.ipcMain, tool.id, host.isActive), {
        repository: host.repository,
        outputRoot: host.outputRoot,
        host: host.host,
      })
      status[tool.id] = { loaded: true }
    } catch (err) {
      const message = (err as Error).message
      status[tool.id] = { loaded: false, error: message }
      console.warn(`[sshk] 插件 ${tool.id} 加载失败（不影响其它工具）：`, message)
      rejectAll(host.ipcMain, tool, `插件「${tool.id}」加载失败：${message}`)
    }
  }
  return status
}
