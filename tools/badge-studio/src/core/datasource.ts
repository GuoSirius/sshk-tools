export interface StatRow {
  url: string
  clicks: number
  totalClicks: number
  /** 用户自定义数值列（uv / pv / 下单数…）：列名 -> 数值，供角标取值与表格编辑 */
  metrics?: Record<string, number>
  /** 生成后回填：该 URL 在页面中被标记的次数（运行时展示态，不进 CSV） */
  matched?: number
}

export interface ParsedDatasource {
  kind: 'xlsx' | 'csv' | 'json' | 'image'
  rows: StatRow[]
  warnings: string[]
}

/** URL / 链接列的候选名（宽松匹配） */
export const URL_KEYS = ['url', '链接', '链接地址', 'link', 'href', '地址']
export const CLICKS_KEYS = ['clicks', '点击次数', '点击', 'click_count']
export const TOTAL_KEYS = ['totalclicks', '总点击', '总点击次数', 'total_clicks']
const RESERVED = new Set([...URL_KEYS, ...CLICKS_KEYS, ...TOTAL_KEYS].map((k) => k.toLowerCase()))

/** 数字 token 清洗：千分位、全角逗号、常见 OCR 尾随符号 */
export function parseNumberToken(raw: unknown, thousandsSeparator = true): number {
  const text = String(raw ?? '').trim()
  if (!text) return Number.NaN
  const cleaned = thousandsSeparator
    ? text.replace(/[,，]/g, '')
    : text.replace(/[，]/g, '')
  return Number(cleaned)
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const hit = Object.keys(row).find((k) => k.trim().toLowerCase() === key)
    if (hit !== undefined) return row[hit]
  }
  return undefined
}

/** 收集「非保留列」中的数值列；不认识 / 非数值的列直接忽略，不猜 */
function collectMetrics(raw: Record<string, unknown>): Record<string, number> | undefined {
  const metrics: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    const name = key.trim()
    if (!name || RESERVED.has(name.toLowerCase()) || String(value ?? '').trim() === '') continue
    const num = parseNumberToken(value)
    if (Number.isFinite(num)) metrics[name] = Math.round(num)
  }
  return Object.keys(metrics).length > 0 ? metrics : undefined
}

/** 记录数组 → 标准 StatRow；图片识别 / JSON / xlsx 共用同一套清洗规则 */
export function toStatRows(list: Record<string, unknown>[], warnings: string[]): StatRow[] {
  const rows: StatRow[] = []
  for (const raw of list) {
    const url = String(pick(raw, URL_KEYS) ?? '').trim()
    if (url === '') continue
    const clicks = parseNumberToken(pick(raw, CLICKS_KEYS) ?? 0)
    const totalRaw = pick(raw, TOTAL_KEYS)
    const totalClicks = totalRaw === undefined ? clicks : parseNumberToken(totalRaw)
    if (!Number.isFinite(clicks) || clicks < 0) {
      warnings.push(`跳过无效行（点击数非数值）: ${url}`)
      continue
    }
    const metrics = collectMetrics(raw)
    rows.push({
      url,
      clicks: Math.round(clicks),
      totalClicks: Math.round(Number.isFinite(totalClicks) ? totalClicks : clicks),
      ...(metrics ? { metrics } : {}),
    })
  }
  return rows
}

/** csv / 粘贴文本（含图片 OCR 校对后的文本）：表头行 + 数据行，支持任意自定义数值列 */
export function parseCsvText(
  text: string,
  warnings: string[] = [],
  options: { thousandsSeparator?: boolean } = {},
): StatRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return []
  const delim = lines[0]!.includes('\t') ? '\t' : ','
  const headers = lines[0]!.split(delim).map((h) => h.trim().replace(/^"|"$/g, ''))
  const lower = headers.map((h) => h.toLowerCase())
  const urlIdx = lower.findIndex((h) => URL_KEYS.includes(h))
  const clicksIdx = lower.findIndex((h) => CLICKS_KEYS.includes(h))
  const totalIdx = lower.findIndex((h) => TOTAL_KEYS.includes(h))
  if (urlIdx < 0 || clicksIdx < 0) {
    throw new Error(`缺少 URL / ${CLICKS_KEYS.join('/')} 表头列；第一行需含 url 与 clicks 列`)
  }
  const customCols = headers
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => index !== urlIdx && index !== clicksIdx && index !== totalIdx)
  const rows: StatRow[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
    const url = cells[urlIdx] ?? ''
    const clicks = parseNumberToken(cells[clicksIdx] ?? 0, options.thousandsSeparator ?? true)
    if (url === '' || !Number.isFinite(clicks)) {
      warnings.push(`跳过无效行: ${line.slice(0, 60)}`)
      continue
    }
    const total = totalIdx >= 0
      ? parseNumberToken(cells[totalIdx] ?? clicks, options.thousandsSeparator ?? true)
      : clicks
    const metrics: Record<string, number> = {}
    for (const { name, index } of customCols) {
      const num = parseNumberToken(cells[index], options.thousandsSeparator ?? true)
      if (Number.isFinite(num)) metrics[name] = Math.round(num)
    }
    rows.push({
      url,
      clicks: Math.round(clicks),
      totalClicks: Math.round(Number.isFinite(total) ? total : clicks),
      ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    })
  }
  return rows
}

/** 表格 → 可校对 CSV：动态带上所有自定义数值列，编辑表格后回填文本框 */
export function rowsToCsv(rows: StatRow[]): string {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row.metrics ?? {}))))
  const header = ['url', 'clicks', 'totalClicks', ...keys]
  const body = rows.map((row) => [
    row.url,
    row.clicks,
    row.totalClicks,
    ...keys.map((key) => row.metrics?.[key] ?? ''),
  ].join(','))
  return [header.join(','), ...body].join('\n')
}

/** 表格数据源统一入口（D10）；image 走 vision.ts 的云端模型 / 本机 OCR，
 *  仍可人工粘贴校对文本。xlsx 动态导入：本模块同时被渲染层引用，不能顶层引入 Node 侧依赖 */
export async function parseDatasource(kind: 'xlsx' | 'csv' | 'json' | 'image', content: Buffer | string): Promise<ParsedDatasource> {
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
      rows = toStatRows(data as Record<string, unknown>[], warnings)
      break
    }
    case 'xlsx': {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(content, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]!]
      if (!sheet) throw new Error('xlsx 无工作表')
      rows = toStatRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }), warnings)
      break
    }
  }
  if (rows.length === 0) warnings.push('未解析出有效数据行')
  return { kind, rows, warnings }
}
