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
  logo?: string
  defaultTemplateFamily?: string
  tags?: string[]
}

/** 片段族元数据：<brand>/fragment/<family>/meta.yaml */
export interface FragmentFamilyMeta {
  code: string
  name: string
  description?: string
  type?: string
  /** 黑白名单：本族片段可服务的模板族/版本 ID（D14） */
  policy?: FragmentPolicy
  dataSchema?: Record<string, unknown>
  tags?: string[]
}

/** 片段版本元数据：<family>/<version>/meta.yaml；可覆盖族级 policy */
export interface FragmentVersionMeta {
  version: number
  changelog?: string
  policy?: FragmentPolicy
}

/** 模板族元数据：<brand>/template/<family>/meta.yaml */
export interface TemplateFamilyMeta {
  code: string
  name: string
  description?: string
  slots?: Slot[]
  dataSchema?: Record<string, unknown>
  tags?: string[]
}

/** 模板版本元数据：<family>/<version>/meta.yaml */
export interface TemplateVersionMeta {
  version: number
  changelog?: string
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
  versions: VersionNode<FragmentVersionMeta>[]
}

export interface TemplateFamilyNode {
  code: string
  path: string
  meta: TemplateFamilyMeta
  versions: VersionNode<TemplateVersionMeta>[]
}

export interface BrandNode {
  code: string
  path: string
  meta: BrandMeta
  /** 品牌级 css/ 下的文件（root 相对路径，就近提升 R5） */
  css: string[]
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

export const META_FIELDS: Record<'brand' | 'fragmentFamily' | 'fragmentVersion' | 'templateFamily' | 'templateVersion', MetaFieldDef[]> = {
  brand: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  fragmentFamily: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  fragmentVersion: [{ name: 'version', required: true }],
  templateFamily: [
    { name: 'code', required: true },
    { name: 'name', required: true },
  ],
  templateVersion: [{ name: 'version', required: true }],
}

export type EntityKind = keyof typeof META_FIELDS
