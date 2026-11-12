import { describe, expect, it } from 'vitest'
import { hashHtml, injectBadges, markBadges } from './badge'
import type { BadgeInjectConfig } from './badge'

const cfg: BadgeInjectConfig = {
  badgeAttr: 'data-edm-badge',
  clicksField: 'clicks',
  urlNorm: { stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true },
  badgeStyle: { background: '#e60012', color: '#fff', size: 18, offsetY: -9, offsetX: -11 },
}

const stats = [{ url: 'https://a.com/p/1?utm_source=w', clicks: 12, totalClicks: 30 }]

describe('badge 注入（严格门控）', () => {
  it('带属性的命中链接打标；未带属性的不动', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a><a href="https://a.com/p/2" data-edm-badge="">B</a>'
    const out = injectBadges(html, stats, cfg)
    expect(out).toContain('>12</sup>')
    expect(out).toContain('data-edm-badge="12"')
    // p/2 未命中统计，不打标
    expect(out).not.toMatch(/<a href="https:\/\/a\.com\/p\/2"[^>]*data-edm-badge="[^"]+"/)
  })

  it('URL 归一跨形式命中（UTM / hash / 大小写）', () => {
    const html = '<a href="HTTPS://A.COM/p/1/?utm_campaign=x&utm_source=w#top" data-edm-badge="">A</a>'
    expect(injectBadges(html, stats, cfg)).toContain('>12</sup>')
  })

  it('原 HTML 不被修改（副本语义）', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    injectBadges(html, stats, cfg)
    expect(html).toBe('<a href="https://a.com/p/1" data-edm-badge="">A</a>')
  })

  it('totalClicks 字段切换（D9）', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    expect(injectBadges(html, stats, { ...cfg, clicksField: 'totalClicks' })).toContain('>30</sup>')
  })

  it('markBadges：给命中但未带属性的链接补属性（批量补属性预处理）', () => {
    const html = '<a href="https://a.com/p/1">A</a><a href="https://other.com">B</a>'
    const marked = markBadges(html, stats, cfg)
    expect(marked).toContain('href="https://a.com/p/1" data-edm-badge')
    expect(marked).not.toContain('href="https://other.com" data-edm-badge')
  })

  it('hashHtml 稳定（源更新检测）', () => {
    expect(hashHtml('<p>x</p>')).toBe(hashHtml('<p>x</p>'))
    expect(hashHtml('<p>x</p>')).not.toBe(hashHtml('<p>y</p>'))
  })
})
