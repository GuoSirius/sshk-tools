import * as XLSX from 'xlsx'

export interface StatRow {
  url: string
  clicks: number
  totalClicks: number
}

export interface ParsedDatasource {
  kind: 'xlsx' | 'csv' | 'json' | 'image'
  rows: StatRow[]
  warnings: string[]
}

/** URL / 链接列的候选名（宽松匹配） */
const URL_KEYS = ['url', '链接', '链接地址', 'link', 'href', '地址']
const CLICKS_KEYS = ['clicks', '点击次数', '点击', 'click_count']
const TOTAL_KEYS = ['totalclicks', '总点击', '总点击次数', 'total_clicks']

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const hit = Object.keys(row).find((k) => k.trim().toLowerCase() === key)
    if (hit !== undefined) return row[hit]
  }
  return undefined
}

function toRows(list: Record<string, unknown>[], warnings: string[]): StatRow[] {
  const rows: StatRow[] = []
  for (const raw of list) {
    const url = String(pick(raw, URL_KEYS) ?? '').trim()
    if (url === '') continue
    const clicks = Number(pick(raw, CLICKS_KEYS) ?? 0)
    const totalClicks = Number(pick(raw, TOTAL_KEYS) ?? clicks)
    if (!Number.isFinite(clicks) || clicks < 0) {
      warnings.push(`跳过无效行（点击数非数值）: ${url}`)
      continue
    }
    rows.push({ url, clicks: Math.round(clicks), totalClicks: Math.round(Number.isFinite(totalClicks) ? totalClicks : clicks) })
  }
  return rows
}

/** csv / 粘贴文本（含图片 OCR 校对后的文本）：表头行 + 数据行 */
export function parseCsvText(text: string, warnings: string[] = []): StatRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return []
  const delim = lines[0]!.includes('\t') ? '\t' : ','
  const header = lines[0]!.split(delim).map((h) => h.trim().toLowerCase())
  const urlIdx = header.findIndex((h) => URL_KEYS.includes(h))
  const clicksIdx = header.findIndex((h) => CLICKS_KEYS.includes(h))
  const totalIdx = header.findIndex((h) => TOTAL_KEYS.includes(h))
  if (urlIdx < 0 || clicksIdx < 0) {
    throw new Error(`缺少 URL / ${CLICKS_KEYS.join('/')} 表头列；第一行需含 url 与 clicks 列`)
  }
  const rows: StatRow[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
    const url = cells[urlIdx] ?? ''
    const clicks = Number(cells[clicksIdx] ?? 0)
    if (url === '' || !Number.isFinite(clicks)) {
      warnings.push(`跳过无效行: ${line.slice(0, 60)}`)
      continue
    }
    const total = totalIdx >= 0 ? Number(cells[totalIdx] ?? clicks) : clicks
    rows.push({ url, clicks: Math.round(clicks), totalClicks: Math.round(Number.isFinite(total) ? total : clicks) })
  }
  return rows
}

/** 四种数据源统一入口（D10）；image 走人工校对文本（OCR 集成留接口） */
export function parseDatasource(kind: 'xlsx' | 'csv' | 'json' | 'image', content: Buffer | string): ParsedDatasource {
  const warnings: string[] = []
  let rows: StatRow[] = []
  switch (kind) {
    case 'csv':
    case 'image': {
      rows = parseCsvText(String(content), warnings)
      if (kind === 'image') warnings.push('图片数据源为人工校对文本，请核对数值后再生成')
      break
    }
    case 'json': {
      const data = JSON.parse(String(content)) as unknown
      if (!Array.isArray(data)) throw new Error('JSON 数据源应为对象数组')
      rows = toRows(data as Record<string, unknown>[], warnings)
      break
    }
    case 'xlsx': {
      const wb = XLSX.read(content, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]!]
      if (!sheet) throw new Error('xlsx 无工作表')
      rows = toRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }), warnings)
      break
    }
  }
  if (rows.length === 0) warnings.push('未解析出有效数据行')
  return { kind, rows, warnings }
}
