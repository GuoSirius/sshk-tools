/**
 * ③ 校验层（plans/13 B0 重组）：schema 合法性校验（设计器红字 + 保存层共用）
 * 与数据模型校验（保存前逐字段标红）。纯函数，无 DOM 依赖。
 */
import { CONTAINER_TYPES, type FieldDef, type FieldType } from './schema'

/** 合法 key：字母/下划线开头，仅字母数字下划线（防止空格/中文/正则元字符污染 njk 变量） */
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** njk / JS 保留字：作为变量名会引发模板或原型链问题 */
export const KEY_RESERVED: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor', 'true', 'false', 'null', 'undefined'])

const CHOICE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['radio', 'checkbox', 'select', 'select-multi'])

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
    if (CONTAINER_TYPES.includes(f.type)) {
      for (const [subKey, msg] of Object.entries(validateSchema(f.itemFields ?? []))) {
        errors[`${i}.itemFields.${subKey}`] = msg
      }
    }
  })
  return errors
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v]
}

/**
 * 数据模型校验（原 v5 §5.2）：返回错误映射。
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
      // 容器通用校验：repeater / table 都是「对象数组」，行内错误键 <key>.<行>.<子键>
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
