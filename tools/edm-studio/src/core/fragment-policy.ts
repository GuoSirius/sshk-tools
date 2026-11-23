/**
 * 黑白名单族/版本两级叠加（2026-11-23 用户拍板）。
 *
 * 族：定义本族片段「可用于哪些模板」——白名单非空则只允许名单内模板；黑名单优先。
 * 版本：在族结果上做**增量修正**——
 *   - 版本 whitelist = 追加允许（可把族黑名单里排除的模板捞回来）
 *   - 版本 blacklist = 追加排除（可把族白名单里允许的模板再排除）
 *   - 优先级：版本黑名单 > 版本白名单 > 族黑名单 > 族白名单
 *
 * 用户示例：族黑名单 [a,b]、白名单 [c,d] → 族允许 {c,d}；
 * 版本白名单 [a]、黑名单 [c] → 最终允许 {a,d}，排除 {b,c}。
 *
 * 合并结果在播种期写入 FragmentVersion.policy（单一结构），Repository / 邮件编辑器 /
 * 组合预览统一用 policyAllows 判定，无需各自实现叠加。
 */
import type { FragmentPolicy } from './edm-types.js'

export type { FragmentPolicy }

function uniq(list: string[]): string[] {
  return [...new Set(list.filter((x) => typeof x === 'string' && x.trim()))]
}

/**
 * 合并族与版本 policy → 最终生效 policy（可直接喂 policyAllows / 播种进 NeDB）。
 * 族白名单为空 = 本品牌全部模板可用，此时版本白名单不能反过来变成「只允许这些」的限制。
 */
export function mergeFragmentPolicy(fam?: FragmentPolicy | null, ver?: FragmentPolicy | null): FragmentPolicy {
  const famW = uniq(fam?.whitelist ?? [])
  const famB = uniq(fam?.blacklist ?? [])
  const verW = uniq(ver?.whitelist ?? [])
  const verB = uniq(ver?.blacklist ?? [])
  // 版本黑名单恒保留（黑名单优先）；被版本白名单点名且未被版本黑名单排除的族黑名单项才捞回
  const blacklist = uniq([...famB, ...verB]).filter((x) => verB.includes(x) || !verW.includes(x))
  const whitelist = famW.length ? uniq([...famW, ...verW]) : []
  return { whitelist, blacklist }
}

/** 是否允许：黑名单优先；白名单为空 = 全允许；否则只认白名单内 ID */
export function policyAllows(policy: FragmentPolicy | null | undefined, ids: string[]): boolean {
  if (!policy) return true
  if ((policy.blacklist ?? []).some((x) => ids.includes(x))) return false
  const wl = policy.whitelist ?? []
  if (wl.length === 0) return true
  return wl.some((x) => ids.includes(x))
}

/** 名单文本 / 旧数组兼容 → 去重字符串数组（表单值类型统一为 string[]） */
export function toStringList(v: unknown): string[] {
  if (Array.isArray(v)) return uniq(v.map((x) => String(x).trim()))
  if (typeof v !== 'string' || !v.trim()) return []
  return uniq(v.split(/[,，、]+/).map((x) => x.trim()))
}
