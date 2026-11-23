import { describe, expect, it } from 'vitest'
import { unifiedBrandId } from './edm-brand-identity'

describe('统一品牌身份（无迁移口径）', () => {
  it('任意品牌恒生成 brd_<code>，不再产生旧 cus_brd_* / brd_sys_* 前缀', () => {
    expect(unifiedBrandId('elabscience')).toBe('brd_elabscience')
    expect(unifiedBrandId('demo')).toBe('brd_demo')
    for (const code of ['elabscience', 'demo']) {
      const id = unifiedBrandId(code)
      expect(id.startsWith('cus_brd_')).toBe(false)
      expect(id.startsWith('brd_sys_')).toBe(false)
    }
  })
})
