import { load as yamlLoad } from 'js-yaml'

/**
 * 复核项 8：示例 / 元数据 / 片段数据的 YAML 容错解析。
 *
 * 「数据为空」是完全合法的初始状态：空文件、纯空白、纯注释、显式 null
 * 一律视为空模型 {}，绝不弹「YAML 解析失败」。只有真正的语法错误才抛出；
 * 顶层不是键值映射时给出明确原因，而不是把异常笼统包装成 YAML 问题。
 */
export function parseYamlObject(text: unknown): Record<string, unknown> {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = yamlLoad(raw)
  } catch (err) {
    // js-yaml 5.x 对「只有注释 / 空文档」会抛 expected a document；这仍是合法空数据，
    // 不得冒泡成「YAML 解析失败」（复核项 8 的真实根因）。其它语法错误照常抛出。
    if (/expected a document|input is empty/i.test((err as Error).message)) return {}
    throw err
  }
  if (parsed == null) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML 顶层必须是键值映射（object），不能是数组或标量')
  }
  return parsed as Record<string, unknown>
}

/**
 * 示例数据 fields schema（R15，规划 §5.1/§5.2）：
 * - schema 声明于 meta.yaml 的 fields: 段（版本级优先，族级兜底）
 * - 纯函数层：归一化 / 默认值 / 校验，渲染层 SampleForm.vue 消费
 * - 校验铁律（v5 §5.2）：所有控件类型必须有校验；未通过阻止保存
 */
export type FieldType =
  | 'input' | 'textarea' | 'richtext'
  | 'radio' | 'checkbox' | 'select' | 'select-multi'
  | 'image' | 'image-list' | 'list'

export const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'input', 'textarea', 'richtext', 'radio', 'checkbox', 'select', 'select-multi', 'image', 'image-list', 'list',
])

export interface FieldOption {
  label: string
  value: string
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
  /** image-list 数量上限（v4） */
  max?: number
  /** list 行数 */
  minRows?: number
  maxRows?: number
  /** list 嵌套字段（递归） */
  itemFields?: FieldDef[]
  /** 默认上传通道声明：local | cloud:<providerId>（上传通道 R15.3 接入后生效） */
  upload?: string
}

function toNum(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function normalizeOptions(raw: unknown): FieldOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: FieldOption[] = []
  for (const o of raw) {
    if (typeof o === 'string') out.push({ label: o, value: o })
    else if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>
      if (rec.value != null) out.push({ label: String(rec.label ?? rec.value), value: String(rec.value) })
    }
  }
  return out.length ? out : undefined
}

/** 容错解析 yaml 载入的 fields 段：丢弃缺 key / 未知 type 的项 */
export function normalizeFields(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return []
  const out: FieldDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const f = item as Record<string, unknown>
    const key = String(f.key ?? '').trim()
    const type = String(f.type ?? '').trim()
    if (!key || !FIELD_TYPES.has(type)) continue
    out.push({
      key,
      label: String(f.label ?? key),
      type: type as FieldType,
      group: f.group ? String(f.group) : undefined,
      required: f.required === true,
      options: normalizeOptions(f.options),
      default: f.default,
      placeholder: f.placeholder ? String(f.placeholder) : undefined,
      minLength: toNum(f.minLength),
      maxLength: toNum(f.maxLength),
      pattern: f.pattern ? String(f.pattern) : undefined,
      maxChecked: toNum(f.maxChecked),
      maxSelected: toNum(f.maxSelected),
      max: toNum(f.max),
      minRows: toNum(f.minRows),
      maxRows: toNum(f.maxRows),
      itemFields: type === 'list' ? normalizeFields(f.itemFields) : undefined,
      upload: f.upload ? String(f.upload) : undefined,
    })
  }
  return out
}

const ARRAY_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['list', 'image-list', 'select-multi', 'checkbox'])

/** 未声明值的字段补默认值：显式 default 优先；数组类控件兜底空数组 */
export function applyDefaults(fields: FieldDef[], model: Record<string, unknown>): Record<string, unknown> {
  const out = { ...model }
  for (const f of fields) {
    if (out[f.key] !== undefined) continue
    if (f.default !== undefined) out[f.key] = f.default
    else if (ARRAY_TYPES.has(f.type)) out[f.key] = []
  }
  return out
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v]
}

/**
 * 校验（v5 §5.2）：返回错误映射。
 * 顶层键 = 字段 key；list 行内错误键 = `<key>.<行号>.<子键>`（渲染层用于行级标红）。
 */
export function validateModel(fields: FieldDef[], model: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    const v = model[f.key]
    if (f.required && isEmpty(v)) {
      errors[f.key] = `${f.label}必填`
      continue
    }
    if (isEmpty(v)) {
      // list 的 minRows 约束对空数据同样生效（空数组不算「无值可跳过」）
      if (f.type === 'list' && f.minRows) errors[f.key] = `${f.label}至少 ${f.minRows} 行`
      continue
    }
    switch (f.type) {
      case 'input':
      case 'textarea': {
        const s = String(v)
        if (f.minLength && s.length < f.minLength) errors[f.key] = `${f.label}至少 ${f.minLength} 字`
        else if (f.maxLength && s.length > f.maxLength) errors[f.key] = `${f.label}最多 ${f.maxLength} 字`
        else if (f.pattern) {
          try {
            if (!new RegExp(f.pattern).test(s)) errors[f.key] = `${f.label}格式不正确`
          } catch {
            /* 非法正则忽略，不阻塞 */
          }
        }
        break
      }
      case 'richtext': {
        const text = String(v).replace(/<[^>]*>/g, '')
        if (f.maxLength && text.length > f.maxLength) errors[f.key] = `${f.label}正文最多 ${f.maxLength} 字`
        break
      }
      case 'checkbox': {
        const n = asArray(v).length
        if (f.maxChecked && n > f.maxChecked) errors[f.key] = `${f.label}最多选 ${f.maxChecked} 项`
        break
      }
      case 'select-multi': {
        const n = asArray(v).length
        if (f.maxSelected && n > f.maxSelected) errors[f.key] = `${f.label}最多选 ${f.maxSelected} 项`
        break
      }
      case 'image-list': {
        const n = asArray(v).length
        if (f.max && n > f.max) errors[f.key] = `${f.label}最多上传 ${f.max} 张`
        break
      }
      case 'list': {
        const rows = asArray(v) as Record<string, unknown>[]
        if (f.minRows && rows.length < f.minRows) errors[f.key] = `${f.label}至少 ${f.minRows} 行`
        else if (f.maxRows && rows.length > f.maxRows) errors[f.key] = `${f.label}最多 ${f.maxRows} 行`
        const subFields = f.itemFields ?? []
        rows.forEach((row, i) => {
          const sub = validateModel(subFields, row ?? {})
          for (const [k, msg] of Object.entries(sub)) errors[`${f.key}.${i}.${k}`] = msg
        })
        break
      }
      default:
        break // radio / select / image：required 已覆盖
    }
  }
  return errors
}
