import { describe, expect, it } from 'vitest'
import { countText } from './word-count'

describe('countText（Word 口径近似）', () => {
  it('空文本全为 0', () => {
    expect(countText('')).toEqual({ words: 0, chars: 0, charsNoSpace: 0, paragraphs: 0 })
  })

  it('纯中文：每字计 1（含中文标点）', () => {
    const s = countText('你好，世界。')
    expect(s.words).toBe(6)
    expect(s.chars).toBe(6)
    expect(s.charsNoSpace).toBe(6)
  })

  it('西文连续串计 1 个字', () => {
    expect(countText('hello world').words).toBe(2)
    expect(countText('v2.0 release').words).toBe(3) // v2 与 0 分列（点号分隔）
  })

  it('中英混排', () => {
    // 你好(2) + React(1) + 是一个(3) + UI(1) + 库(1) → 8
    expect(countText('你好 React 是一个 UI 库').words).toBe(8)
  })

  it('字符数计/不计空格、换行不计入字符数且不粘连跨段单词', () => {
    const s = countText('a b\n\nc d')
    expect(s.chars).toBe(6) // 'a b' + 'c d'（换行不计）
    expect(s.charsNoSpace).toBe(4)
    expect(s.words).toBe(4) // a b c d 各 1，跨段不粘连
  })

  it('段落数按非空行计', () => {
    expect(countText('第一段\n\n第二段\n\n\n第三段').paragraphs).toBe(3)
    expect(countText('\n\n\n').paragraphs).toBe(0)
  })
})
