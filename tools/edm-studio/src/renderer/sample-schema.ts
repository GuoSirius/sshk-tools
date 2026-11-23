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
  | 'input' | 'textarea' | 'richtext' | 'url' | 'number' | 'date' | 'color' | 'switch'
  | 'radio' | 'checkbox' | 'select' | 'select-multi'
  | 'image' | 'image-list'
  | 'list' | 'repeater' | 'table'

export const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'input', 'textarea', 'richtext', 'url', 'number', 'date', 'color', 'switch',
  'radio', 'checkbox', 'select', 'select-multi', 'image', 'image-list',
  'list', 'repeater', 'table',
])

/** 容器控件：内部含子字段 itemFields，可递归组合原子控件（产品卡/图文卡/表格行） */
export const CONTAINER_TYPES: readonly FieldType[] = ['list', 'repeater', 'table']
/** 允许子字段 itemFields 的类型（= 容器控件） */
export const NESTED_TYPES: readonly FieldType[] = CONTAINER_TYPES

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
}

/** 控件类型 → 设计器标签（唯一真相源：设计器/校验/文档共用，避免两处手工维护漏改） */
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  input: '单行文本', textarea: '多行文本', richtext: '富文本',
  url: '链接 URL', number: '数字', date: '日期', color: '颜色', switch: '开关',
  radio: '单选', checkbox: '多选', select: '下拉单选', 'select-multi': '下拉多选',
  image: '单图', 'image-list': '多图',
  list: '动态列表', repeater: '重复项（组合）', table: '数据表格',
}

/** 按类型的属性白名单：切换类型时重建 FieldDef，杜绝旧类型属性残留/复活（体检 #3） */
const TYPE_KEYS: Record<FieldType, readonly (keyof FieldDef)[]> = {
  input: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder', 'minLength', 'maxLength', 'pattern'],
  textarea: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder', 'minLength', 'maxLength'],
  richtext: ['key', 'label', 'type', 'group', 'required', 'default', 'minLength', 'maxLength'],
  url: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder'],
  number: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder', 'min', 'max'],
  date: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder'],
  color: ['key', 'label', 'type', 'group', 'required', 'default'],
  switch: ['key', 'label', 'type', 'group', 'required', 'default'],
  radio: ['key', 'label', 'type', 'group', 'required', 'default', 'options'],
  checkbox: ['key', 'label', 'type', 'group', 'required', 'default', 'options', 'maxChecked'],
  select: ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder', 'options'],
  'select-multi': ['key', 'label', 'type', 'group', 'required', 'default', 'placeholder', 'options', 'maxSelected'],
  image: ['key', 'label', 'type', 'group', 'required', 'default'],
  'image-list': ['key', 'label', 'type', 'group', 'required', 'default', 'max'],
  list: ['key', 'label', 'type', 'group', 'required', 'default', 'minRows', 'maxRows', 'itemFields'],
  repeater: ['key', 'label', 'type', 'group', 'required', 'default', 'minRows', 'maxRows', 'itemFields'],
  table: ['key', 'label', 'type', 'group', 'required', 'default', 'columns', 'minRows', 'maxRows'],
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

/** 合法 key：字母/下划线开头，仅字母数字下划线（防止空格/中文/正则元字符污染 njk 变量） */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** njk / JS 保留字：作为变量名会引发模板或原型链问题 */
const KEY_RESERVED: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor', 'true', 'false', 'null', 'undefined'])

/** schema 合法性校验（体检 #5）：设计器红字与保存层共用；返回错误映射，键为字段下标字符串 */
export function validateSchema(fields: FieldDef[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const keys = new Set<string>()
  fields.forEach((f, i) => {
    const k = String(f.key ?? '').trim()
    if (!k) errors[`${i}.key`] = 'key 不能为空'
    else if (!KEY_RE.test(k) || KEY_RESERVED.has(k)) errors[`${i}.key`] = 'key 只能含字母/数字/下划线，且不以数字开头'
    else if (keys.has(k)) errors[`${i}.key`] = 'key 重复'
    else keys.add(k)
    if (!String(f.label ?? '').trim()) errors[`${i}.label`] = '标签不能为空'
    if (f.minLength != null && f.maxLength != null && f.minLength > f.maxLength) {
      errors[`${i}.maxLength`] = '最大长度不能小于最小长度'
    }
    if (CONTAINER_TYPES.includes(f.type) && f.minRows != null && f.maxRows != null && f.minRows > f.maxRows) {
      errors[`${i}.maxRows`] = '最多行不能少于最少行'
    }
    if (CHOICE_TYPES.has(f.type)) {
      const vals = (f.options ?? []).map((o) => String(o.value ?? '').trim())
      if (!vals.length) errors[`${i}.options`] = '至少配置一个选项'
      else if (vals.some((v) => !v)) errors[`${i}.options`] = '选项值不能为空'
      else if (new Set(vals).size !== vals.length) errors[`${i}.options`] = '选项值不能重复'
    }
    if (NESTED_TYPES.includes(f.type)) {
      for (const [subKey, msg] of Object.entries(validateSchema(f.itemFields ?? []))) {
        errors[`${i}.itemFields.${subKey}`] = msg
      }
    }
  })
  return errors
}

const CHOICE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['radio', 'checkbox', 'select', 'select-multi'])

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

/** 表格列定义归一化：丢弃无 key 的列；cellType 非法回落 input */
function normalizeColumns(raw: unknown): TableColumn[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: TableColumn[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const rec = c as Record<string, unknown>
    const key = String(rec.key ?? '').trim()
    if (!key) continue
    const cellType = rec.cellType === 'url' || rec.cellType === 'richtext' ? rec.cellType : 'input'
    out.push({ key, label: String(rec.label ?? key), cellType })
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
    const typed = type as FieldType
    // 按类型白名单收口：存量 yaml 里切类型残留的脏属性在此丢弃，不再随保存回写（体检 #3）
    const full: FieldDef = {
      key,
      label: String(f.label ?? key),
      type: typed,
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
      min: toNum(f.min),
      max: toNum(f.max),
      minRows: toNum(f.minRows),
      maxRows: toNum(f.maxRows),
      itemFields: NESTED_TYPES.includes(typed) ? normalizeFields(f.itemFields) : undefined,
      columns: typed === 'table' ? normalizeColumns(f.columns) : undefined,
      upload: f.upload ? String(f.upload) : undefined,
    }
    out.push(retypeField(full, typed))
  }
  return out
}

const ARRAY_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['list', 'repeater', 'table', 'image-list', 'select-multi', 'checkbox'])

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
      // 容器的 minRows 对空数组同样生效（空数组不算「无值可跳过」）
      if (CONTAINER_TYPES.includes(f.type) && f.minRows) errors[f.key] = `${f.label}至少 ${f.minRows} 行`
      continue
    }
    switch (f.type) {
      case 'input':
      case 'textarea':
      case 'url': {
        const s = String(v)
        const msgs: string[] = []
        if (f.minLength && s.length < f.minLength) msgs.push(`至少 ${f.minLength} 字`)
        if (f.maxLength && s.length > f.maxLength) msgs.push(`最多 ${f.maxLength} 字`)
        if (f.pattern) {
          try {
            if (!new RegExp(f.pattern).test(s)) msgs.push('格式不正确')
          } catch {
            /* 非法正则忽略，不阻塞 */
          }
        }
        if (msgs.length) errors[f.key] = `${f.label}${msgs.join('、')}`
        break
      }
      case 'richtext': {
        const text = String(v).replace(/<[^>]*>/g, '')
        const msgs: string[] = []
        if (f.minLength && text.length < f.minLength) msgs.push(`至少 ${f.minLength} 字`)
        if (f.maxLength && text.length > f.maxLength) msgs.push(`最多 ${f.maxLength} 字`)
        if (msgs.length) errors[f.key] = `${f.label}${msgs.join('、')}`
        break
      }
      case 'number': {
        const n = Number(v)
        if (!Number.isFinite(n)) errors[f.key] = `${f.label}必须是数字`
        else if (f.min != null && n < f.min) errors[f.key] = `${f.label}不能小于 ${f.min}`
        else if (f.max != null && n > f.max) errors[f.key] = `${f.label}不能大于 ${f.max}`
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
      // 容器通用校验：list / repeater / table 都是「对象数组」，行内错误键 <key>.<行>.<子键>
      case 'list':
      case 'repeater':
      case 'table': {
        const rows = asArray(v) as Record<string, unknown>[]
        if (f.minRows && rows.length < f.minRows) errors[f.key] = `${f.label}至少 ${f.minRows} 行`
        else if (f.maxRows && rows.length > f.maxRows) errors[f.key] = `${f.label}最多 ${f.maxRows} 行`
        if (f.type === 'table') {
          // table 行是「列名 → 单元格值」的平铺映射，按 columns 的 cellType 校验
          const cols = f.columns ?? []
          rows.forEach((row, i) => {
            cols.forEach((c) => {
              const cell = (row as Record<string, unknown>)?.[c.key]
              if (cell == null || cell === '') return
              if (c.cellType === 'url' && !/^https?:\/\//i.test(String(cell))) {
                errors[`${f.key}.${i}.${c.key}`] = `${c.label}需为 http(s) 链接`
              }
            })
          })
        } else {
          // list / repeater 按 itemFields 递归校验（repeater 的子字段可以是任意原子/容器，深度上限在设计器/渲染层约束）
          const subFields = f.itemFields ?? []
          rows.forEach((row, i) => {
            const sub = validateModel(subFields, row ?? {})
            for (const [k, msg] of Object.entries(sub)) errors[`${f.key}.${i}.${k}`] = msg
          })
        }
        break
      }
      default:
        break // radio / select / image / date / color / switch：required 已覆盖
    }
  }
  return errors
}
