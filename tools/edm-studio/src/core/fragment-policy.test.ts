import { describe, expect, it } from 'vitest'
import { mergeFragmentPolicy, policyAllows, toStringList } from './fragment-policy'

describe('黑白名单族/版本两级叠加', () => {
  it('用户示例：族 allow{c,d}/deny{a,b} + 版本 allow{a}/deny{c} → 允许 {a,d}', () => {
    const merged = mergeFragmentPolicy(
      { whitelist: ['c', 'd'], blacklist: ['a', 'b'] },
      { whitelist: ['a'], blacklist: ['c'] },
    )
    expect(merged.whitelist).toEqual(['c', 'd', 'a'])
    expect(merged.blacklist).toEqual(['b', 'c'])
    expect(policyAllows(merged, ['a'])).toBe(true)
    expect(policyAllows(merged, ['b'])).toBe(false)
    expect(policyAllows(merged, ['c'])).toBe(false)
    expect(policyAllows(merged, ['d'])).toBe(true)
  })

  it('版本未配置 → 族配置原样生效', () => {
    const fam = { whitelist: ['tpl_a'], blacklist: ['tpl_b'] }
    expect(mergeFragmentPolicy(fam, null)).toEqual({ whitelist: ['tpl_a'], blacklist: ['tpl_b'] })
    expect(mergeFragmentPolicy(fam, {})).toEqual(fam)
  })

  it('族白名单为空 = 全部可用；版本白名单不得反转为「只允许这些」', () => {
    const merged = mergeFragmentPolicy(
      { blacklist: ['tpl_x'] },
      { whitelist: ['tpl_y'], blacklist: ['tpl_z'] },
    )
    expect(merged.whitelist).toEqual([])
    expect(merged.blacklist).toEqual(['tpl_x', 'tpl_z'])
    expect(policyAllows(merged, ['tpl_y'])).toBe(true)
    expect(policyAllows(merged, ['tpl_x'])).toBe(false)
    expect(policyAllows(merged, ['tpl_z'])).toBe(false)
    expect(policyAllows(merged, ['tpl_other'])).toBe(true)
  })

  it('黑名单优先：同 ID 同时出现在版本白/黑名单 → 排除', () => {
    const merged = mergeFragmentPolicy(
      { whitelist: ['tpl_a'] },
      { whitelist: ['tpl_b'], blacklist: ['tpl_b'] },
    )
    expect(merged.blacklist).toContain('tpl_b')
    expect(policyAllows(merged, ['tpl_b'])).toBe(false)
  })

  it('名单文本/数组兼容归一', () => {
    expect(toStringList('a，b、c')).toEqual(['a', 'b', 'c'])
    expect(toStringList([' x ', 'x', ''])).toEqual(['x'])
    expect(toStringList(undefined)).toEqual([])
  })
})
