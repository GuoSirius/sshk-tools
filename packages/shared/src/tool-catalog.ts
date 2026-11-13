import type {
  SettingsShape,
  ToolCatalogPayload,
  ToolDescriptor,
  ToolOverrides,
  ToolPluginStatus,
  ToolRuntimeState,
} from './types'

/**
 * 工具插件契约（纯函数层）。
 *
 * 真相源在各工具包自己的 `tools/<id>/tool.manifest.json`，宿主构建期自动发现后
 * 把清单传进来。这里不持有任何具体工具数据 —— 应用不强依赖工具，工具可依赖应用。
 * 新工具包放进 tools/ 后无需改宿主代码即可接入（D37 / D41）。
 */
export interface ResolveCatalogInput {
  /** tools.<id>.enabled 覆盖；缺项用清单默认值 */
  enabled: Record<string, boolean>
  /** tools.<id>.requiredGrant 覆盖；空串表示公开 */
  grants: Record<string, string>
  /** tools.<id>.dependsOn 覆盖；缺省用清单（默认零依赖） */
  dependsOn: Record<string, string[]>
  /** app.toolOverrides.<id> 元数据覆盖 */
  overrides: Record<string, ToolOverrides>
  /** 分发白名单；null = 全部工具 */
  includeTools: string[] | null
  /** 主进程用访问密钥校验得出的 grants，渲染层拿不到密钥 */
  heldGrants: string[]
  /** settings.json 中已存在的 tools.<id>，用于孤儿配置识别 */
  settingsToolIds: string[]
  /** 插件加载状态：loaded=false 只让该工具不可用 */
  pluginStatus: Record<string, ToolPluginStatus>
  hasAccessKey: boolean
}

/** 工具默认配置合并：清单自带 defaults，宿主无需为新工具改 DEFAULT_SETTINGS */
export function mergeToolDefaults(base: SettingsShape, tools: ToolDescriptor[]): SettingsShape {
  const out: SettingsShape = structuredClone(base)
  out.tools = out.tools ?? {}
  for (const tool of tools) {
    out.tools[tool.id] = {
      enabled: true,
      requiredGrant: '',
      dependsOn: [],
      ...(out.tools[tool.id] ?? {}),
      ...(tool.defaults ?? {}),
    } as Record<string, unknown>
  }
  return out
}

/** 逗号 / 顿号 / 分号都算分类分隔符，去重去空白 */
function splitCategories(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、;；]/)
      : []
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean)))
}

/** 一个工具的全部分类 = category（可数组）+ tags 去重 */
export function toolCategories(tool: ToolDescriptor): string[] {
  return Array.from(new Set([
    ...splitCategories(tool.category),
    ...splitCategories(tool.tags),
  ]))
}

/** 全部分类标签（桌面筛选 / 分组用），扁平去重 */
export function toolGroups(tools: ToolDescriptor[]): string[] {
  return Array.from(new Set(tools.flatMap((tool) => toolCategories(tool))))
}

/**
 * 单一裁决方：插件清单 + 配置覆盖 + 分发白名单 + 插件可用性 + 权限 + 依赖链。
 * 纯函数，无 Electron / Node / 具体工具数据依赖，便于单测。
 */
export function resolveToolCatalog(
  tools: ToolDescriptor[],
  input: ResolveCatalogInput,
): ToolCatalogPayload {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const inDistribution = (id: string): boolean =>
    input.includeTools === null || input.includeTools.includes(id)

  const states: ToolRuntimeState[] = tools.map((tool) => {
    const ov = input.overrides[tool.id] ?? {}
    const enabled = input.enabled[tool.id] ?? tool.enabled
    const requiredGrant = input.grants[tool.id] || tool.requiredGrant || ''
    const dependsOn = input.dependsOn[tool.id] ?? tool.dependsOn ?? []
    const plugin = input.pluginStatus[tool.id]
    const available = plugin ? plugin.loaded : true

    let reason: string | undefined
    if (!inDistribution(tool.id)) reason = '未包含在本次分发'
    else if (!available) reason = `插件加载失败：${plugin?.error ?? '未知原因'}`
    else if (!enabled) reason = '已禁用'
    else if (requiredGrant && !input.heldGrants.includes(requiredGrant)) reason = '需要访问密钥'

    // 软配置依赖（清单默认不声明）只预警，不硬隐藏
    const warnings = (tool.configDeps ?? []).flatMap((dep) => {
      const depTool = byId.get(dep.toolId)
      if (!depTool) return [`配置依赖的工具 ${dep.toolId} 已不存在：${dep.label}`]
      if (!inDistribution(dep.toolId) || !(input.enabled[dep.toolId] ?? depTool.enabled)) {
        return [`软依赖不可用：${depTool.name} · ${dep.label}（部分功能可能不可用）`]
      }
      return []
    })

    // 覆盖值优先；未覆盖时取清单 category + tags
    const overridden = splitCategories(ov.category)
    const categories = overridden.length > 0 ? overridden : toolCategories(tool)
    return {
      id: tool.id,
      name: ov.name?.trim() || tool.name,
      description: ov.description?.trim() || tool.description,
      category: categories[0] ?? '',
      categories,
      icon: ov.icon?.trim() || tool.icon,
      menus: tool.menus,
      entryRoute: tool.entryRoute,
      configLayout: tool.configLayout ?? 'single',
      enabled,
      visible: !reason,
      available,
      pluginError: plugin?.error,
      reason,
      warnings,
      dependsOn,
      requiredGrant: requiredGrant || undefined,
      configGroups: tool.configGroups ?? [],
      configDeps: tool.configDeps ?? [],
    }
  })

  // 硬依赖链式传播：依赖不可见时本工具也不可见（多轮直到稳定）
  for (let round = 0; round < states.length; round += 1) {
    let changed = false
    for (const state of states) {
      if (!state.visible) continue
      const missing = state.dependsOn.filter((id) => {
        const dep = states.find((item) => item.id === id)
        return !dep || !dep.visible || !inDistribution(id)
      })
      if (missing.length > 0) {
        state.visible = false
        state.reason = `依赖不可用：${missing.join('、')}`
        changed = true
      }
    }
    if (!changed) break
  }

  return {
    tools: states,
    orphans: input.settingsToolIds.filter((id) => !byId.has(id)),
    hasAccessKey: input.hasAccessKey,
    grants: input.heldGrants,
    includeTools: input.includeTools,
    pluginStatus: input.pluginStatus,
  }
}
