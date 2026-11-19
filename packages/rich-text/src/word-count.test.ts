import { describe, expect, it } from 'vitest'
import { countHtmlWords, countText, htmlToPlainText } from './word-count'

describe('htmlToPlainText / countHtmlWords（plans/11 H1：HTML 提纯入库）', () => {
  it('剥标签并解码实体，块级标签转换行', () => {
    expect(htmlToPlainText('<p>你好，&nbsp;<b>世界</b></p><p>第二&amp;段</p>'))
      .toBe('你好， 世界\n第二&段')
  })

  it('script/style 整段丢弃', () => {
    expect(htmlToPlainText('<style>.x{color:red}</style><p>正文</p><script>alert(1)</script>'))
      .toBe('正文')
  })

  it('数字实体解码', () => {
    expect(htmlToPlainText('&#x4f60;&#22909;')).toBe('你好')
  })

  it('countHtmlWords 对 HTML 与等价纯文本同结果', () => {
    expect(countHtmlWords('<p>你好 React 是一个 UI 库</p>')).toBe(countText('你好 React 是一个 UI 库').words)
    expect(countHtmlWords(null)).toBe(0)
    expect(countHtmlWords('')).toBe(0)
  })
})

describe('countText（非空白字符数口径，2026-11-19 修正）', () => {
  it('空文本全为 0', () => {
    expect(countText('')).toEqual({ words: 0, chars: 0, charsNoSpace: 0, paragraphs: 0 })
  })

  it('纯中文：每字计 1（含中文标点）', () => {
    const s = countText('你好，世界。')
    expect(s.words).toBe(6)
    expect(s.chars).toBe(6)
    expect(s.charsNoSpace).toBe(6)
  })

  it('西文逐字符计（连续串不再只算 1 个字，修复「输入很多显示 2」）', () => {
    expect(countText('fsdfsdfdsfdsfs\nfsdfsd').words).toBe(20)
    expect(countText('hello world').words).toBe(10)
  })

  it('中英混排逐字符计', () => {
    // 你好(2) + React(5) + 是一个(3) + UI(2) + 库(1) → 13
    expect(countText('你好 React 是一个 UI 库').words).toBe(13)
  })

  it('字符数计/不计空格、字数=不计空格字符数', () => {
    const s = countText('a b\n\nc d')
    expect(s.chars).toBe(6) // 'a b' + 'c d'（换行不计）
    expect(s.charsNoSpace).toBe(4)
    expect(s.words).toBe(4)
  })

  it('段落数按非空行计', () => {
    expect(countText('第一段\n\n第二段\n\n\n第三段').paragraphs).toBe(3)
    expect(countText('\n\n\n').paragraphs).toBe(0)
  })
})
