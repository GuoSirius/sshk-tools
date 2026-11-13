import { describe, expect, it } from 'vitest'
import { injectBadges, markBadges } from './badge'
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
    const { html: out, matchCounts } = injectBadges(html, stats, cfg)
    expect(out).toContain('>12</span>')
    expect(out).toContain('data-edm-badge="12"')
    // p/2 未命中统计，不打标
    expect(out).not.toMatch(/<a href="https:\/\/a\.com\/p\/2"[^>]*data-edm-badge="[^"]+"/)
    expect(matchCounts).toEqual({ 'https://a.com/p/1?utm_source=w': 1 })
  })

  it('URL 归一跨形式命中（UTM / hash / 大小写）', () => {
    const html = '<a href="HTTPS://A.COM/p/1/?utm_campaign=x&utm_source=w#top" data-edm-badge="">A</a>'
    expect(injectBadges(html, stats, cfg).html).toContain('>12</span>')
  })

  it('原 HTML 不被修改（副本语义）', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    injectBadges(html, stats, cfg)
    expect(html).toBe('<a href="https://a.com/p/1" data-edm-badge="">A</a>')
  })

  it('totalClicks 字段切换（D9）', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    expect(injectBadges(html, stats, { ...cfg, clicksField: 'totalClicks' }).html).toContain('>30</span>')
  })

  it('定位改造：static 的 a 设为 relative，角标移入 a 内并默认右上', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    const { html: out } = injectBadges(html, stats, cfg)
    expect(out).toContain('position:relative')
    expect(out).toContain('data-badge-position="top-right"')
    // 角标在 <a> 内部（append），不再 after 挤占布局
    expect(out).toMatch(/<\/span><\/a>/)
    expect(out).not.toContain('</a><span')
  })

  it('带图片的 a 默认居中；已有 inline 定位保持原样；data-badge-position 优先', () => {
    const imgHtml = '<a href="https://a.com/p/1" data-edm-badge=""><img src="x.png"></a>'
    expect(injectBadges(imgHtml, stats, cfg).html).toContain('data-badge-position="center"')

    const absoluteHtml = '<a href="https://a.com/p/1" data-edm-badge="" style="position:absolute">A</a>'
    const { html: out } = injectBadges(absoluteHtml, stats, cfg)
    expect(out).not.toContain('position:relative;position')
    expect(out).toContain('style="position:absolute"')

    const customHtml = '<a href="https://a.com/p/1" data-edm-badge="" data-badge-position="bottom-left">A</a>'
    expect(injectBadges(customHtml, stats, cfg).html).toContain('data-badge-position="bottom-left"')
  })

  it('一对多：同一 URL 命中多个 <a> 时计数累加', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a><a href="https://a.com/p/1?utm_source=x" data-edm-badge="">B</a>'
    const { matchCounts } = injectBadges(html, stats, cfg)
    expect(matchCounts['https://a.com/p/1?utm_source=w']).toBe(2)
  })

  it('markBadges：给命中但未带属性的链接补属性（批量补属性预处理）', () => {
    const html = '<a href="https://a.com/p/1">A</a><a href="https://other.com">B</a>'
    const marked = markBadges(html, stats, cfg)
    expect(marked).toContain('href="https://a.com/p/1" data-edm-badge')
    expect(marked).not.toContain('href="https://other.com" data-edm-badge')
  })
})
