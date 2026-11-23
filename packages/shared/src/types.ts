export type ThemeMode = 'dark' | 'light' | 'system'
export type Origin = 'system' | 'custom'
export type EntityStatus = 'draft' | 'previewed' | 'generated' | 'archived'
export type DatasourceKind = 'image' | 'xlsx' | 'csv' | 'json'

/** 工具配置项类型：工具级配置页按 schema 自动生成表单；textarea 独占整行（plans/01） */
export type ToolConfigFieldType = 'boolean' | 'number' | 'string' | 'textarea' | 'select' | 'dir' | 'file'

export interface ToolConfigField {
  /** 必填项：配置页红星标注，保存时空值拦截 */
  required?: boolean
  /** 仅开发环境展示（协助调试的配置项，发布版隐藏但保留其值） */
  devOnly?: boolean
  /** 独占整行（plans/01 F2 全局表单规范）：长控件/路径类/大组件声明后渲染层不再凑列 */
  full?: boolean
  /** 值为空时展示该配置键的当前值（如 defaultProviderId ← app.llm.activeProviderId） */
  fallbackKey?: string
  /** 值为空时的默认值（工具配置标准姿势，2026-11-20：配置页下拉直接回显默认，不显示空白）。
   *  number 形态供数字字段（原 manifest 「"default": 50」原样；P4-8c 页内声明分组同样使用） */
  default?: string | number
  /** 相对 `tools.<toolId>` 的点路径，如 `render.strict` */
  key: string
  label: string
  type: ToolConfigFieldType
  options?: { label: string; value: string }[]
  /** 动态选项源：从宿主能力实时拉取（如全局上传 profile / 应用级 Provider 清单），避免 manifest 写死 */
  optionsSource?: 'upload:remote' | 'upload:cloud' | 'upload:all' | 'llm:providers'
  /** 代码编辑器渲染（Monaco，css 高亮）：替代裸 textarea，适合 CSS 覆盖类配置 */
  codeEditor?: boolean
  min?: number
  max?: number
  hint?: string
}

export interface ToolConfigGroup {
  /** 分组 id；形态 2 下由 configPages.groups 引用，形态 1 下可直接作为 section 定位值 */
  id: string
  label: string
  /** 可选图标（SVG path d），挂成二级菜单时显示；缺省用圆点 */
  icon?: string
  fields: ToolConfigField[]
  /** 实时预览卡片（宿主内置实现）：'badge-css' = 角标样式九宫格预览（编辑 CSS 时同步看位置/颜色效果） */
  preview?: string
}

/**
 * 形态 2 的「配置页」：一个二级菜单 = 一个真实页面，页内可放多个 configGroup。
 * id 即二级菜单 id，约定以 `config-` 开头（如 `config-model`），宿主据此识别为配置页。
 * 仅当 configLayout='menu' 时生效；形态 1（single）无需声明。
 */
export interface ToolConfigPage {
  id: string
  label: string
  /** 可选图标（SVG path d），挂成二级菜单时显示；缺省用圆点 */
  icon?: string
  /** 本页包含的分组 id（引用 configGroups[].id），可多个 */
  groups: string[]
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

/** 应用级 Provider 的只读视图：工具可以列出与选择，但拿不到任何密钥明文 */
export interface LlmProviderInfo {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  /** 默认模型名 */
  model: string
  /** 回退模型名：默认模型失败后自动回退再试，可留空 */
  fallbackModel?: string
  enabled: boolean
  /** 是否已配置密钥（布尔标记，不含明文） */
  hasApiKey: boolean
}

/** 工具按 Provider id 发起模型调用；baseURL / 密钥由主进程裁决注入 */
export interface ToolHostProviderChatRequest {
  providerId: string
  /** 工具自选模型：调用链首位，之后依次为 Provider 默认模型、回退模型 */
  model?: string
  messages: ToolVisionMessage[]
  temperature?: number
  maxTokens?: number
}

/**
 * 宿主提供给工具插件的能力（工具可依赖应用，应用不强依赖工具）：
 * 密钥存 safeStorage、应用级 Provider 共享、云端视觉 chat。
 */
export interface ToolHostCapabilities {
  /** 工具专属密钥；永不进入 settings.json / 渲染层 */
  getToolSecret(toolId: string, name: string): string
  /** 写入成功（加密落盘）才 resolve；失败 reject（IPC 经 handleOk 变错误 toast）。空串=清除 */
  setToolSecret(toolId: string, name: string, value: string): Promise<void>
  /** OpenAI 兼容 /chat/completions，支持 image_url 多模态；返回文本 */
  chat(req: ToolHostChatRequest): Promise<string>
  /** 列出应用级 Provider（不含密钥）；所有工具共用一份配置 */
  listProviders(): LlmProviderInfo[]
  /** 按 Provider id 调用模型；密钥在主进程注入，工具不再自行配置 baseURL / key */
  chatByProvider(req: ToolHostProviderChatRequest): Promise<string>
  /** 按 Provider id 真实查询 /models；密钥同样在主进程注入 */
  listModelsByProvider(providerId: string, apiKey?: string): Promise<string[]>
}

/**
 * 运行时导入包（.sshktool）契约。
 * builtin 工具不填，默认按 main 加载；外部包必须填，由宿主在安装时校验。
 * 本轮只定字段，不实现安装 / utilityProcess（见 docs 路线图）。
 */
export interface ToolPackageContract {
  /** manifest 结构版本；高于宿主 TOOL_PACKAGE_SCHEMA_VERSION 直接拒绝安装 */
  schemaVersion: number
  /** 包自身版本（安装目录与升级判断用） */
  version: string
  requiresHost: {
    /** 宿主能力 API 版本范围，如 ^1.0 */
    api: string
    /** 需要的宿主能力名，与 ToolHostCapabilities 一一对应 */
    capabilities: string[]
  }
  /** main = 主进程插件同等权限；utility = 独立进程 + IPC 白名单（外部包默认） */
  sandbox: 'main' | 'utility'
  /** 允许注册的 IPC 通道；utility 下由主进程强制执行，外部包不得注册任意通道 */
  ipcAllowlist: string[]
  /** 包级签名（安装时校验，不由渲染层裁决） */
  signature?: { algorithm: 'ed25519'; keyId: string; value: string }
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
   * 工具配置形态（两种，由工具包按复杂度决定）：
   * single = 单个「工具配置」菜单，进去左右布局（默认）；
   * menu   = 「工具配置」展开二级菜单，每个二级菜单一个真实页面，页内复用左右布局。
   * 历史值 tabs 已归并入 single，仅供旧清单读取兼容。
   */
  configLayout?: 'single' | 'menu' | 'tabs'
  /** 插件入口声明（宿主按此清单加载） */
  plugin?: ToolPluginDescriptor
  /** 运行时包契约；构建期内置工具缺省，外部导入包必填 */
  package?: ToolPackageContract
  /** 硬依赖：依赖工具不可用时本工具一并隐藏；运行时可由配置覆盖 */
  dependsOn?: string[]
  /** 权限 grant；运行时可由 `tools.<id>.requiredGrant` 覆盖 */
  requiredGrant?: string
  /** 工具形态（两类四态）：implicit=隐式基座（永不上桌面、不进权限列表，仅被依赖）；
   *  hidden=显式但配置隐藏（同 implicit 可见性，仍有独立启停）；managed=显式受控（默认
   *  不上桌面、出现在权限列表，用户开启后上桌面）；desktop=默认上桌面。缺省 desktop */
  visibility?: 'implicit' | 'hidden' | 'managed' | 'desktop'
  /** 工具自有配置声明（左侧「工具配置」按此生成表单） */
  configGroups?: ToolConfigGroup[]
  /** 形态 2 的配置页：把 configGroups 分成多个二级页，每页可含多组；仅 configLayout=menu 生效 */
  configPages?: ToolConfigPage[]
  /** 软配置依赖（只读展示 + 缺失预警）；默认工具之间零依赖 */
  configDeps?: ToolConfigDependency[]
  /** 工具自带的默认配置，宿主启动时自动合并进 settings.json 默认值 */
  defaults?: Record<string, unknown>
}

export interface ToolMenu {
  /** 菜单 ID，传给工具页做视图切换 */
  id: string
  label: string
  /** 可选菜单图标（SVG path d，24×24 视窗）；缺省回退宿主内置图标集 */
  icon?: string
  /** 可选子菜单，支持任意层级（后台管理系统风格） */
  children?: ToolMenu[]
  /** 隐藏（2026-11-22）：异常/暂不开放的菜单不渲染；分组下全部子级隐藏时该分组一并隐藏，
   *  「默认落点」跳过隐藏项取第一个有效可见页（应用管理壳页 APP_MENUS 消费） */
  hidden?: boolean
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
  /** catalog 归一后恒为 'single' | 'menu'（manifest 写 'tabs' 归一为 'single'） */
  configLayout: 'single' | 'menu'
  enabled: boolean
  /** 桌面可见（隐式基座与配置隐藏的工具恒 false） */
  visible: boolean
  /** 是否出现在「应用设置 → 工具与权限」列表（隐式基座与配置隐藏恒 false） */
  manageable: boolean
  /** 能力可用（启停 / 插件 / 分发 / 密钥都满足）；硬依赖链按它传播，基座工具可被依赖 */
  serviceable: boolean
  /** 工具形态回传（UI 展示用） */
  visibility: 'implicit' | 'hidden' | 'managed' | 'desktop'
  /** 插件是否成功加载（加载失败只影响本工具） */
  available: boolean
  /** 运行时安装包（渲染层走 Blob URL 动态组件） */
  runtime: boolean
  pluginError?: string
  /** 不可见原因：已禁用 / 缺依赖 / 需密钥 / 未分发 / 插件加载失败 */
  reason?: string
  /** 非致命提示 */
  warnings: string[]
  dependsOn: string[]
  requiredGrant?: string
  configGroups: ToolConfigGroup[]
  configPages: ToolConfigPage[]
  configDeps: ToolConfigDependency[]
}

export interface ToolCatalogPayload {
  tools: ToolRuntimeState[]
  orphans: string[]
  hasAccessKey: boolean
  grants: string[]
  includeTools: string[] | null
  pluginStatus: Record<string, ToolPluginStatus>
  /** 开发者功能总开关（D-2 · P0-2）：主进程用 isDevFeaturesEnabled 统一裁决后下发，渲染层不再散拼 */
  devFeatures: boolean
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

/**
 * 运行时工具包安装前预览结果（写盘前裁决，供 UI 征求用户意见）。
 * 定义在 shared 而非 apps/desktop：渲染层与预加载层都要用，分层只允许 apps → packages 单向依赖。
 * - builtin-conflict：该 id 已作为内置工具随应用分发，禁止重复安装外部包
 * - downgrade：新版本低于已装版本，需用户显式抉择
 */
export type InstallPreview =
  | { status: 'fresh'; id: string; newVersion: string }
  | { status: 'reinstall'; id: string; newVersion: string; installedVersion: string }
  | { status: 'upgrade'; id: string; newVersion: string; installedVersion: string }
  | { status: 'downgrade'; id: string; newVersion: string; installedVersion: string }
  | { status: 'builtin-conflict'; id: string }

/** N1 诊断报告 · 单工具健康行（无敏感信息） */
export interface DiagnosisToolRow {
  id: string
  name: string
  enabled: boolean
  visible: boolean
  visibility: string
  grant: string
  /** 主进程插件状态：无 / 已加载 / 失败原因 */
  plugin: string
  dependsOn: string[]
  warnings: string[]
}

/**
 * N1 一键诊断数据（plans/04）：只含布尔状态、变量名、计数与目录占用，
 * 绝不含 env 值 / 密钥明文 / 口令内容，渲染层可直接预览确认。
 */
export interface DiagnosisData {
  generatedAt: string
  app: { version: string; packaged: boolean; electron: string; node: string; locale: string }
  platform: { os: string; arch: string; release: string; memoryGB: string; displays: { w: number; h: number; scale: number }[] }
  /** env 只列「变量名 + 是否已设置」，值永不采集 */
  env: { name: string; set: boolean }[]
  secrets: {
    /** 应用访问密钥（settings 里是否有 sha256 摘要） */
    accessKey: boolean
    /** 开发者工具口令（settings 哈希 或 env 默认） */
    devtoolsKey: boolean
    providers: { id: string; name: string; hasApiKey: boolean }[]
    uploads: { id: string; name: string; hasSecret: boolean }[]
  }
  tools: DiagnosisToolRow[]
  outputs: { root: string; files: number; totalMB: string; largest: { rel: string; kb: number }[] }
  logs: {
    dir: string
    files: { name: string; sizeKB: number; warn: number; error: number }[]
    /** 最近 20 条 error 行（落盘时已脱敏） */
    recentErrors: string[]
  }
}

/** N2 工具健康度 · 单工具摘要（主进程聚合；无敏感信息） */
export interface ToolHealthRow {
  id: string
  name: string
  enabled: boolean
  visible: boolean
  /** ok=正常 / warn=有告警 / disabled=已禁用 / plugin-failed=插件加载失败 / dep-missing=硬依赖缺失 */
  state: 'ok' | 'warn' | 'disabled' | 'plugin-failed' | 'dep-missing'
  /** 主进程插件状态文字（无 / 已加载 / 失败：原因） */
  plugin: string
  /** 主进程插件注册的通道数（manifest plugin.channels） */
  channels: number
  /** 缺失的硬依赖（依赖工具已禁用 / 不可见） */
  missingDeps: string[]
  warnings: string[]
  /** 最近日志中与本工具相关的 error 行（时间 + 内容，落盘时已脱敏） */
  lastError: { time: string; text: string } | null
}

/** N2 工具健康度面板 payload（设置抽屉「工具与权限」顶部展示） */
export interface ToolHealthPayload {
  generatedAt: string
  logDir: string
  ok: number
  abnormal: number
  tools: ToolHealthRow[]
}

/** D-Q1 模型用量记录（只记元数据，绝不记 messages 内容；跨 IPC 下发渲染层用） */
export interface UsageRow {
  _id: string
  createdAt: string
  providerId: string
  providerName: string
  model: string
  /** console = 对话调试 / tool = 工具调用 / vision = 视觉识别 */
  purpose: string
  streamed: boolean
  promptTokens?: number
  completionTokens?: number
  durationMs: number
  ok: boolean
  error?: string
}

/** D-Q1 分组汇总行（按 provider+model） */
export interface UsageGroup {
  providerId: string
  providerName: string
  model: string
  calls: number
  okCalls: number
  failCalls: number
  promptTokens: number
  completionTokens: number
  totalMs: number
}

/** D-Q1 用量页 payload：分组汇总 + 最近明细 */
export interface UsageStatsPayload {
  since: string | null
  groups: UsageGroup[]
  totalCalls: number
  /** 最近明细（上限 200 条，时间倒序） */
  records: UsageRow[]
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareHub 常驻分享服务（plans/09）：多租户只读路由。类型真相源，preload / 渲染层 / 内核共用
// ─────────────────────────────────────────────────────────────────────────────

/** ShareHub 挂载目录（应用设置逐项配置，别名直达；用户 2026-11-18 定版）。
 *  配置键 app.shareHub.mounts 为权威持久化，内核 setMounts 即时生效，无需重启。 */
export interface ShareHubMount {
  /** 稳定 id（新增时生成，编辑/保存不重生成） */
  id: string
  /** 本地目录绝对路径 */
  dir: string
  /** 访问别名：URL 形如 http://ip:port/{alias}/；新增时自动生成，用户可改，留空保存时随机生成并持久化 */
  alias: string
  /** 是否启用该挂载（关 = 整目录 404，链接不可用） */
  enabled: boolean
  /** 是否允许浏览目录列表（用户 2026-11-18 拆分：默认 true；关 = 具体文件路径可达、目录列表 404） */
  allowIndex?: boolean
  /** 访问密钥（accessKey）：非空时访客链接需带 ?ak= 才能访问；留空 = 不设密钥 */
  password?: string
}

/** ShareHub 代理规则（用户 2026-11-18 定版）：URL 命中路径前缀 → 全方法反向代理到目标地址。
 *  配置键 app.shareHub.proxies 为权威持久化，内核 setProxies 即时生效，无需重启。 */
export interface ShareHubProxy {
  /** 稳定 id（新增时生成，编辑/保存不重生成） */
  id: string
  /** 匹配前缀：URL 第一段路径（如 api → /api/... 全部命中），规则同挂载点（小写 [a-z0-9-_]） */
  prefix: string
  /** 目标地址（不限网络）：http/https origin，可带基础路径（如 http://192.168.1.10:8080/base） */
  target: string
  /** 转发时保留原始 Host（默认 false → Host 改为目标地址的 host） */
  keepHost?: boolean
  /** 是否启用该规则（关 = 不代理，访问 404） */
  enabled: boolean
}

/** 创建一条分享路由的入参 */
/** 内容状态机（plans/11 §五 + 2026-11-19 新增定时发布）：草稿/已发布/已下线/定时发布；删除走独立 archived 位 */
export type ContentStatus = 'draft' | 'published' | 'retracted' | 'scheduled'

/** 文章内容记录（渲染层视图，plans/11） */
export interface ContentRecord {
  _id: string
  name: string
  html: string
  summary?: string
  description?: string
  tags?: string[]
  status: ContentStatus
  /** 定时发布时刻（status==='scheduled' 时有效）：北京时间 ISO 字符串；已发布/到期后由主进程清空，此处 undefined */
  publishAt?: string
  wordCount: number
  createdAt: string
  updatedAt: string
  archived: boolean
}

/** 新建/保存内容请求（plans/11）：_id 缺省=新建；wordCount/summary 由主进程算好入库 */
export interface ContentSaveInput {
  _id?: string
  name: string
  html: string
  summary?: string
  description?: string
  tags?: string[]
  status?: ContentStatus
  /** 定时发布时刻（status==='scheduled' 时必填）：北京时间 ISO 字符串 */
  publishAt?: string
}

/** 分享路由种类（plans/11 方案 B）：file=静态文件（默认）；content=文章内容（resolver 动态渲染阅读页） */
export type ShareRouteKind = 'file' | 'content'

/** 内容 resolver 返回（plans/11）：宿主注入读库回调，core 不依赖 repository；null=文章不存在→404 */
export interface ShareContentResolverResult {
  title: string
  /** toDisplayHtml 处理过的展示态 HTML（图片协议已转换） */
  html: string
  /** 摘要，可选 */
  summary?: string
  /** 定时发布时刻（status==='scheduled' 时展示）：ISO 字符串 */
  publishAt?: string
  /** 最后更新时间：ISO 字符串（详情页与发布时间并列展示） */
  updatedAt?: string
}

export interface ShareRouteInput {
  /** 归属工具 id（'badge-studio' | 'edm-studio' | 'file-manager' | …）；按此记账鉴权 */
  toolId: string
  /** 展示名（如「海报：产品A」） */
  label: string
  /** 允许被访问的根目录（绝对路径，主进程校验存在）；content kind 用虚拟根标记 */
  root: string
  /** 入口相对路径（缺省 = 目录列表页） */
  entry?: string
  /** 路由种类，缺省 file（plans/11 方案 B） */
  kind?: ShareRouteKind
  /** content kind 的内容 id（cnt_*），由宿主注入的 resolver 按此读库 */
  contentId?: string
  /** 有效期小时数，默认 72；0.01 可用于测试 */
  ttlHours?: number
  /** 是否允许浏览目录列表（缺省由宿主注入应用级默认 app.shareHub.allowIndex，默认不允许）；直接文件路径不受影响 */
  allowIndex?: boolean
  /** 可选访问密钥 accessKey（链接带 ?ak= 轻量校验）；留空则继承同 root 最近祖先路由的密钥 */
  password?: string
}

/** 创建/续期成功后返回的分享凭证 */
export interface ShareRouteTicket {
  id: string
  token: string
  /** 基于「展示 IP」生成的链接（展示 IP 排第一，其余有效候选兜底） */
  urls: string[]
  expiresAt: number
}

/** 路由列表行（宿主路由管理 tab / 工具内本工具路由） */
export interface ShareRouteInfo {
  id: string
  toolId: string
  label: string
  entry: string
  /** 分享根路径（2026-11-19 补暴露：工具按 ticket.id 反查路由做凭证缓存迁移需要四元组） */
  root: string
  ttlHours: number
  expiresAt: number
  createdAt: number
  /** 最近一次变更时刻（ms）：create=createdAt，renew/patch/重新生成刷新；hits 访问不刷新。必填，不兼容旧数据（plans/12 20:12） */
  updatedAt: number
  /** 访问/下载命中计数 */
  hits: number
  /** 访问密钥 accessKey（空串=无）；工具拼「前缀+路径」直达链接时需保留链接自带的 ?ak= 才能通过校验 */
  password?: string
  /** 是否允许浏览目录列表（旧路由缺省视为允许） */
  allowIndex?: boolean
  /** 路由种类，缺省 file（plans/11 方案 B） */
  kind?: ShareRouteKind
  /** content kind 的内容 id */
  contentId?: string
}

/** 一个候选展示 IP（供设置 tab 下拉展示） */
export interface ShareIpInfo {
  ip: string
  /** 网卡名（以太网 / WLAN / vEthernet…） */
  nic: string
  /** 是否虚拟机/虚拟网卡（置灰但可选） */
  virtual: boolean
}

/** 单条访问日志（持久化到 NeDB shareLogs，plans/12）：id=写入时自生成 UUID，作为删除/批量勾选的稳定键 */
export interface ShareAccessLog {
  id: string
  at: number
  ip: string
  path: string
  status: number
  routeId: string
}

/** 日志查询条件（shareHub:logs / exportLogs）：时间范围为毫秒时间戳，UI 层组好再传内核 */
export interface ShareLogsQuery {
  from?: number
  to?: number
  ip?: string
  path?: string
  statusGroup?: '2xx' | '3xx' | '4xx' | '5xx'
  toolId?: string
  routeId?: string
  limit?: number
  offset?: number
}

/** 日志查询结果 */
export interface ShareLogsResult {
  rows: ShareAccessLog[]
  total: number
}

/** 服务状态快照（status() 返回，已移除 logs——日志走 shareHub:logs 独立通道） */
export interface HubStatus {
  running: boolean
  port: number
  /** 当前生效的展示 IP（自动优选或用户指定） */
  displayIp: string
  /** 本机候选 IP（供设置页下拉 / ShareDialog 多 IP 切换） */
  ips: ShareIpInfo[]
  routes: ShareRouteInfo[]
}
