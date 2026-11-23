import type { FieldDef } from './sample-schema'

/**
 * D-Q2 AI 文案助手（plans/05 §七）：
 * - buildSamplePrompt：fields schema → 示例数据生成 Prompt（schema 序列化 + 输出契约）
 * - extractJson / coerceSample：模型返回 → 合法 sample 数据（按 schema 转型 + 选项收紧）
 * - polishRichText：富文本润色（只改文字，不碰标签结构与属性）
 * 纯函数不触 window；chat 调用由 SampleForm 注入（便于单测与无 Provider 降级）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 示例数据生成 Prompt：schema 序列化 + 明确输出契约（纯 JSON、选项白名单、数量约束） */
export function buildSamplePrompt(fields: FieldDef[], context?: string): string {
  const spec = fields.map((f) => {
    const item: Record<string, unknown> = { key: f.key, label: f.label, type: f.type, required: Boolean(f.required) }
    if (f.options?.length) item.allowedValues = f.options.map((o) => o.value)
    if (f.max) item.maxCount = f.max
    if (f.maxRows) item.maxRows = f.maxRows
    if (f.min != null) item.min = f.min
    if (f.columns?.length) item.columns = f.columns.map((c) => ({ key: c.key, label: c.label, cellType: c.cellType }))
    if (f.itemFields?.length) {
      item.itemFields = f.itemFields.map((s) => ({
        key: s.key, label: s.label, type: s.type, required: Boolean(s.required),
        ...(s.options?.length ? { allowedValues: s.options.map((o) => o.value) } : {}),
      }))
    }
    return item
  })
  return [
    '你是 EDM 邮件示例数据生成器。根据字段 schema 生成一版真实可信的中文示例数据。',
    '只输出一个 JSON 对象，不要 markdown 围栏，不要任何解释文字。',
    '要求：文案贴合 label 语义、专业克制；radio / select 只能取 allowedValues 中的值；checkbox / select-multi 输出字符串数组；url 输出 http 或 https 开头的链接，number 输出数字，date 输出 YYYY-MM-DD，color 输出 #RRGGBB，switch 输出 true/false。',
    'image / image-list 输出 http 开头的占位图片 URL；list / repeater 输出 2-3 行对象数组（行结构遵循 itemFields，repeater 每行是一个产品/图文组合卡）；table 输出 2-3 行对象数组，每行按 columns 的 key 平铺单元格值。',
    context ? `主题背景：${context}` : '',
    `字段 schema：${JSON.stringify(spec)}`,
  ].filter(Boolean).join('\n')
}

/** 从模型返回剥出首个 JSON 对象（容忍 ```json 围栏与前后解释文字）；无法定位返回 null */
export function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

/** 从模型返回剥出 HTML（容忍围栏；取首个 < 到末个 >）；无法定位返回 null */
export function extractHtml(text: string): string | null {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('<')
  const end = body.lastIndexOf('>')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

/** 按 schema 把模型返回 coerce 成合法 sample：未知键丢弃、选项收紧到 allowedValues、数量截断 */
export function coerceSample(fields: FieldDef[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = data[f.key]
    switch (f.type) {
      case 'input':
      case 'textarea':
      case 'richtext':
      case 'url':
      case 'image':
        out[f.key] = raw == null ? '' : String(raw)
        break
      case 'number': {
        const n = Number(raw)
        out[f.key] = raw == null || !Number.isFinite(n) ? 0 : n
        break
      }
      case 'date': {
        const s = raw == null ? '' : String(raw)
        out[f.key] = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
        break
      }
      case 'color': {
        const s = raw == null ? '' : String(raw)
        out[f.key] = /^#[\da-fA-F]{6}$/.test(s) ? s : '#409EFF'
        break
      }
      case 'switch':
        out[f.key] = raw === true || raw === 'true'
        break
      case 'radio':
      case 'select': {
        const allowed = (f.options ?? []).map((o) => o.value)
        const v = raw == null ? '' : String(raw)
        out[f.key] = allowed.length > 0 && !allowed.includes(v) ? allowed[0] : v
        break
      }
      case 'checkbox':
      case 'select-multi': {
        const allowed = (f.options ?? []).map((o) => o.value)
        const list = Array.isArray(raw) ? raw.map(String) : []
        out[f.key] = allowed.length > 0 ? list.filter((v) => allowed.includes(v)) : list
        break
      }
      case 'image-list': {
        const list = (Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)]).filter(Boolean)
        out[f.key] = f.max ? list.slice(0, f.max) : list
        break
      }
      case 'list':
      case 'repeater': {
        const rows = Array.isArray(raw) ? (raw as unknown[]) : []
        const coerced = rows
          .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && !Array.isArray(r))
          .map((r) => coerceSample(f.itemFields ?? [], r))
        out[f.key] = f.maxRows ? coerced.slice(0, f.maxRows) : coerced
        break
      }
      case 'table': {
        const rows = Array.isArray(raw) ? (raw as unknown[]) : []
        const cols = f.columns ?? []
        const coerced = rows
          .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && !Array.isArray(r))
          .map((r) => {
            const row: Record<string, unknown> = {}
            for (const c of cols) {
              const v = r[c.key]
              row[c.key] = v == null ? '' : String(v)
            }
            return row
          })
        out[f.key] = f.maxRows ? coerced.slice(0, f.maxRows) : coerced
        break
      }
    }
  }
  return out
}

/** 生成 sample 数据（chat 注入式；解析失败抛带指引的错误，调用方走结构化提示） */
export async function generateSample(
  fields: FieldDef[],
  chat: (messages: ChatMessage[]) => Promise<string>,
  context?: string,
): Promise<Record<string, unknown>> {
  const text = await chat([{ role: 'user', content: buildSamplePrompt(fields, context) }])
  const json = extractJson(text)
  if (!json) throw new Error('模型没有返回可解析的 JSON，请重试或换用其他模型')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('模型返回的 JSON 不合法，请重试')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回的不是 JSON 对象，请重试')
  }
  return coerceSample(fields, parsed as Record<string, unknown>)
}

/** 富文本润色：保持标签结构与属性完全不变，只改写可见文字 */
export async function polishRichText(html: string, chat: (messages: ChatMessage[]) => Promise<string>): Promise<string> {
  const text = await chat([
    {
      role: 'user',
      content: [
        '你是 EDM 邮件文案润色助手。对下面 HTML 中的可见文字做专业、克制的中文润色：',
        '保持 HTML 标签、结构与属性（含链接 href、行内样式）完全不变，只改写标签之间的文字；',
        '不要增删标签，不要输出任何解释，直接返回完整 HTML。',
        `HTML：\n${html.slice(0, 8000)}`,
      ].join('\n'),
    },
  ])
  const result = extractHtml(text)
  if (!result) throw new Error('模型没有返回可用的 HTML，请重试')
  return result
}
