import * as cheerio from 'cheerio'
import { normalizeUrl, type UrlNormConfig } from './url-norm.js'
import type { StatRow } from './datasource.js'

export interface BadgeStyle {
  background: string
  color: string
  size: number
  offsetY: number
  offsetX: number
}

export interface BadgeInjectConfig {
  badgeAttr: string
  /** 角标取值列：clicks / totalClicks / 任意自定义数值列名 */
  clicksField: string
  urlNorm: UrlNormConfig
  badgeStyle: BadgeStyle
  /** 默认位置（来自工具配置）：文本 a 与图片 a 各自的出厂角标位置 */
  defaultPositions: { text: BadgePosition; image: BadgePosition }
  /** 角标样式覆盖（工具配置页「角标样式覆盖」组）：common → positions 先后叠加，后者覆盖同名属性 */
  customCss?: BadgeCustomCss
}

/** 九位置单独 + 公共 CSS（工具配置页维护；留空 = 内置默认生效） */
export interface BadgeCustomCss {
  common: string
  positions: Partial<Record<BadgePosition, string>>
}

/** 角标锚点位置：四角 + 四边中点 + 中心；写入 <a data-badge-position>，包内作者可手动覆盖 */
export type BadgePosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'left-center' | 'center' | 'right-center'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/**
 * 9 位置 = 锚点（相对 <a> 的 top/left 百分比）+ 角标自身 translate(-50%,-50%) 居中。
 * offset 语义统一为「屏幕方向」：offsetX 正=右移 / offsetY 正=下移，与位置无关；
 * 通过 transform calc 一次性合成，**不再注入 margin**——margin 与 transform 叠加
 * 会随位置改变视觉方向（右下角时 -9px 是向内而非向外），导致居中样式错乱（2026-11-16 用户反馈）。
 */
const POSITION_POINTS: Record<BadgePosition, string> = {
  'top-left': 'top:0;left:0',
  'top-center': 'top:0;left:50%',
  'top-right': 'top:0;left:100%',
  'left-center': 'top:50%;left:0',
  'center': 'top:50%;left:50%',
  'right-center': 'top:50%;left:100%',
  'bottom-left': 'top:100%;left:0',
  'bottom-center': 'top:100%;left:50%',
  'bottom-right': 'top:100%;left:100%',
}

export interface InjectResult {
  html: string
  /** 每个 URL（按表格原始 url）实际被标记的 <a> 数量；缺失 = 未命中，供表格核对 */
  matchCounts: Record<string, number>
}

/**
 * 用户自定义 CSS 清洗：折叠换行；剥离 position / transform / margin —— 这三者
 * 由锚点 + offset 体系接管（双写会破坏定位语义）；同名属性按追加顺序天然覆盖。
 */
function sanitizeCss(raw: string | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/[\r\n]+/g, '')
    .replace(/(?<![a-zA-Z-])(position|transform|margin)\s*:[^;}]*/gi, '')
    .replace(/;{2,}/g, ';')
    .replace(/^;+|;+$/g, '')
    .trim()
}

/** 取角标数值：内置两列优先，其余从用户自定义数值列 metrics 里取，缺失时回退 clicks */
export function metricValue(row: StatRow, field: string): number {
  const key = (field || 'clicks').trim()
  if (key === 'clicks') return row.clicks
  if (key.toLowerCase() === 'totalclicks') return row.totalClicks
  const custom = row.metrics?.[key] ?? row.metrics?.[key.toLowerCase()]
  return typeof custom === 'number' && Number.isFinite(custom) ? custom : row.clicks
}

/**
 * badge 注入（需求 5 / 7 / 18 / 定位改造）：
 * - 严格门控：只给「URL 归一命中且带 badgeAttr 的 <a>」打角标；一对多全部打标；
 *   未带属性的链接一律不动（批量补属性走 markBadges）；只处理 badge 副本
 * - 角标移入 <a> 内部（append），不再 after 挤占布局：<a> 的 inline position
 *   未声明时才改为 relative（承载绝对定位），已声明定位的保持原样
 * - 位置：<a data-badge-position> 优先；未声明时带图片的 a 居中、文本 a 右上
 * - 返回每个 URL 的实际标记次数，供表格「标记」列核对未匹配行
 */
export function injectBadges(html: string, stats: StatRow[], cfg: BadgeInjectConfig): InjectResult {
  const statMap = new Map<string, StatRow>()
  for (const row of stats) {
    const key = normalizeUrl(row.url, cfg.urlNorm)
    if (key !== '') statMap.set(key, row)
  }

  const $ = cheerio.load(html)
  const matchCounts: Record<string, number> = {}
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') ?? ''
    if (!/^https?:\/\//i.test(href)) continue
    if ($(el).attr(cfg.badgeAttr) === undefined) continue // 严格门控
    const stat = statMap.get(normalizeUrl(href, cfg.urlNorm))
    if (!stat) continue
    matchCounts[stat.url] = (matchCounts[stat.url] ?? 0) + 1
    const value = String(metricValue(stat, cfg.clicksField))

    // 定位容器：cheerio 读不到类样式，按 inline style 判断；未声明 position 视为 static
    const inlineStyle = $(el).attr('style') ?? ''
    if (!/position\s*:/i.test(inlineStyle)) {
      $(el).attr('style', 'position:relative;' + inlineStyle)
    }

    const hasImage = $(el).find('img').length > 0
    const declared = $(el).attr('data-badge-position') as BadgePosition | undefined
    const fallback = hasImage ? cfg.defaultPositions.image : cfg.defaultPositions.text
    const position: BadgePosition = declared && POSITION_POINTS[declared] ? declared : fallback
    $(el).attr('data-badge-position', position)

    const { offsetX, offsetY } = cfg.badgeStyle
    // 覆盖链：内置基础 → 用户公共样式 → 九位置单独样式（后写覆盖同名属性）
    const commonCss = sanitizeCss(cfg.customCss?.common)
    const posCss = sanitizeCss(cfg.customCss?.positions?.[position])
    $(el).append(
      '<span ' + cfg.badgeAttr + '="' + value + '" style="position:absolute;' +
        POSITION_POINTS[position] +
        ';transform:translate(calc(-50% + ' + offsetX + 'px), calc(-50% + ' + offsetY + 'px));' +
        'display:inline-block;background:' + cfg.badgeStyle.background +
        ';color:' + cfg.badgeStyle.color + ';font-size:' + cfg.badgeStyle.size + 'px;' +
        'line-height:1;padding:2px 5px;border-radius:9px;white-space:nowrap;z-index:9;' +
        (commonCss ? commonCss + ';' : '') +
        (posCss ? posCss + ';' : '') +
        '">' + value + '</span>',
    )
  }
  return { html: $.html(), matchCounts }
}

/**
 * 批量补属性（M6 先行方案 §3-5）：给「未带 badgeAttr」的 <a> 补空属性。
 * 只在 badge 副本上操作；有 stats 时只补 URL 命中的链接，**stats 为空时补全部 http(s) 链接**
 * （用户 2026-11-18：只要有 HTML 内容就能补，不必等统计数据；空属性后续有数据即可直接注入）。
 */
export function markBadges(html: string, stats: StatRow[], cfg: Pick<BadgeInjectConfig, 'badgeAttr' | 'urlNorm'>): string {
  const keys = new Set(stats.map((s) => normalizeUrl(s.url, cfg.urlNorm)).filter((k) => k !== ''))
  const hasStats = keys.size > 0
  const $ = cheerio.load(html)
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') ?? ''
    if (!/^https?:\/\//i.test(href)) continue
    if ($(el).attr(cfg.badgeAttr) !== undefined) continue
    if (!hasStats || keys.has(normalizeUrl(href, cfg.urlNorm))) $(el).attr(cfg.badgeAttr, '')
  }
  return $.html()
}
