import type { ToolVisionMessage } from '@sshk/shared'
import { parseCsvText, rowsToCsv, toStatRows } from './datasource.js'
import type { StatRow } from './datasource.js'
import { DEFAULT_OCR_LAYOUT, parseOcrLines, type OcrLayoutConfig } from './ocr-layout.js'

export type { OcrLayoutConfig } from './ocr-layout.js'
export { DEFAULT_OCR_LAYOUT } from './ocr-layout.js'

/**
 * 图片数据源统一入口：
 * 云端视觉模型 / 本机 PaddleOCR 都只需要产出「JSON 数组或带表头 CSV 文本」，
 * 这里统一收敛成标准 StatRow[]，再走原有 URL 归一 + badge 注入链路。
 * PaddleOCR 无表头的原始行文本则按工具配置里的版式规则解析。
 */

/** 云端视觉模型提示词：强约束输出，避免模型自由发挥编造数据 */
export const VISION_SYSTEM_PROMPT = [
  '你是邮件点击统计表格的识别助手。',
  '从图片中逐行读取「链接 / URL」与「点击次数」，输出严格的 JSON 数组，',
  '每一项形如 {"url":"https://...","clicks":12,"totalClicks":40}（totalClicks 可选）。',
  '要求：只输出 JSON 数组本身，不要 Markdown 代码块、不要解释文字；',
  '链接必须是完整 http(s) 地址；看不清的行直接跳过，禁止猜测或编造数值。',
].join('')

export const VISION_USER_PROMPT = '识别这张图片里的链接点击统计表，按系统要求输出 JSON 数组。'

/** 兼容单图字符串调用；新链路传数组以支持一次请求多张图 */
export function buildVisionMessages(imageDataUris: string[] | string): ToolVisionMessage[] {
  const uris = Array.isArray(imageDataUris) ? imageDataUris : [imageDataUris]
  return [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_USER_PROMPT },
        ...uris.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]
}

/** 找出文本里的第一个 JSON 数组（模型常在数组前后夹带说明文字） */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
  const object = JSON.parse(text) as { rows?: unknown } | unknown
  if (object && typeof object === 'object' && Array.isArray((object as { rows?: unknown }).rows)) {
    return (object as { rows: unknown }).rows
  }
  throw new Error('识别结果中没有 JSON 数据数组')
}

export interface ParseVisionOptions {
  /** 本机 OCR 版式；由工具配置提供，宿主不猜 */
  layout?: OcrLayoutConfig
}

/**
 * 解析识别结果：JSON 数组 → 带表头 CSV → 按配置解析的 OCR 原始行。
 * 三种方式都走同一套 URL / 数值清洗，最终结构完全一致。
 */
export function parseVisionResult(
  text: string,
  warnings: string[] = [],
  options: ParseVisionOptions = {},
): StatRow[] {
  const cleaned = text
    .replace(/```(?:json|csv)?/gi, '')
    .replace(/```/g, '')
    .trim()
  if (!cleaned) throw new Error('识别结果为空，请检查模型 / OCR 是否返回内容')

  let rows: StatRow[] = []
  try {
    const data = extractJsonArray(cleaned)
    if (!Array.isArray(data)) throw new Error('不是数组')
    rows = toStatRows(data as Record<string, unknown>[], warnings)
  } catch {
    try {
      rows = parseCsvText(cleaned, warnings)
    } catch {
      rows = parseOcrLines(cleaned, options.layout ?? DEFAULT_OCR_LAYOUT, warnings)
    }
  }
  if (rows.length === 0) warnings.push('识别结果未解析出有效数据行，请人工校对后重试')
  else warnings.push('图片识别结果请人工核对数值后再生成海报')
  return rows
}

/** 把识别结果回填成可人工校对的 CSV（含自定义数值列） */
export function toCsvText(rows: StatRow[]): string {
  return rowsToCsv(rows)
}
