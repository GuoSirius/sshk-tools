import { createHash } from 'node:crypto'
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
  clicksField: 'clicks' | 'totalClicks'
  urlNorm: UrlNormConfig
  badgeStyle: BadgeStyle
}

/**
 * badge 注入（需求 5 / 7 / 18）：
 * - 严格门控：只给「URL 归一命中且带 badgeAttr 的 <a>」打角标；
 *   未带属性的链接一律不动（批量补属性走 markBadges）
 * - 一对多全部打标；只处理 badge 副本，原 HTML 永不修改
 */
export function injectBadges(html: string, stats: StatRow[], cfg: BadgeInjectConfig): string {
  const statMap = new Map<string, StatRow>()
  for (const row of stats) {
    const key = normalizeUrl(row.url, cfg.urlNorm)
    if (key !== '') statMap.set(key, row)
  }

  const $ = cheerio.load(html)
  let matched = 0
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') ?? ''
    if (!/^https?:\/\//i.test(href)) continue
    if ($(el).attr(cfg.badgeAttr) === undefined) continue // 严格门控
    const stat = statMap.get(normalizeUrl(href, cfg.urlNorm))
    if (!stat) continue
    matched += 1
    const value = String(cfg.clicksField === 'totalClicks' ? stat.totalClicks : stat.clicks)
    // 角标以行内 sup 附加，样式由 configSnapshot 决定
    $(el).attr(cfg.badgeAttr, value)
    $(el).after(
      `<sup ${cfg.badgeAttr}="${value}" style="display:inline-block;margin-left:2px;` +
        `background:${cfg.badgeStyle.background};color:${cfg.badgeStyle.color};` +
        `font-size:${cfg.badgeStyle.size}px;line-height:1;padding:2px 5px;border-radius:9px;` +
        `position:relative;top:${cfg.badgeStyle.offsetY}px;left:${cfg.badgeStyle.offsetX}px;">${value}</sup>`,
    )
  }
  const result = $.html()
  if (matched === 0 && stats.length > 0) {
    // 调用方可根据 marker 判断「全部未命中」，提示批量补属性
    return result
  }
  return result
}

/**
 * 批量补属性（M6 先行方案 §3-5）：按 URL 命中后给「命中但未带属性」的 <a> 补 badgeAttr。
 * 只在 badge 副本上操作；stats 命中数 = 0 的链接不动。
 */
export function markBadges(html: string, stats: StatRow[], cfg: Pick<BadgeInjectConfig, 'badgeAttr' | 'urlNorm'>): string {
  const keys = new Set(stats.map((s) => normalizeUrl(s.url, cfg.urlNorm)).filter((k) => k !== ''))
  const $ = cheerio.load(html)
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href') ?? ''
    if (!/^https?:\/\//i.test(href)) continue
    if ($(el).attr(cfg.badgeAttr) !== undefined) continue
    if (keys.has(normalizeUrl(href, cfg.urlNorm))) $(el).attr(cfg.badgeAttr, '')
  }
  return $.html()
}

/** 源文件指纹：poster.sourceHash，用于「源已更新」提示（数据契约 §7） */
export function hashHtml(html: string): string {
  return `sha256:${createHash('sha256').update(html, 'utf8').digest('hex')}`
}
