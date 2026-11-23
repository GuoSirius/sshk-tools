import { describe, expect, it } from 'vitest'
import { defaultSaveAsName, isEntityKind, pickValidTarget, shouldDerive } from './save-as-routing'

describe('另存为路由', () => {
  it('仅实体 system→custom 走派生', () => {
    expect(shouldDerive('system', 'custom', 'brand')).toBe(true)
    expect(shouldDerive('system', 'custom', 'family')).toBe(true)
    expect(shouldDerive('system', 'custom', 'version')).toBe(true)
  })

  it('css 目录/文件一律不走派生（修复「系统品牌「」不存在」）', () => {
    for (const kind of ['cssDir', 'cssFile'] as const) {
      expect(shouldDerive('system', 'custom', kind)).toBe(false)
      expect(isEntityKind(kind)).toBe(false)
    }
  })

  it('同根 / 自定义→系统均不走派生', () => {
    expect(shouldDerive('system', 'system', 'version')).toBe(false)
    expect(shouldDerive('custom', 'custom', 'brand')).toBe(false)
    expect(shouldDerive('custom', 'system', 'family')).toBe(false)
  })
})

describe('默认新名称', () => {
  it('css 文件保留 .css 后缀', () => {
    expect(defaultSaveAsName('cssFile', 'demo/css/base.css')).toBe('base-copy.css')
    expect(defaultSaveAsName('cssFile', 'BASE.CSS')).toBe('BASE-copy.css')
  })

  it('目录/实体沿用末段 -copy', () => {
    expect(defaultSaveAsName('brand', 'demo')).toBe('demo-copy')
    expect(defaultSaveAsName('cssDir', 'demo/template/css')).toBe('css-copy')
  })
})

describe('目标路径回落', () => {
  it('切换目标根后旧路径失效则取首候选', () => {
    expect(pickValidTarget('elabscience/css', ['css', 'procell/css'])).toBe('css')
  })
  it('仍在候选集则保留用户选择', () => {
    expect(pickValidTarget('procell/template/css', ['css', 'procell/template/css'])).toBe('procell/template/css')
  })
})
