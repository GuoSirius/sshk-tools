/**
 * EDM 系统内容数据模型（纯类型，渲染层用 import type 取，零运行时代价）。
 * 字段对齐《EDM 目录结构与模板片段维护规划》第四节 + 数据契约 §2。
 * 文件为源真相，NeDB 仅作查询索引（Q3）。
 */

/**
 * 片段黑白名单（D14 粒度=版本/族 ID）：指示该片段适用于哪些模板。
 * 仅片段侧持有（族级共享 + 版本级可覆盖）；模板侧不反向列黑白名单（冗余，已废弃）。
 * - whitelist：本片段可服务的模板族/版本 ID；为空 = 本品牌内全部模板可用
 * - blacklist：本片段排除的模板族/版本 ID（优先于白名单）
 */
export interface FragmentPolicy {
  whitelist?: string[]
  blacklist?: string[]
}

export interface Slot {
  key: string
  type: string
}

/** 品牌元数据：<brandCode>/meta.yaml */
export interface BrandMeta {
  code: string
  name: string
  description?: string
  /** 品牌图标（旧 logo 字段已丢弃，不兼容读取） */
  favicon?: string
  defaultTemplateFamily?: string
  tags?: string[]
}

/** 片段族元数据：<brand>/fragment/<family>/meta.yaml */
export interface FragmentFamilyMeta {
  code: string
  name: string
  description?: string
  /** 族图标；空则继承所属类型（再回退品牌） */
  favicon?: string
  type?: string
  /** 黑白名单：本族片段可服务的模板族/版本 ID（D14） */
  policy?: FragmentPolicy
  dataSchema?: Record<string, unknown>
  /** 字段 schema 族级兜底（版本未声明 fields 时） */
  fields?: unknown[]
  tags?: string[]
}

/** 片段版本元数据：<family>/<version>/meta.yaml；可覆盖族级 policy */
export interface FragmentVersionMeta {
  /** 与版本目录名同步（当前只读镜像，未来可独立成业务编码） */
  code: string
  /** 人可读显示名，左树以「目录名（name）」展示 */
  name: string
  /** 版本图标；空则继承所属族 */
  favicon?: string
  version: number
  changelog?: string
  policy?: FragmentPolicy
  /** 字段 schema（R15 示例表单 + 邮件数据填写） */
  fields?: unknown[]
}

/** 模板族元数据：<brand>/template/<family>/meta.yaml */
export interface TemplateFamilyMeta {
  code: string
  name: string
  description?: string
  /** 族图标；空则继承所属类型（再回退品牌） */
  favicon?: string
  slots?: Slot[]
  dataSchema?: Record<string, unknown>
  tags?: string[]
}

/** 模板版本元数据：<family>/<version>/meta.yaml */
export interface TemplateVersionMeta {
  /** 与版本目录名同步（当前只读镜像，未来可独立成业务编码） */
  code: string
  /** 人可读显示名，左树以「目录名（name）」展示 */
  name: string
  /** 版本图标；空则继承所属族 */
  favicon?: string
  version: number
  changelog?: string
  /** 模板级字段 schema（可选） */
  fields?: unknown[]
}

/** 单个版本节点（目录不可变，D8） */
export interface VersionNode<TMeta> {
  /** 版本目录名：default / v1 / v2 / ''（单版本折叠） */
  dir: string
  /** 绝对目录 */
  path: string
  meta: TMeta
  /** 源文件名（fragment.njk / template.njk） */
  source: string
  sourcePath: string
  /** 示例数据（sample.yaml），无则 null */
  sample: Record<string, unknown> | null
  /** 就近 css 相对路径集合（第三节就近提升规则） */
  css: string[]
}

export interface FragmentFamilyNode {
  code: string
  path: string
  meta: FragmentFamilyMeta
  /** 族级 css/ 下的文件名列表（css/ 目录根相对路径 = path + '/css/' + 文件名） */
  css: string[]
  versions: VersionNode<FragmentVersionMeta>[]
}

export interface TemplateFamilyNode {
  code: string
  path: string
  meta: TemplateFamilyMeta
  /** 族级 css/ 下的文件名列表 */
  css: string[]
  versions: VersionNode<TemplateVersionMeta>[]
}

/** 类型（片段/模板）元数据：<brand>/<fragment|template>/meta.yaml（旧称类目，统一叫类型） */
export interface CategoryMeta {
  code: string
  name: string
  description?: string
  /** 类型图标；空则继承所属品牌 */
  favicon?: string
  tags?: string[]
}

export interface BrandNode {
  code: string
  path: string
  meta: BrandMeta
  /** 品牌级 css/ 下的文件（就近提升 R5） */
  css: string[]
  /** 片段类目级 css/（<brand>/fragment/css/）文件名列表（v5） */
  fragmentCss: string[]
  /** 模板类目级 css/（<brand>/template/css/）文件名列表（v5） */
  templateCss: string[]
  /** 类目元数据（文件缺失为 null，保存时创建） */
  fragmentMeta: CategoryMeta | null
  templateMeta: CategoryMeta | null
  fragments: FragmentFamilyNode[]
  templates: TemplateFamilyNode[]
}

export interface EdmModel {
  root: string
  /** 顶层 edm/css/ 下的公共样式（root 相对路径，跨品牌共享） */
  topCss: string[]
  brands: BrandNode[]
}

/** 元数据字段约束（R2）：供解析期告警 + 后续编辑器 JSON Schema 生成 */
export interface MetaFieldDef {
  name: string
  required: boolean
}

/** 四级元数据统一必填 code/name（favicon/version 按实体类型附加） */
export const META_FIELDS: Record<'brand' | 'fragmentFamily' | 'fragmentVersion' | 'templateFamily' | 'templateVersion', MetaFieldDef[]> = {
  brand: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  fragmentFamily: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  fragmentVersion: [
    { name: 'code', required: true },
    { name: 'name', required: true },
    { name: 'version', required: true },
  ],
  templateFamily: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  templateVersion: [
    { name: 'code', required: true },
    { name: 'name', required: true },
    { name: 'version', required: true },
  ],
}

export type EntityKind = keyof typeof META_FIELDS
