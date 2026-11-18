import { describe, expect, it } from 'vitest'
import { injectBadges, markBadges } from './badge'
import type { BadgeInjectConfig } from './badge'

const cfg: BadgeInjectConfig = {
  badgeAttr: 'data-edm-badge',
  clicksField: 'clicks',
  urlNorm: { stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true },
  badgeStyle: { background: '#e60012', color: '#fff', size: 18, offsetY: -9, offsetX: -11 },
  defaultPositions: { text: 'top-right', image: 'center' },
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

  it('默认位置来自工具配置（data-badge-position 配置化），显式属性仍最优先', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">文本</a><a href="https://a.com/p/1?utm_source=x" data-edm-badge=""><img src="x.png"></a>'
    const configured = { ...cfg, defaultPositions: { text: 'bottom-left' as const, image: 'left-center' as const } }
    const { html: out } = injectBadges(html, stats, configured)
    expect(out).toContain('data-badge-position="bottom-left"')
    expect(out).toContain('data-badge-position="left-center"')
    // <a> 手写 data-badge-position 覆盖配置
    const customHtml = '<a href="https://a.com/p/1" data-edm-badge="" data-badge-position="center">A</a>'
    expect(injectBadges(customHtml, stats, configured).html).toContain('data-badge-position="center"')
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

  it('markBadges：无统计数据时给全部 http(s) 链接补空属性（不必等数据）', () => {
    const html = '<a href="https://a.com/p/1">A</a><a href="https://other.com">B</a><a href="#anchor">C</a>'
    const marked = markBadges(html, [], cfg)
    expect(marked).toContain('href="https://a.com/p/1" data-edm-badge')
    expect(marked).toContain('href="https://other.com" data-edm-badge')
    expect(marked).not.toContain('href="#anchor" data-edm-badge')
  })
})

describe('角标定位与样式覆盖（2026-11-16 批次）', () => {
  it('9 位置统一锚点 + transform calc 吸收 offset，无 margin 注入', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="" data-badge-position="center">A</a>'
    const out = injectBadges(html, stats, { ...cfg, badgeStyle: { ...cfg.badgeStyle, offsetX: 6, offsetY: -4 } }).html
    expect(out).toContain('top:50%;left:50%')
    expect(out).toContain('translate(calc(-50% + 6px), calc(-50% + -4px))')
    expect(out).not.toContain('margin:')
  })

  it('customCss：公共样式先叠加，位置样式后叠加覆盖同名属性', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="" data-badge-position="top-right">A</a>'
    const out = injectBadges(html, stats, {
      ...cfg,
      customCss: {
        common: 'padding:4px 10px;border-radius:3px',
        positions: { 'top-right': 'background:#0066cc;border-radius:14px' },
      },
    }).html
    // 公共属性在基础样式之后
    expect(out).toContain('padding:4px 10px')
    // 位置样式在公共之后 → border-radius 以位置值为准（CSS 后写覆盖）
    expect(out).toContain('border-radius:14px')
    expect(out.indexOf('border-radius:14px')).toBeGreaterThan(out.indexOf('border-radius:3px'))
  })

  it('customCss 清洗：position / transform / margin 由锚点体系接管，用户写也不生效', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    const out = injectBadges(html, stats, {
      ...cfg,
      customCss: { common: 'position:fixed;transform:scale(2);margin:99px;background:#123456', positions: {} },
    }).html
    expect(out).not.toContain('position:fixed')
    expect(out).not.toContain('transform:scale(2)')
    expect(out).not.toContain('margin:99px')
    // background-position 这类含 position 子串的合法属性不被误伤
    const keep = injectBadges(html, stats, {
      ...cfg,
      customCss: { common: 'background-position:center top', positions: {} },
    }).html
    expect(keep).toContain('background-position:center top')
  })

  it('customCss 缺省（undefined / 空串）= 内置默认，无额外分号残留', () => {
    const html = '<a href="https://a.com/p/1" data-edm-badge="">A</a>'
    const out = injectBadges(html, stats, cfg).html
    expect(out).toContain('border-radius:9px')
    expect(out).not.toContain(';;')
  })
})
