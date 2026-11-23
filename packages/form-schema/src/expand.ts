/**
 * ⑥ 复合控件展开层（plans/13 阶段 C 净新增）：design-time 引用 + runtime 展开。
 * 存储树中复合控件以 `{ key, label, type: 'repeater', controlKey }` 占位；
 * 渲染、校验、导出前一律先 expandFields 展开为控件 root 深拷贝。
 * 防环：展开深度随引用链递增，超过配置上限直接抛错（结构上无法成环渲染）。
 * 深度上限不再写死常量（用户 2026-11-23 需求）：由「表单设计」工具配置
 * `app.modules.formManager.maxCompositeDepth` 下发（默认 5，0 = 无限制）。
 */
import type { FieldDef } from './schema'

/** 深度配置缺省值（表单设计工具配置页同步声明，默认 5） */
export const DEFAULT_COMPOSITE_DEPTH = 5

/** 无限制哨兵（配置 0 归一化结果） */
export const UNLIMITED_DEPTH = Number.POSITIVE_INFINITY

/**
 * 归一化配置值：非法 / 负数回落默认 5；0 = 无限制（Infinity）。
 * Infinity 直通（递归展开会把已归一化的上限再传进来，重复归一化不得塌缩回默认值）。
 * 主进程服务与渲染层共用同一口径。
 */
export function normalizeCompositeDepth(raw: unknown): number {
  if (raw === UNLIMITED_DEPTH) return UNLIMITED_DEPTH
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COMPOSITE_DEPTH
  return n === 0 ? UNLIMITED_DEPTH : n
}

/** 控件引用解析器：key → 控件 root FieldDef（不存在返回 undefined） */
export type ControlResolver = (key: string) => FieldDef | undefined

export interface ExpandOptions {
  /** 当前引用链深度（内部递归用） */
  depth?: number
  /** 展开深度上限（配置值经 normalizeCompositeDepth 归一化；缺省按默认 5） */
  maxDepth?: number
  /** 当前展开路径上的控件 key（防环：无限制模式下也能刹住循环引用，内部递归用） */
  path?: string[]
}

/**
 * 递归展开引用占位节点为控件 root 深拷贝（保留占位节点的 key/label/required 覆盖）。
 * 抛错场景：引用链超深（超出配置上限）、循环引用（路径集合检测，无限制模式同样生效）、引用的控件不存在。
 */
export function expandFields(fields: FieldDef[], resolve: ControlResolver, opts: ExpandOptions = {}): FieldDef[] {
  const depth = opts.depth ?? 0
  // 0 = 无限制（用户口径），在此统一归一化，调用方传原始配置值即可
  const maxDepth = normalizeCompositeDepth(opts.maxDepth ?? DEFAULT_COMPOSITE_DEPTH)
  const path = opts.path ?? []
  const out: FieldDef[] = []
  for (const f of fields ?? []) {
    if (f.controlKey) {
      if (depth >= maxDepth) {
        throw new Error(`复合控件嵌套超过配置上限（${maxDepth} 层）：${f.label || f.controlKey}`)
      }
      if (path.includes(f.controlKey)) {
        throw new Error(`复合控件循环引用：${[...path, f.controlKey].join(' → ')}`)
      }
      const root = resolve(f.controlKey)
      if (!root) throw new Error(`复合控件不存在或已被删除：${f.label || f.controlKey}`)
      const inner = expandFields([root], resolve, { depth: depth + 1, maxDepth, path: [...path, f.controlKey] })[0]
      if (inner) {
        out.push({
          ...inner,
          key: f.key || inner.key,
          label: f.label || inner.label,
          required: f.required ?? inner.required,
          group: f.group ?? inner.group,
        })
      }
      continue
    }
    if (f.itemFields?.length) {
      out.push({ ...f, itemFields: expandFields(f.itemFields, resolve, { depth, maxDepth, path }) })
    } else {
      out.push({ ...f })
    }
  }
  return out
}

/** 收集存储树中的全部引用键（含嵌套 itemFields），供 FormDoc.controlsUsed 反查与删除拦截 */
export function collectControlKeys(fields: unknown): string[] {
  const out: string[] = []
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const f = item as Record<string, unknown>
      if (typeof f.controlKey === 'string' && f.controlKey) out.push(f.controlKey)
      walk(f.itemFields)
    }
  }
  walk(fields)
  return [...new Set(out)]
}

/**
 * 展开后树的最大容器嵌套深度（1 起）：用于保存前校验（≤ 配置上限）。
 * 引用超深/成环/悬空引用会随 expandFields 抛错，由调用方转 validation。
 */
export function compositeDepth(fields: FieldDef[], resolve: ControlResolver, opts: ExpandOptions = {}): number {
  const depthOf = (list: FieldDef[], base: number): number => {
    let max = base
    for (const f of expandFields(list, resolve, opts)) {
      if (f.itemFields?.length) max = Math.max(max, depthOf(f.itemFields, base + 1))
    }
    return max
  }
  return depthOf(fields, fields.some((f) => f.itemFields?.length || f.controlKey) ? 1 : 0)
}
