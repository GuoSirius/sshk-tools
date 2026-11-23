import { describe, expect, it } from 'vitest'
import {
  FAVICON_EXTS,
  isCodeReadonly,
  META_CODE_MODE,
  resolveFavicon,
  resolveMetaCode,
  validateMetaIdentity,
} from './meta-contract'

describe('EDM 元数据统一契约', () => {
  it('code 当前为目录名只读镜像，单点开关预留独立业务编码', () => {
    expect(META_CODE_MODE).toBe('mirror')
    expect(isCodeReadonly()).toBe(true)
    expect(resolveMetaCode('v3', 'biz-code')).toBe('v3')
    // 模拟未来切换：数据层与后端无需再改
    expect(resolveMetaCode('v3', ' biz-code ', 'independent')).toBe('biz-code')
    expect(resolveMetaCode('v3', '', 'independent')).toBe('v3')
  })

  it('四级 code/name 必填口径统一', () => {
    expect(validateMetaIdentity({ code: 'demo', name: 'Demo' })).toEqual([])
    expect(validateMetaIdentity({ code: '  ', name: '' })).toEqual(['code 必填', 'name 必填'])
    expect(validateMetaIdentity(null)).toEqual(['code 必填', 'name 必填'])
  })

  it('favicon 允许全部图片类型，继承按 版本→族→类型→品牌', () => {
    for (const ext of ['ico', 'png', 'svg', 'webp', 'jpg', 'avif']) expect(FAVICON_EXTS).toContain(`.${ext}`)
    expect(resolveFavicon('  ', 'parent.ico')).toBe('parent.ico')
    expect(resolveFavicon('own.svg', 'parent.ico')).toBe('own.svg')
  })
})
