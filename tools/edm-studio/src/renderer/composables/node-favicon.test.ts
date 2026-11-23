import { describe, expect, it } from 'vitest'
import { inheritedFavicon } from './node-favicon'

describe('favicon 继承链：版本 → 族 → 类型 → 品牌', () => {
  const chain = { brand: 'brand.ico', category: '', family: 'family.svg' }

  it('类型回退品牌', () => {
    expect(inheritedFavicon('category', chain)).toBe('brand.ico')
  })

  it('族优先类型，类型空则回退品牌', () => {
    expect(inheritedFavicon('family', chain)).toBe('brand.ico')
    expect(inheritedFavicon('family', { ...chain, category: 'cat.png' })).toBe('cat.png')
  })

  it('版本优先族，族空则逐级回退', () => {
    expect(inheritedFavicon('version', chain)).toBe('family.svg')
    expect(inheritedFavicon('version', { ...chain, family: '' })).toBe('brand.ico')
  })

  it('品牌自身没有上级', () => {
    expect(inheritedFavicon('brand', chain)).toBe('')
  })
})
