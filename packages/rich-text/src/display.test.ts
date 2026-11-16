import { describe, expect, it } from 'vitest'
import { toDisplayHtml, toDisplaySrc, toStoredHtml } from './display'

describe('rich-text 显示层转换（file:// ↔ localres://）', () => {
  it('HTML 整段往返对称', () => {
    const stored = '<p><img src="file:///D:/upload/a.png"></p>'
    const display = toDisplayHtml(stored)
    expect(display).toContain('localres:///D:/upload/a.png')
    expect(toStoredHtml(display)).toBe(stored)
  })

  it('单 src：仅 file:// 前缀转换，其余原样', () => {
    expect(toDisplaySrc('file:///D:/x.png')).toBe('localres:///D:/x.png')
    expect(toDisplaySrc('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png')
    expect(toDisplaySrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(toDisplaySrc('')).toBe('')
  })

  it('已转换的显示值不会二次加前缀', () => {
    expect(toDisplayHtml(toDisplayHtml('file:///a.png'))).toBe(toDisplayHtml('file:///a.png'))
  })
})
