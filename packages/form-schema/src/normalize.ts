/**
 * ④ 归一化层（plans/13 B0 重组）：容错解析 yaml 载入 / NeDB 读出的脏 fields，
 * 按类型白名单收口，得到干净的 FieldDef[]；外加数据模型默认值补齐。
 */
import { retypeField } from './catalog'
import { FIELD_TYPES, CONTAINER_TYPES, type FieldDef, type FieldOption, type FieldType, type TableColumn } from './schema'

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

/** 容错解析 yaml / 数据库载入的 fields 段：丢弃缺 key / 未知 type 的项 */
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
      itemFields: CONTAINER_TYPES.includes(typed) ? normalizeFields(f.itemFields) : undefined,
      columns: typed === 'table' ? normalizeColumns(f.columns) : undefined,
      upload: f.upload ? String(f.upload) : undefined,
      // 复合控件引用占位（plans/13 阶段 C）：仅容器类型保留
      controlKey: CONTAINER_TYPES.includes(typed) && f.controlKey ? String(f.controlKey) : undefined,
    }
    out.push(retypeField(full, typed))
  }
  return out
}

const ARRAY_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['repeater', 'table', 'image-list', 'select-multi', 'checkbox'])

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
