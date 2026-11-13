export type ThemeMode = 'dark' | 'light' | 'system'
export type Origin = 'system' | 'custom'
export type EntityStatus = 'draft' | 'previewed' | 'generated' | 'archived'
export type DatasourceKind = 'image' | 'xlsx' | 'csv' | 'json'

/** 工具注册表条目：新增工具只需注册一条，桌面首页自动生成 */
/** 工具配置项类型：工具级配置页按 schema 自动生成表单 */
export type ToolConfigFieldType = 'boolean' | 'number' | 'string' | 'select'

export interface ToolConfigField {
  /** 相对 `tools.<toolId>` 的点路径，如 `render.strict` */
  key: string
  label: string
  type: ToolConfigFieldType
  options?: { label: string; value: string }[]
  min?: number
  max?: number
  hint?: string
}

export interface ToolConfigGroup {
  /** 与左侧二级菜单 id 对应，如 `config-render` */
  id: string
  label: string
  fields: ToolConfigField[]
}

/** 软配置依赖：本工具会读取另一个工具的配置，仅提示不做硬禁用 */
export interface ToolConfigDependency {
  toolId: string
  key: string
  label: string
}

export interface ToolDescriptor {
  id: string
  name: string
  description: string
  category: string
  /** 图标 key / URL / data URI；未配置或无效时回退系统默认图标 */
  icon: string
  entryRoute: string
  enabled: boolean
  /** 工具内左侧功能菜单（需求 8：所有菜单功能都在左侧） */
  menus: ToolMenu[]
  /** 硬依赖：依赖工具不可用时本工具一并隐藏 */
  dependsOn?: string[]
  /** 权限 grant；运行时可由 `tools.<id>.requiredGrant` 覆盖 */
  requiredGrant?: string
  /** 工具自有配置声明（左侧「工具配置」按此生成表单） */
  configGroups?: ToolConfigGroup[]
  /** 软配置依赖（只读展示 + 缺失预警） */
  configDeps?: ToolConfigDependency[]
}

export interface ToolMenu {
  /** 菜单 ID，传给工具页做视图切换 */
  id: string
  label: string
  /** 可选子菜单，支持任意层级（后台管理系统风格） */
  children?: ToolMenu[]
}

/** 工具元数据覆盖（应用级配置，便于分发定制） */
export interface ToolOverrides {
  name?: string
  description?: string
  category?: string
  icon?: string
}

/** 主进程裁决后下发给渲染层的工具状态；不含任何密钥明文 */
export interface ToolRuntimeState {
  id: string
  name: string
  description: string
  category: string
  icon: string
  menus: ToolMenu[]
  entryRoute: string
  enabled: boolean
  visible: boolean
  /** 不可见原因：已禁用 / 缺依赖 / 需密钥 / 未分发 */
  reason?: string
  /** 软依赖缺失等非致命提示 */
  warnings: string[]
  dependsOn: string[]
  requiredGrant?: string
  configGroups: ToolConfigGroup[]
  configDeps: ToolConfigDependency[]
}

export interface ToolCatalogPayload {
  tools: ToolRuntimeState[]
  orphans: string[]
  hasAccessKey: boolean
  grants: string[]
  includeTools: string[] | null
}

/** 四种上传来源统一归一后的点击统计行 */
export interface LinkStat {
  url: string
  normalizedUrl: string
  clicks: number
  totalClicks: number
  sourceFile?: string
}

/** 片段版本的可用范围策略：黑名单优先，白名单为空表示不限制 */
export interface FragmentPolicy {
  blacklist: string[]
  whitelist: string[]
}

/** 模板版本声明的槽位 */
export interface TemplateSlot {
  key: string
  type: string
  required: boolean
  multiple: boolean
  defaultFragmentVersionId?: string
  locked?: boolean
}

/** 目录迁移预检结果 */
export interface DirValidation {
  writable: boolean
  freeBytes: number
  requiredBytes: number
  isSubdirOfOld: boolean
  isSystemDir: boolean
  isNetworkDrive: boolean
  warnings: string[]
}
