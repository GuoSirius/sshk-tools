/**
 * ① 类型层（plans/13 B0 重组式抽离，自 edm-studio sample-schema.ts 按职责拆出）：
 * 表单字段 schema 的类型真相源——字段类型全集 / 字段定义 / 选项 / 表格列。
 * 命名去 EDM 化：sample → form 语境（FieldType/FieldDef 本身已是通用命名）；
 * 校验铁律（原 v5 §5.2）：所有控件类型必须有校验；未通过阻止保存。
 */

export type FieldType =
  | 'input' | 'textarea' | 'richtext' | 'url' | 'number' | 'date' | 'color' | 'switch'
  | 'radio' | 'checkbox' | 'select' | 'select-multi'
  | 'image' | 'image-list'
  | 'repeater' | 'table'

export const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'input', 'textarea', 'richtext', 'url', 'number', 'date', 'color', 'switch',
  'radio', 'checkbox', 'select', 'select-multi', 'image', 'image-list',
  'repeater', 'table',
])

/** 容器控件：内部含子字段 itemFields，可递归组合原子控件（产品卡/图文卡/表格行）；
 *  历史 list 与 repeater 行为/数据/校验完全一致，2026-11-24 彻底合并为 repeater（不做旧 type 兼容，normalizeFields 白名单直接丢弃） */
export const CONTAINER_TYPES: readonly FieldType[] = ['repeater', 'table']

export interface FieldOption {
  label: string
  value: string
}

/** 表格列定义（table 控件）：第一版平铺，不做合并单元格 */
export interface TableColumn {
  key: string
  label: string
  /** 单元格控件类型：文本 / URL / 富文本 */
  cellType: 'input' | 'url' | 'richtext'
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** 分组名：相邻同名分组渲染为折叠分隔 */
  group?: string
  required?: boolean
  options?: FieldOption[]
  default?: unknown
  placeholder?: string
  /** input/textarea */
  minLength?: number
  maxLength?: number
  /** input：正则串（new RegExp 校验，非法正则忽略） */
  pattern?: string
  /** checkbox */
  maxChecked?: number
  /** select-multi */
  maxSelected?: number
  /** number 数值范围 / image-list 数量上限（v4） */
  min?: number
  max?: number
  /** list 行数 */
  minRows?: number
  maxRows?: number
  /** list / repeater / table 嵌套字段（递归）；table 时 itemFields 是行模板 */
  itemFields?: FieldDef[]
  /** table 列定义 */
  columns?: TableColumn[]
  /** 默认上传通道声明：local | cloud:<providerId>（上传通道 R15.3 接入后生效） */
  upload?: string
  /**
   * 复合控件引用占位（plans/13 阶段 C）：非空表示本节点是「控件库引用」而非完整定义，
   * type 固定容器语义（repeater），渲染/校验/导出前经 expandFields 展开为控件 root 深拷贝。
   * 存储树（NeDB 表单/控件）允许携带；对外持久契约（EDM meta.yaml）在派生拷贝时物化展开、不带此键。
   */
  controlKey?: string
}
