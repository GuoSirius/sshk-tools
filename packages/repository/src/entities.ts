import type { ContentStatus, DatasourceKind, EntityStatus, FragmentPolicy, Origin, TemplateSlot } from '@sshk/shared'

/** 公共基类：时间一律北京时间 ISO 8601 带 +08:00 偏移（由 @sshk/shared/time 生成） */
export interface BaseEntity {
  _id: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

export interface Brand extends BaseEntity {
  code: string
  name: string
  /** 相对 app.outputDir 的路径，禁止绝对路径（数据契约 §1） */
  logo?: string
  /** 来源：system = R8 播种的内置品牌（只读）；undefined/custom = 用户自建 */
  origin?: Origin
}

/** 模板族：只放元信息，不放代码（数据契约 §2.1） */
export interface Template extends BaseEntity {
  brandId: string
  name: string
  description?: string
  tags?: string[]
  origin: Origin
  latestVersionId?: string
}

export type CssMode = 'inline' | 'local' | 'external'

export interface VersionSource {
  /** 相对 app.outputDir 的模板文件路径（.njk / .html） */
  html: string
  css?: string
  /** local 模式：相对产物系统的 css 文件（assets/templates/<brandCode>/x.css） */
  cssFile?: string
  cssMode: CssMode
}

/** 模板版本：内容主体，不可变（D8）；改 = 新建版本 */
export interface TemplateVersion extends BaseEntity {
  templateId: string
  brandId: string
  version: number
  label?: string
  source: VersionSource
  slots: TemplateSlot[]
  dataSchema?: Record<string, unknown>
  /** 模板级字段 schema（meta.yaml fields:；宽松结构避免跨层依赖） */
  fields?: unknown[]
  sampleData?: Record<string, unknown>
  origin: Origin
}

/** 片段族 */
export interface Fragment extends BaseEntity {
  brandId: string
  name: string
  description?: string
  type: string
  origin: Origin
  latestVersionId?: string
}

/** 片段版本：内容主体，不可变（D8） */
export interface FragmentVersion extends BaseEntity {
  fragmentId: string
  brandId: string
  version: number
  label?: string
  type: string
  source: VersionSource
  /** 黑名单优先；黑名单/白名单允许 `tpl_…` 表示整族（D14，查询层展开） */
  policy: FragmentPolicy
  dataSchema?: Record<string, unknown>
  /** 字段 schema（meta.yaml fields:，R15 示例表单 / 邮件数据填写用；宽松结构避免跨层依赖） */
  fields?: unknown[]
  sampleData?: Record<string, unknown>
  origin: Origin
}

/** 槽位绑定（placement）：存版本 ID 快照，不存引用指针 */
export interface SlotBinding {
  slot: string
  fragmentVersionId: string
  /** 同区块内顺序（缺省按数组顺序） */
  order?: number
  /** 重复次数（≥1，缺省 1） */
  repeat?: number
  /** 该 placement 独立数据（缺省回落 mail.data；Q12 拍板：按 placement 各带 data） */
  data?: Record<string, unknown>
}

export interface MailOutputs {
  assembled?: string
  inlined?: string
  final?: string
}

export interface Mail extends BaseEntity {
  name: string
  /** 来源标记（system=基于系统内容产出 / custom=自定义；Q/C 拍板：邮件为独立实体） */
  origin?: Origin
  brandId: string
  templateVersionId: string
  bindings: SlotBinding[]
  data: Record<string, unknown>
  status: EntityStatus
  /** 覆盖式固定相对路径，无时间戳（需求 17 / D19） */
  outputs: MailOutputs
  lastGeneratedAt?: string
  sourceHash?: string
}

export interface PosterSource {
  type: 'mail' | 'upload'
  mailId?: string
  /** 相对 app.outputDir */
  htmlPath: string
}

export interface PosterDatasource {
  file: string
  kind: DatasourceKind
  ocrReviewed?: boolean
}

export interface PosterConfigSnapshot {
  badgeAttr: string
  clicksField: string
  posterWidth: number
  scale: number
  /** 角标默认位置（data-badge-position 配置化） */
  badgePositionText?: string
  badgePositionImage?: string
}

export interface PosterOutputs {
  badged?: string
  poster?: string
}

/** 生成时的统计快照（重新生成/编辑用；宽松结构，避免跨层依赖工具类型） */
export type StatsSnapshot = object[]

export interface Poster extends BaseEntity {
  name: string
  source: PosterSource
  datasources: PosterDatasource[]
  configSnapshot: PosterConfigSnapshot
  outputs: PosterOutputs
  status: EntityStatus
  /** 生成时的点击统计（可编辑重生成） */
  statsSnapshot?: StatsSnapshot
  /** 生成后的标记核对数据（用户 2026-11-17：随海报保存，重开可回显）。
   *  数组形态存储：url 作 Mongo 字段键必含「.」会插入失败（2026-11-18 事故），读端兼容旧 Record 形态 */
  markCounts?: Array<{ url: string; count: number }>
  /** 标记核对报告（CSV，相对 app.outputDir） */
  markReport?: string
  lastGeneratedAt?: string
  /**
   * 打标时的源指纹（数据契约 §7「源已更新」检测）：
   * mail 型海报存源邮件的 sourceHash，mail:generate 后对比变化提示「重新打标」；
   * upload 型存源 HTML 内容哈希（仅追溯，不参与提示）。
   */
  sourceHash?: string
}

/** 通用文章内容（plans/11 §二）：html 存储态、字数入库、图片一律外链不落库 */
export interface ContentDoc extends BaseEntity {
  name: string
  /** wangEditor 存储态 HTML（toStoredHtml） */
  html: string
  /** 摘要（阅读页/公用列表展示） */
  summary?: string
  tags?: string[]
  /** 描述（列表「描述」列展示，区别于自动摘要 summary；可空） */
  description?: string
  status: ContentStatus
  /** 定时发布时刻（status==='scheduled' 时有效）：ISO 字符串；主进程到点翻 published 后写空串 '' 清空 */
  publishAt?: string
  /** 保存时由 html 提纯文本后 countHtmlWords() 算好入库，列表直出不解析 HTML */
  wordCount: number
}

/** 分享访问日志（plans/12）：内核批量写入，id=内核生成的 UUID（删除稳定键），路由归属走 routeId 反查不冗余存 */
export interface ShareLogDoc extends BaseEntity {
  id: string
  at: number
  ip: string
  path: string
  status: number
  routeId: string
}

/** zip 包内 data/ 目录与实体的对应关系（@sshk/backup 使用） */
export const BACKUP_COLLECTIONS = [
  'brands',
  'templates',
  'templateVersions',
  'fragments',
  'fragmentVersions',
  'mails',
  'posters',
  'contents',
  'shareLogs',
] as const

export type CollectionName = (typeof BACKUP_COLLECTIONS)[number]

/** 文件系统目录备注（plans/08 §十一）：应用侧存储，键 = profileId + path */
export interface FsAnnotationDoc extends BaseEntity {
  profileId: string
  path: string
  note: string
}

/** 文件系统收藏夹条目 */
export interface FsFavoriteDoc extends BaseEntity {
  profileId: string
  path: string
  kind: 'dir' | 'file'
  name: string
}

/**
 * 非备份集合（D-Q1 用量日志）：运行时元数据，不随备份 zip 导出（备份契约不变）。
 * 与 BACKUP_COLLECTIONS 共用同一 NeDB 存储层与 compact 调度。
 */
export const NON_BACKUP_COLLECTIONS = ['usage', 'fsAnnotations', 'fsFavorites'] as const

export type StorageCollection = CollectionName | (typeof NON_BACKUP_COLLECTIONS)[number]

/** 模型调用用量记录（D-Q1）：只记元数据，绝不记 messages 内容 */
export interface UsageRec extends BaseEntity {
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
