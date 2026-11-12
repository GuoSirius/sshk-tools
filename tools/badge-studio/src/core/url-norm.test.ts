import { describe, expect, it } from 'vitest'
import { normalizeUrl } from './url-norm'

describe('URL 归一（badge.urlNorm）', () => {
  it('去 UTM / 去 hash / 去末尾斜杠 / query 排序 / host 小写（路径保持原样）', () => {
    expect(
      normalizeUrl('HTTPS://Shop.Example.com/p/Cell-Culture/?utm_source=wechat&utm_campaign=dec&b=2&a=1#top'),
    ).toBe('https://shop.example.com/p/Cell-Culture?a=1&b=2')
  })

  it('可逐项关闭（现有产物带 UTM 时保留原链接形态）', () => {
    expect(
      normalizeUrl('https://a.com/x?utm_source=w&id=9', { ...structuredClone({
        stripUtm: false, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true,
      }) }),
    ).toBe('https://a.com/x?id=9&utm_source=w')
  })

  it('非 http 链接不做 query/host 处理；纯锚点归一为空（无法匹配统计）', () => {
    expect(normalizeUrl('#section')).toBe('')
    expect(normalizeUrl('mailto:x@y.com')).toBe('mailto:x@y.com')
  })

  it('空串安全', () => {
    expect(normalizeUrl('')).toBe('')
  })
})
