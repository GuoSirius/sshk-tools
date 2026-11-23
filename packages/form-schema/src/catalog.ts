/**
 * ② 控件目录层（plans/13 B0 重组）：类型 → { 标签, 分组, 描述 } 的结构化目录，
 * 是设计器类型下拉 / 控件管理页类型说明 / 文档的唯一真相源（原 FIELD_TYPE_LABEL 升级）。
 * 附类型切换白名单（TYPE_KEYS / retypeField）：切换类型时重建 FieldDef，杜绝旧类型属性残留（体检 #3）。
 */
import type { FieldDef, FieldType } from './schema'

export type FieldCatalogGroup = '基础' | '选择' | '媒体' | '容器'

export interface FieldTypeInfo {
  type: FieldType
  label: string
  group: FieldCatalogGroup
  description: string
}

/** 控件目录：设计器/控件管理/文档共用（新增类型只改一处，体检 #21 升级版） */
export const FIELD_CATALOG: readonly FieldTypeInfo[] = [
  { type: 'input', label: '单行文本', group: '基础', description: '一行短文本，可限长度与正则' },
  { type: 'textarea', label: '多行文本', group: '基础', description: '多行长文本，可限长度' },
  { type: 'richtext', label: '富文本', group: '基础', description: '图文混排编辑器（wangEditor）' },
  { type: 'url', label: '链接 URL', group: '基础', description: '链接地址' },
  { type: 'number', label: '数字', group: '基础', description: '数值输入，可限范围' },
  { type: 'date', label: '日期', group: '基础', description: '日期选择（YYYY-MM-DD）' },
  { type: 'color', label: '颜色', group: '基础', description: '颜色选择器' },
  { type: 'switch', label: '开关', group: '基础', description: '布尔开关' },
  { type: 'radio', label: '单选', group: '选择', description: '单选组（自定选项）' },
  { type: 'checkbox', label: '多选', group: '选择', description: '多选组（自定选项，可限勾选数）' },
  { type: 'select', label: '下拉单选', group: '选择', description: '下拉选一项' },
  { type: 'select-multi', label: '下拉多选', group: '选择', description: '下拉选多项（可限数量）' },
  { type: 'image', label: '单图', group: '媒体', description: '单张图片（上传/选择 + 预览）' },
  { type: 'image-list', label: '多图', group: '媒体', description: '多张图片列表（可限张数）' },
  { type: 'repeater', label: '动态列表', group: '容器', description: '一组固定字段作为一个整块反复出现，行数不限（如联系人组、产品卡）；复合控件插入后就是它' },
  { type: 'table', label: '数据表格', group: '容器', description: '按列定义平铺的表格（input/url/richtext 单元格）' },
]

/** type → label 映射（由目录推导，保持旧消费方兼容） */
export const FIELD_TYPE_LABEL: Record<FieldType, string> = Object.fromEntries(
  FIELD_CATALOG.map((t) => [t.type, t.label]),
) as Record<FieldType, string>

export const FIELD_GROUP_LABEL: Record<FieldCatalogGroup, string> = {
  基础: '基础控件', 选择: '选择控件', 媒体: '媒体控件', 容器: '容器控件',
}

/** 按类型的属性白名单：切换类型时只保留新类型适用属性（体检 #3）；controlKey 仅容器类型可携带 */
const BASE_KEYS: readonly (keyof FieldDef)[] = ['key', 'label', 'type', 'group', 'required', 'default']
const CONTAINER_KEYS: readonly (keyof FieldDef)[] = [...BASE_KEYS, 'minRows', 'maxRows', 'controlKey'] as const

const TYPE_KEYS: Record<FieldType, readonly (keyof FieldDef)[]> = {
  input: [...BASE_KEYS, 'placeholder', 'minLength', 'maxLength', 'pattern'],
  textarea: [...BASE_KEYS, 'placeholder', 'minLength', 'maxLength'],
  richtext: [...BASE_KEYS, 'minLength', 'maxLength'],
  url: [...BASE_KEYS, 'placeholder'],
  number: [...BASE_KEYS, 'placeholder', 'min', 'max'],
  date: [...BASE_KEYS, 'placeholder'],
  color: [...BASE_KEYS],
  switch: [...BASE_KEYS],
  radio: [...BASE_KEYS, 'options'],
  checkbox: [...BASE_KEYS, 'options', 'maxChecked'],
  select: [...BASE_KEYS, 'placeholder', 'options'],
  'select-multi': [...BASE_KEYS, 'placeholder', 'options', 'maxSelected'],
  image: [...BASE_KEYS],
  'image-list': [...BASE_KEYS, 'max'],
  repeater: [...CONTAINER_KEYS, 'itemFields'],
  table: [...CONTAINER_KEYS, 'columns'],
}

/** 切换类型后只保留新类型适用属性（体检 #3）：调用方传完整旧字段，返回干净的新类型字段 */
export function retypeField(f: FieldDef, type: FieldType): FieldDef {
  const keep = TYPE_KEYS[type]
  const out: Record<string, unknown> = { type }
  for (const k of keep) {
    if (k !== 'type' && f[k] !== undefined) out[k] = f[k]
  }
  return out as unknown as FieldDef
}
