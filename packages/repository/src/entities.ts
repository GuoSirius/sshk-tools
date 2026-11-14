import type { DatasourceKind, EntityStatus, FragmentPolicy, Origin, TemplateSlot } from '@sshk/shared'

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
  sampleData?: Record<string, unknown>
  origin: Origin
}

/** 槽位绑定：存版本 ID 快照，不存引用指针 */
export interface SlotBinding {
  slot: string
  fragmentVersionId: string
}

export interface MailOutputs {
  assembled?: string
  inlined?: string
  final?: string
}

export interface Mail extends BaseEntity {
  name: string
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
  lastGeneratedAt?: string
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
] as const

export type CollectionName = (typeof BACKUP_COLLECTIONS)[number]
