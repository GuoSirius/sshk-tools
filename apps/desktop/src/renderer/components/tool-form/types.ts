/**
 * 批4 工具创建与配置统一（plans/02）：向导 / 清单编辑器共用的表单类型与常量。
 * 同字段同控件同校验——两壳唯一差异是底部动作按钮与预览形态。
 */
import type { ToolConfigFieldType } from '@sshk/shared'

export interface MenuRow { id: string; label: string }
export interface FieldRow { key: string; label: string; type: ToolConfigFieldType; hint: string; min: number | null; optionsText: string }
export interface GroupRow { id: string; label: string; fields: FieldRow[] }
export interface PageRow { id: string; label: string; groups: string[] }

/** 两壳共用的 7 项宿主能力（与 shared CREATE_CAPABILITIES 一致，单一事实源在此） */
export const CAPABILITIES_LIST = [
  'getToolSecret', 'setToolSecret', 'chat', 'listProviders',
  'chatByProvider', 'listModelsByProvider', 'runLocalOcr',
]

export const FIELD_TYPES: { label: string; value: ToolConfigFieldType }[] = [
  { label: '文本 string', value: 'string' },
  { label: '多行文本 textarea', value: 'textarea' },
  { label: '数字 number', value: 'number' },
  { label: '开关 boolean', value: 'boolean' },
  { label: '下拉 select', value: 'select' },
  { label: '目录 dir', value: 'dir' },
  { label: '文件 file', value: 'file' },
]

export const VISIBILITIES = [
  { label: 'managed（受控：进权限列表，用户开启后上桌面）', value: 'managed' },
  { label: 'desktop（默认上桌面）', value: 'desktop' },
  { label: 'hidden（隐藏：不上桌面也不进列表）', value: 'hidden' },
  { label: 'implicit（隐式基座：永不上桌面、仅被其它工具依赖）', value: 'implicit' },
]

export function emptyField(): FieldRow {
  return { key: '', label: '', type: 'string', hint: '', min: null, optionsText: '' }
}

/** 选项文本 → 结构化 options（"标签:值, 标签:值"） */
export function parseOptions(text: string): { label: string; value: string }[] {
  return text.split(/[,，]+/).map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const [label, value] = seg.split(/[:：]/).map((s) => s.trim())
    return { label: label ?? seg, value: value ?? label ?? seg }
  })
}

/** BasicInfoSection 的统一表单形状：编辑壳全量字段；创建壳缺省项在 create 模式下不渲染 */
export interface BasicInfoForm {
  id: string
  name: string
  description: string
  category: string
  tags: string
  visibility: string
  icon?: string
  entryRoute?: string
  enabled?: boolean
  configLayout?: string
}
