import { TOOL_IDS } from './constants'
import type {
  ToolCatalogPayload,
  ToolDescriptor,
  ToolOverrides,
  ToolRuntimeState,
} from './types'

/**
 * 工具注册表：全应用唯一的工具元数据真相源。
 * 主进程用它裁决可见性，渲染层只消费裁决结果（不自行判断权限，防绕过）。
 * 删除工具 = 从这里移除条目；分发裁剪 = app.distribution.includeTools 白名单。
 */
export const TOOLS: ToolDescriptor[] = [
  {
    id: TOOL_IDS.edmStudio,
    name: 'EDM Studio',
    description: '制作邮件 EDM：品牌 / 模板 / 片段 / 版本、数据填充与三阶段 HTML 生成',
    category: '邮件营销',
    icon: 'edm',
    entryRoute: 'mails',
    enabled: true,
    menus: [
      { id: 'brands', label: '品牌' },
      { id: 'templates', label: '模板' },
      { id: 'fragments', label: '片段' },
      { id: 'mails', label: '邮件' },
      {
        id: 'config',
        label: '工具配置',
        children: [
          { id: 'config-render', label: '渲染' },
          { id: 'config-export', label: '导出' },
        ],
      },
    ],
    configGroups: [
      {
        id: 'config-render',
        label: '渲染',
        fields: [
          { key: 'render.strict', label: '严格模式', type: 'boolean', hint: '未定义变量直接报错' },
          { key: 'render.autoEscape', label: 'HTML 转义', type: 'boolean', hint: '防数据注入' },
        ],
      },
      {
        id: 'config-export',
        label: '导出',
        fields: [
          { key: 'export.defaultFileName', label: '默认文件名', type: 'string', hint: '生成 EDM 时使用的文件名' },
          { key: 'export.openAfterGenerate', label: '生成后打开', type: 'boolean' },
        ],
      },
    ],
  },
  {
    id: TOOL_IDS.badgeStudio,
    name: 'Badge Studio',
    description: '上传点击统计与邮件 HTML，注入 badge 并生成海报长图',
    category: '邮件营销',
    icon: 'badge',
    entryRoute: 'generate',
    enabled: true,
    // 软依赖：可独立上传外部 HTML，但读取 EDM 产物配置时给出预警，不做硬禁用
    configDeps: [
      { toolId: TOOL_IDS.edmStudio, key: 'export.defaultStages', label: '邮件 HTML 产物阶段' },
    ],
    menus: [
      { id: 'generate', label: '生成海报' },
      { id: 'posters', label: '海报列表' },
      {
        id: 'config',
        label: '工具配置',
        children: [
          { id: 'config-badge', label: '角标' },
          { id: 'config-url', label: 'URL 归一' },
          { id: 'config-poster', label: '海报' },
        ],
      },
    ],
    configGroups: [
      {
        id: 'config-badge',
        label: '角标',
        fields: [
          { key: 'badgeAttr', label: 'badge 属性', type: 'string', hint: '注入到 HTML 的自定义属性名' },
          {
            key: 'clicksField', label: '角标数值列', type: 'select',
            options: [{ label: 'clicks', value: 'clicks' }, { label: 'totalClicks', value: 'totalClicks' }],
          },
          { key: 'posterWidth', label: '海报宽度', type: 'number', min: 320, max: 1600 },
          { key: 'scale', label: '截图像素比', type: 'number', min: 1, max: 4 },
        ],
      },
      {
        id: 'config-url',
        label: 'URL 归一',
        fields: [
          { key: 'urlNorm.stripUtm', label: '去 UTM 参数', type: 'boolean' },
          { key: 'urlNorm.stripHash', label: '去 hash', type: 'boolean' },
          { key: 'urlNorm.stripTrailingSlash', label: '去末尾斜杠', type: 'boolean' },
          { key: 'urlNorm.sortQuery', label: '查询参数排序', type: 'boolean' },
          { key: 'urlNorm.lowercaseHost', label: '域名小写', type: 'boolean' },
        ],
      },
      {
        id: 'config-poster',
        label: '海报',
        fields: [
          { key: 'commonHtmlDir', label: '常用 HTML 目录', type: 'string', hint: '留空则不启用' },
        ],
      },
    ],
  },
  {
    id: TOOL_IDS.modelConsole,
    name: 'Model Console',
    description: '配置本地 / 云 / 自部署模型，连接测试与对话调试',
    category: 'AI 能力',
    icon: 'model',
    entryRoute: 'providers',
    enabled: true,
    menus: [
      { id: 'providers', label: '模型 Provider' },
      { id: 'chat', label: '对话调试' },
      {
        id: 'config',
        label: '工具配置',
        children: [{ id: 'config-gateway', label: '网关' }],
      },
    ],
    configGroups: [
      {
        id: 'config-gateway',
        label: '网关',
        fields: [
          { key: 'defaultProviderId', label: '默认 Provider', type: 'string', hint: '填 Provider ID；留空由应用配置决定' },
          { key: 'chatTimeoutMs', label: '请求超时(ms)', type: 'number', min: 1000, max: 120000 },
          { key: 'streamEnabled', label: '启用流式输出', type: 'boolean' },
        ],
      },
    ],
  },
]

export const TOOL_GROUPS = Array.from(new Set(TOOLS.map((tool) => tool.category)))

/** 内置图标 key；自定义图标可为 http(s) URL 或 data:image URI */
export const BUILTIN_TOOL_ICONS = ['edm', 'badge', 'model'] as const

export interface ResolveCatalogInput {
  /** tools.<id>.enabled 覆盖；缺项用注册表默认值 */
  enabled: Record<string, boolean>
  /** tools.<id>.requiredGrant 覆盖；空串表示公开 */
  grants: Record<string, string>
  /** app.toolOverrides.<id> 元数据覆盖 */
  overrides: Record<string, ToolOverrides>
  /** 分发白名单；null = 全部工具 */
  includeTools: string[] | null
  /** 当前已持有的权限（由主进程用访问密钥校验得出，渲染层拿不到密钥） */
  heldGrants: string[]
  /** settings.json 中已存在的 tools.<id>，用于孤儿配置识别 */
  settingsToolIds: string[]
  hasAccessKey: boolean
}

/**
 * 单一裁决方：静态注册表 + 配置覆盖 + 分发白名单 + 权限 + 依赖链 → 可见工具。
 * 纯函数，无 Electron / Node 依赖，便于单测。
 */
export function resolveToolCatalog(input: ResolveCatalogInput): ToolCatalogPayload {
  const byId = new Map(TOOLS.map((tool) => [tool.id, tool]))
  const inDistribution = (id: string): boolean =>
    input.includeTools === null || input.includeTools.includes(id)

  const states: ToolRuntimeState[] = TOOLS.map((tool) => {
    const ov = input.overrides[tool.id] ?? {}
    const enabled = input.enabled[tool.id] ?? tool.enabled
    const requiredGrant = input.grants[tool.id] || tool.requiredGrant || ''
    let reason: string | undefined
    if (!inDistribution(tool.id)) reason = '未包含在本次分发'
    else if (!enabled) reason = '已禁用'
    else if (requiredGrant && !input.heldGrants.includes(requiredGrant)) reason = '需要访问密钥'

    const warnings = (tool.configDeps ?? []).flatMap((dep) => {
      const depTool = byId.get(dep.toolId)
      if (!depTool) return [`配置依赖的工具 ${dep.toolId} 已不存在：${dep.label}`]
      if (!inDistribution(dep.toolId) || !(input.enabled[dep.toolId] ?? depTool.enabled)) {
        return [`软依赖不可用：${depTool.name} · ${dep.label}（部分功能可能不可用）`]
      }
      return []
    })

    return {
      id: tool.id,
      name: ov.name?.trim() || tool.name,
      description: ov.description?.trim() || tool.description,
      category: ov.category?.trim() || tool.category,
      icon: ov.icon?.trim() || tool.icon,
      menus: tool.menus,
      entryRoute: tool.entryRoute,
      enabled,
      visible: !reason,
      reason,
      warnings,
      dependsOn: tool.dependsOn ?? [],
      requiredGrant: requiredGrant || undefined,
      configGroups: tool.configGroups ?? [],
      configDeps: tool.configDeps ?? [],
    }
  })

  // 硬依赖链式传播：依赖不可见时，本工具也不可见（多轮直到稳定）
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
  }
}
