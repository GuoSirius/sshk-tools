import { parseNumberToken, type StatRow } from './datasource.js'

/**
 * PaddleOCR 版式配置（用户可配，宿主不猜）。
 *
 * 三项本机信息决定解析规则：Python 路径 / PaddleOCR 版本与调用方式（在工具配置里），
 * 以及截图版式（本结构）。任何一项没确认，都不硬编码假设，由用户改配置即可校准。
 */
export interface OcrLayoutConfig {
  /** 链接与数字是否在同一行；false = URL 行 + 紧随其后的数字行 */
  linkNumberSameLine: boolean
  /** 数字是否带千分位逗号 / 全角逗号 */
  thousandsSeparator: boolean
  /** 跳过合计 / 总计行 */
  skipTotalRow: boolean
  /** 需要跳过的行关键字，逗号分隔 */
  skipKeywords: string
  /** 行内列顺序，逗号分隔；除 url/clicks/totalClicks 外都进自定义数值列 metrics */
  columnOrder: string
}

export const DEFAULT_OCR_LAYOUT: OcrLayoutConfig = {
  linkNumberSameLine: true,
  thousandsSeparator: true,
  skipTotalRow: true,
  skipKeywords: '合计,总计,小计,total,sum',
  columnOrder: 'url,clicks,totalClicks',
}

const URL_RE = /https?:\/\/[^\s,;"'|<>()]+/gi
const URL_COLUMNS = new Set(['url', '链接', 'link', 'href', '地址'])

function numbersIn(line: string, layout: OcrLayoutConfig): number[] {
  // 先挖掉 URL，否则域名 / 路径里的数字会被误当成点击数
  const stripped = line.replace(URL_RE, ' ')
  // 千分位逗号与「列分隔逗号」会打架：先把 1,234 这类数字保护成单 token，
  // 再按分隔符切分，避免 12,40 被拼成 1240、1,234 被切成 1 和 234。
  const protectedText = layout.thousandsSeparator
    ? stripped.replace(/\d{1,3}(?:,\d{3})+/g, (match) => match.replace(/,/g, '\u0001'))
    : stripped
  const out: number[] = []
  for (const token of protectedText.split(/[\s,，;；|]+/).map((t) => t.trim()).filter(Boolean)) {
    const restored = token.replace(/\u0001/g, ',')
    const cleaned = restored.replace(/^[^0-9+-]*/, '').replace(/[^0-9.,，]*$/, '')
    if (!cleaned) continue
    const num = parseNumberToken(cleaned, layout.thousandsSeparator)
    if (Number.isFinite(num)) out.push(Math.round(num))
  }
  return out
}

function toRow(url: string, nums: number[], columns: string[]): StatRow | null {
  if (!url || nums.length === 0) return null
  const row: StatRow = { url, clicks: 0, totalClicks: 0 }
  const metrics: Record<string, number> = {}
  let cursor = 0
  for (const column of columns) {
    if (URL_COLUMNS.has(column.toLowerCase())) continue
    const value = nums[cursor++]
    if (value === undefined) continue
    if (column === 'clicks') row.clicks = value
    else if (column.toLowerCase() === 'totalclicks') row.totalClicks = value
    else metrics[column] = value
  }
  if (row.totalClicks === 0) row.totalClicks = row.clicks
  if (Object.keys(metrics).length > 0) row.metrics = metrics
  return row
}

/** 按配置把 OCR 原始行文本解析成标准 StatRow[]；解析不了的行只警告、不猜数值 */
export function parseOcrLines(
  text: string,
  layout: OcrLayoutConfig = DEFAULT_OCR_LAYOUT,
  warnings: string[] = [],
): StatRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const skipWords = (layout.skipKeywords ?? '').split(/[,，;；]/).map((w) => w.trim().toLowerCase()).filter(Boolean)
  const columns = (layout.columnOrder || 'url,clicks,totalClicks')
    .split(/[,，]/).map((c) => c.trim()).filter(Boolean)
  const usable = lines.filter((line) =>
    !(layout.skipTotalRow && skipWords.some((word) => line.toLowerCase().includes(word))))
  const rows: StatRow[] = []

  for (let i = 0; i < usable.length; i++) {
    const line = usable[i]!
    const match = line.match(URL_RE)
    if (!match?.[0]) continue
    let nums = numbersIn(line, layout)
    // 两行版式：URL 行的下一行才是数字
    if (!layout.linkNumberSameLine && nums.length === 0 && usable[i + 1]) {
      nums = numbersIn(usable[i + 1]!, layout)
    }
    const row = toRow(match[0], nums, columns)
    if (row) rows.push(row)
    else warnings.push(`跳过无法解析的行: ${line.slice(0, 60)}`)
  }
  return rows
}
