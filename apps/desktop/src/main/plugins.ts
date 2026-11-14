import type { IpcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type ToolDescriptor,
  type ToolHostCapabilities,
  type ToolPluginStatus,
} from '@sshk/shared'
import type { Repository } from '@sshk/repository'
import { MAIN_LOADERS, MANIFESTS } from './discovery'
import { readInstalled, runtimeRoot } from './runtime-installer.js'
import type { UtilityInstance } from './utility-host.js'

/** 宿主注入给插件的能力集合（工具可依赖应用）；toolId 来自 manifest，工具内不再硬编码 */
export interface PluginDeps {
  /** 与 tool.manifest.json 的 id 一致，由宿主传入（密钥标识等场景使用） */
  toolId: string
  repository: Repository
  outputRoot: string
  host: ToolHostCapabilities
}

/**
 * 内置插件 main 入口契约：默认导出 (ipcMain, deps) => void。
 * 这是历史约定（工具包 src/main/index.ts），保持不动。
 */
type BuiltinRegisterFn = (ipcMain: IpcMain, deps: PluginDeps) => void

/**
 * 外部包（运行时安装）main 入口契约：默认导出 (deps) => void，
 * deps 内携带 ipcMain（伪 ipcMain / guardedIpcMain 皆可）。
 * 与内置契约刻意不同——沙箱子进程的伪 ipcMain 通过父进程转发渲染层调用，
 * 因此外部包统一收口为「单参 deps + 内嵌 ipcMain」。主进程内加载的可信包
 *（sandbox=main）也复用同一套外部契约，保证同一份 main 在两种加载方式下都可用。
 */
type ExternalRegisterFn = (deps: {
  toolId: string
  packageDir: string
  ipcMain: IpcMain
  outputRoot: string
  repository: Repository
  host: ToolHostCapabilities
}) => void

export interface PluginHost {
  ipcMain: IpcMain
  repository: Repository
  outputRoot: string
  host: ToolHostCapabilities
  /** 每次 IPC 调用时实时裁决：禁用 / 缺依赖 / 缺权限的工具拒绝服务 */
  isActive: (toolId: string) => boolean
}

/** 宿主能力转发白名单：沙箱子进程 host.<method>(...) 的落地方法集合 */
const ALLOWED_HOST_METHODS = new Set<keyof ToolHostCapabilities>([
  'getToolSecret',
  'setToolSecret',
  'chat',
  'listProviders',
  'chatByProvider',
  'listModelsByProvider',
  'runLocalOcr',
])

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
    try {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => { throw new Error(message) })
    } catch (err) {
      console.warn(`[sshk] 工具 ${tool.id} 通道 ${channel} 拒绝 handler 注册失败：`, err)
    }
  }
}

/**
 * 宿主能力转发（沙箱子进程 host 扁平代理的落地）：仅放行 ToolHostCapabilities
 * 约定的 7 个方法，其余一律拒绝（防提权）。方法名来自子进程 host.<method>() 的代理。
 */
function forwardHost(host: ToolHostCapabilities, method: string, args: unknown[]): Promise<unknown> {
  if (!ALLOWED_HOST_METHODS.has(method as keyof ToolHostCapabilities)) {
    return Promise.reject(new Error(`不允许的宿主能力调用：${method}`))
  }
  const fn = host[method as keyof ToolHostCapabilities]
  if (typeof fn !== 'function') {
    return Promise.reject(new Error(`宿主能力 ${method} 不存在`))
  }
  return Promise.resolve((fn as (...a: unknown[]) => unknown)(...args))
}

/**
 * 加载已安装运行时包的外部 main 到独立 utilityProcess（sandbox=utility）。
 * entryPath 固定指向构建产物 out/main/utility-host-entry.mjs（与 index.mjs 同目录）。
 * 子进程注册新通道时（onRegister），在真实 ipcMain 上建一个转发 handler，
 * 每次调用先经 host.isActive 裁决，再通过 instance.call 投递到沙箱执行。
 */
async function forkRuntime(
  tool: ToolDescriptor,
  host: PluginHost,
  packageDir: string,
  mainFile: string,
  instances: Map<string, UtilityInstance>,
): Promise<void> {
  // 本文件随 index.mjs 一同落在 out/main/，故 entryPath 用 __dirname 等价物推导
  const entryPath = join(dirname(fileURLToPath(import.meta.url)), 'utility-host-entry.mjs')
  const { forkUtilityTool } = await import('./utility-host.js')
  const instance = forkUtilityTool({
    entryPath,
    toolId: tool.id,
    packageDir,
    mainFile,
    // 扁平 host 代理落地：直接派发到真实宿主能力（白名单已在 forwardHost 内强制）
    forward: (method, args) => forwardHost(host.host, method, args),
    onRegister: (channel) => {
      // 强制 IPC 白名单：外部包只允许注册 manifest 里声明的通道
      if (tool.plugin?.channels && !tool.plugin.channels.includes(channel)) {
        console.warn(`[sshk] 工具 ${tool.id} 试图注册未授权通道 ${channel}，已忽略`)
        return
      }
      try {
        host.ipcMain.removeHandler(channel)
        host.ipcMain.handle(channel, async (...args: unknown[]) => {
          if (!host.isActive(tool.id)) {
            throw new Error(`工具「${tool.id}」当前不可用（已禁用 / 缺依赖 / 缺权限 / 插件未加载）`)
          }
          return instance.call(channel, args)
        })
      } catch (err) {
        console.warn(`[sshk] 工具 ${tool.id} 通道 ${channel} 转发 handler 注册失败：`, err)
      }
    },
  })
  instances.set(tool.id, instance)
}

/**
 * 主进程内加载已签名+信任的外部 main（sandbox=main）：
 * 用 guardedIpcMain 包裹真实 ipcMain，与沙箱子进程共用同一套「单参 deps + 内嵌 ipcMain」外部契约。
 */
function loadExternalInMain(
  tool: ToolDescriptor,
  host: PluginHost,
  packageDir: string,
  mainFile: string,
): Promise<void> {
  return import(pathToFileURL(mainFile).href).then((mod) => {
    const candidate = (mod as Record<string, unknown>)['default'] ?? (mod as Record<string, unknown>)['register']
    if (typeof candidate !== 'function') {
      throw new Error(`外部 main 入口 ${mainFile} 未默认导出注册函数`)
    }
    ;(candidate as ExternalRegisterFn)({
      toolId: tool.id,
      packageDir,
      ipcMain: guardedIpcMain(host.ipcMain, tool.id, host.isActive),
      outputRoot: host.outputRoot,
      repository: host.repository,
      host: host.host,
    })
  })
}

/** 模块级：utilityProcess 实例，便于退出时统一 kill / 工具失活时回收 */
const utilityInstances = new Map<string, UtilityInstance>()

/** 退出应用时清理所有沙箱子进程（由 index.ts 在 before-quit 调用） */
export function killUtilityTools(): void {
  for (const inst of utilityInstances.values()) inst.kill()
  utilityInstances.clear()
}

/**
 * 按清单逐个加载插件，任一插件失败只影响它自己：
 * - 不抛错、不中断宿主启动
 * - 该工具标记 loaded=false（桌面隐藏并给出原因）
 * - 它的专属通道注册明确拒绝 handler，其它工具照常工作
 *
 * 加载策略（同 id 冲突一律源码优先）：
 * - 无 plugin.main：只消费宿主能力（如 model-console 用 llm/* IPC）
 * - 内置工具（有 MAIN_LOADERS）：一律走构建期入口，不被安装副本覆盖——dev 迭代已安装的
 *   外部包时始终消费 tools/ 源码、实时生效；沙箱/权限语义与打包版一致
 * - 已安装运行时包（readInstalled 有记录）：按 sandbox 选 utility 沙箱 或 主进程内加载
 * - 声明了 main 但既无内置入口也无安装记录的运行时包：跳过（未安装，不报错）
 *
 * @param opts.userDataDir 传入后才会尝试加载已安装的运行时包（utility / main 沙箱）。
 */
export async function loadToolPlugins(
  host: PluginHost,
  tools: ToolDescriptor[] = MANIFESTS,
  opts?: { userDataDir?: string },
): Promise<Record<string, ToolPluginStatus>> {
  const status: Record<string, ToolPluginStatus> = {}

  // 已安装运行时包记录（按 id 索引）；内置工具不在此表中
  const installed = opts?.userDataDir ? readInstalled({ userDataDir: opts.userDataDir }) : {}
  // 运行时安装根目录：<userDataDir>/runtime-tools
  const root = opts?.userDataDir ? runtimeRoot({ userDataDir: opts.userDataDir }) : ''

  for (const tool of tools) {
    if (!tool.plugin?.main) {
      // 无 main 入口的工具只消费宿主能力（如 model-console 用 llm/* IPC）
      status[tool.id] = { loaded: true }
      continue
    }
    const record = installed[tool.id]
    const builtinLoader = MAIN_LOADERS[tool.id]
    try {
      if (builtinLoader) {
        // 内置工具（构建期发现，有 MAIN_LOADERS）：源码优先，安装副本存在也不消费
        const mod = (await builtinLoader()) as Record<string, unknown>
        // 只认明确的 default / register 导出，契约不清晰就判加载失败。
        const candidate = mod['default'] ?? mod['register']
        if (typeof candidate !== 'function') {
          throw new Error(`插件 main 入口 ${tool.plugin?.main ?? ''} 未默认导出注册函数`)
        }
        ;(candidate as BuiltinRegisterFn)(guardedIpcMain(host.ipcMain, tool.id, host.isActive), {
          toolId: tool.id,
          repository: host.repository,
          outputRoot: host.outputRoot,
          host: host.host,
        })
      } else if (record) {
        // 运行时已安装外部包：按 sandbox 选择加载方式
        const packageDir = join(root, 'packages', record.id, record.version)
        const mainFile = join(packageDir, tool.plugin.main)
        if (record.sandbox === 'utility') {
          // 沙箱子进程：异步 fork，注册通道后由 onRegister 建转发 handler
          await forkRuntime(tool, host, packageDir, mainFile, utilityInstances)
        } else {
          // sandbox=main：签名+信任，主进程内直接加载外部 main
          await loadExternalInMain(tool, host, packageDir, mainFile)
        }
      } else {
        // 运行时工具声明了 main 但本地未安装：跳过，不报错（渲染层随安装状态裁决可见性）
        status[tool.id] = { loaded: true }
        continue
      }
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
