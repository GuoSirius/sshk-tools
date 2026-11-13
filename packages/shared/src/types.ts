export type ThemeMode = 'dark' | 'light' | 'system'
export type Origin = 'system' | 'custom'
export type EntityStatus = 'draft' | 'previewed' | 'generated' | 'archived'
export type DatasourceKind = 'image' | 'xlsx' | 'csv' | 'json'

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

/** 插件入口声明：路径相对工具包根目录，由宿主构建期自动发现 */
export interface ToolPluginDescriptor {
  /** 主进程 IPC 注册入口（可选；缺省表示只消费宿主能力） */
  main?: string
  /** 渲染层页面入口（可选） */
  renderer?: string
  /** 该工具专属 IPC 通道，插件加载失败时宿主注册统一拒绝 handler */
  channels?: string[]
  /** builtin = 随仓库分发；external = 后期由第三方开发并导入 */
  source?: 'builtin' | 'external'
}

/** 视觉模型消息内容：纯文本或 OpenAI 兼容多模态分片 */
export type ToolVisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolVisionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ToolVisionContentPart[]
}

export interface ToolHostChatRequest {
  baseURL: string
  model: string
  messages: ToolVisionMessage[]
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

/**
 * 宿主提供给工具插件的能力（工具可依赖应用，应用不强依赖工具）：
 * 密钥存 safeStorage、云端视觉 chat、本机 OCR 命令。
 */
export interface ToolHostCapabilities {
  /** 工具专属密钥；永不进入 settings.json / 渲染层 */
  getToolSecret(toolId: string, name: string): string
  setToolSecret(toolId: string, name: string, value: string): void
  /** OpenAI 兼容 /chat/completions，支持 image_url 多模态；返回文本 */
  chat(req: ToolHostChatRequest): Promise<string>
  /** 本机 OCR（PaddleOCR 等）：无 shell、带超时，stdout 作为识别文本返回 */
  runLocalOcr(req: { command: string; args: string[]; imagePath: string; timeoutMs?: number }): Promise<string>
}

export interface ToolDescriptor {
  id: string
  name: string
  description: string
  /** 主分类；一个工具可跨属多类，直接写数组即可 */
  category: string | string[]
  /** 附加标签，与 category 合并为 categories[] */
  tags?: string[]
  /** `auto` = 用工具包内 assets/icon.svg；也可填 http(s) URL / data URI / 内置 key */
  icon: string
  entryRoute: string
  enabled: boolean
  /** 工具内左侧功能菜单（需求 8：所有菜单功能都在左侧） */
  menus: ToolMenu[]
  /**
   * 工具配置布局（三选一，由工具包按复杂度决定）：
   * single = 一页卡片（默认，简单配置）；tabs = 内容区分页；menu = 左侧子菜单逐页
   */
  configLayout?: 'single' | 'tabs' | 'menu'
  /** 插件入口声明（宿主按此清单加载） */
  plugin?: ToolPluginDescriptor
  /** 硬依赖：依赖工具不可用时本工具一并隐藏；运行时可由配置覆盖 */
  dependsOn?: string[]
  /** 权限 grant；运行时可由 `tools.<id>.requiredGrant` 覆盖 */
  requiredGrant?: string
  /** 工具自有配置声明（左侧「工具配置」按此生成表单） */
  configGroups?: ToolConfigGroup[]
  /** 软配置依赖（只读展示 + 缺失预警）；默认工具之间零依赖 */
  configDeps?: ToolConfigDependency[]
  /** 工具自带的默认配置，宿主启动时自动合并进 settings.json 默认值 */
  defaults?: Record<string, unknown>
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
  /** 逗号分隔字符串或数组；覆盖后作为该工具的全部分类 */
  category?: string | string[]
  icon?: string
}

/** 主进程插件加载结果：单个插件失败不影响宿主与其它工具 */
export interface ToolPluginStatus {
  loaded: boolean
  error?: string
}

/** 主进程裁决后下发给渲染层的工具状态；不含任何密钥明文 */
export interface ToolRuntimeState {
  id: string
  name: string
  description: string
  /** 主分类（首个），兼容既有展示 */
  category: string
  /** 全部分类 / 标签（category + tags 去重），卡片与搜索用 */
  categories: string[]
  icon: string
  menus: ToolMenu[]
  entryRoute: string
  configLayout: 'single' | 'tabs' | 'menu'
  enabled: boolean
  visible: boolean
  /** 插件是否成功加载（加载失败只影响本工具） */
  available: boolean
  pluginError?: string
  /** 不可见原因：已禁用 / 缺依赖 / 需密钥 / 未分发 / 插件加载失败 */
  reason?: string
  /** 非致命提示 */
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
  pluginStatus: Record<string, ToolPluginStatus>
}

export type SettingsShape = Record<string, Record<string, unknown>>

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
