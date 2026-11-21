import { execSync } from 'node:child_process'
import { app } from 'electron'
import {
  AppError,
  SSHK_DEV,
  isDevFeaturesEnabled,
  resolveToolCatalog,
  type ToolCatalogPayload,
  type ToolDescriptor,
  type ToolOverrides,
  type ToolPluginStatus,
} from '@sshk/shared'
import type { LlmProvider } from '@sshk/llm-gateway'
import { MANIFESTS, PULLED_IN_TOOLS } from './discovery'
import { loadRuntimeManifests } from './runtime-installer'
import type { AppServices } from './services'

/**
 * 工具目录裁决（P3-1 自 index.ts 拆出）：
 * 构建期清单 + 运行时安装清单 + 配置覆盖 + 分发 + 插件状态 + 权限 + 依赖链。
 * 渲染层只能拿到裁决结果，拿不到密钥明文，也无法自行放开受限工具。
 */

let services: AppServices | null = null
/** 插件加载结果：单个插件失败不影响宿主与其它工具 */
let pluginStatus: Record<string, ToolPluginStatus> = {}

/** whenReady 装配时注入 services（buildCatalog/readRecord 依赖） */
export function setupCatalog(svc: AppServices): void {
  services = svc
}

export function getPluginStatus(): Record<string, ToolPluginStatus> {
  return pluginStatus
}

export function setPluginStatus(next: Record<string, ToolPluginStatus>): void {
  pluginStatus = next
}

/** 构建期内置清单 + 运行时已安装包清单，统一参与目录裁决。
 *  同 id 冲突一律 tools/ 源码优先、安装副本仅补位：内建工具不可被外部安装覆盖（既定规则），
 *  dev 迭代已安装的外部包时也因此始终消费源码、实时生效（安装记录保留但不消费）。 */
export function allManifests(): ToolDescriptor[] {
  const runtime = loadRuntimeManifests({ userDataDir: app.getPath('userData'), importedKeys: [] })
  for (const problem of runtime.problems) console.warn('[sshk] 运行时工具包：', problem)
  const builtinIds = new Set(MANIFESTS.map((m) => m.id))
  return [...MANIFESTS, ...runtime.manifests.filter((m) => !builtinIds.has(m.id))]
}

export function assertKnownTool(id: string): void {
  if (!allManifests().some((tool) => tool.id === id)) throw new AppError(`未知工具: ${id}`)
}

/** Windows 是否提权运行：net session 仅管理员可成功（结果缓存，权限不会中途变化） */
let elevatedCache: boolean | null = null
export function isElevated(): boolean {
  if (process.platform !== 'win32') return false
  if (elevatedCache === null) {
    try { execSync('net session', { stdio: 'ignore' }); elevatedCache = true } catch { elevatedCache = false }
  }
  return elevatedCache
}

export function readRecord<T>(key: string): Record<string, T> {
  const raw = services!.config.get(key)
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, T>
    : {}
}

/** 只接受白名单字段，避免渲染层写入任意配置段 */
export function pickOverrides(raw: unknown): ToolOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('非法工具元数据')
  const out: ToolOverrides = {}
  for (const key of ['name', 'description', 'icon'] as const) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string') out[key] = value.slice(0, 500)
  }
  const category = (raw as Record<string, unknown>)['category']
  if (typeof category === 'string') out.category = category.slice(0, 500)
  else if (Array.isArray(category)) {
    out.category = category
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, 100))
      .slice(0, 20)
  }
  return out
}

/** 渲染层直传 Provider 的 baseURL 白名单校验（llm 域 handler 复用） */
export function readProvider(_event: unknown, provider: LlmProvider): LlmProvider {
  if (!/^https?:\/\//i.test(provider?.baseURL ?? '')) {
    throw new AppError('baseURL 必须是 http(s) 地址')
  }
  return provider
}

/** 工具目录单一裁决：构建期发现的清单 + 配置覆盖 + 分发 + 插件可用性 + 权限 + 依赖链。 */
export function buildCatalog(): ToolCatalogPayload {
  const cfg = services!.config
  const manifests = allManifests()
  const enabled: Record<string, boolean> = {}
  const grants: Record<string, string> = {}
  const dependsOn: Record<string, string[]> = {}
  for (const tool of manifests) {
    const value = cfg.get(`tools.${tool.id}.enabled`)
    enabled[tool.id] = typeof value === 'boolean' ? value : tool.enabled
    grants[tool.id] = String(cfg.get(`tools.${tool.id}.requiredGrant`) ?? '')
    const rawDeps = cfg.get(`tools.${tool.id}.dependsOn`)
    dependsOn[tool.id] = Array.isArray(rawDeps)
      ? rawDeps.filter((id): id is string =>
        typeof id === 'string' && id !== tool.id && manifests.some((t) => t.id === id))
      : (tool.dependsOn ?? [])
  }
  const rawInclude = cfg.get('app.distribution.includeTools')
  const includeTools = Array.isArray(rawInclude)
    ? rawInclude.filter((id): id is string => typeof id === 'string' && manifests.some((t) => t.id === id))
    : null
  const { hasAccessKey, grants: heldGrants } = services!.getAccessKeyState()
  return resolveToolCatalog(manifests, {
    enabled,
    grants,
    dependsOn,
    overrides: readRecord<ToolOverrides>('app.toolOverrides'),
    includeTools,
    heldGrants,
    settingsToolIds: cfg.listToolIds(),
    pluginStatus,
    // X5-A 依赖闭包拉入的工具：能力保留但任何位置强制不可见（用户 2026-11-17 定稿）
    forcedHidden: PULLED_IN_TOOLS,
    hasAccessKey,
    // D-2（P0-2）：开发者功能总开关主进程统一裁决随 payload 下发，渲染层不再散拼
    devFeatures: isDevFeaturesEnabled(SSHK_DEV, cfg.get('app.developerMode') === true),
  })
}

export function isToolActive(id: string): boolean {
  return buildCatalog().tools.find((tool) => tool.id === id)?.visible === true
}
