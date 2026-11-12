import nunjucks from 'nunjucks'
import juice from 'juice'
import { htmlMinify } from './minify.js'
import { createHash } from 'node:crypto'

// 模板安全配置（数据契约 settings render: strict + autoEscape）
nunjucks.configure({ autoescape: true, throwOnUndefined: true })

export interface RenderInput {
  /** 模板版本 njk 源码 */
  templateHtml: string
  /** 槽位绑定：slot key → 片段版本渲染产物（已渲染 HTML 字符串） */
  bindings: Record<string, string>
  data: Record<string, unknown>
  render: { strict: boolean; autoEscape: boolean }
}

export interface RenderStages {
  assembled: string
  inlined: string
  final: string
  sourceHash: string
}

/**
 * 三阶段渲染（需求 17 / 数据契约 §7）：
 * ① assembled：nunjucks 渲染（槽位以声明式变量注入，片段产物作为已渲染 HTML 传入）
 * ② inlined：juice CSS 内联（邮件客户端兼容）
 * ③ final：html-minifier-terser 压缩 → 复制代码 / 分享链接指向它
 */
export async function renderMail(input: RenderInput): Promise<RenderStages> {
  const template = `{{ slot_header }}{{ slot_body }}{{ slot_footer }}`
  void template
  // 槽位通过统一前缀变量注入模板：模板内用 {{ slot_header | safe }} 引用
  const context = {
    ...input.data,
    ...Object.fromEntries(Object.entries(input.bindings).map(([k, v]) => [`slot_${k}`, v])),
  }
  nunjucks.configure({ autoescape: input.render.autoEscape, throwOnUndefined: input.render.strict })
  const assembled = nunjucks.renderString(input.templateHtml, context)

  const inlined = juice(assembled, {
    removeStyleTags: true,
    preserveMediaQueries: true,
    applyStyleTags: true,
  })
  const final = await htmlMinify(inlined)
  return {
    assembled,
    inlined,
    final,
    sourceHash: `sha256:${createHash('sha256').update(final, 'utf8').digest('hex')}`,
  }
}

/** 片段版本渲染：片段 njk + 自己的数据 → HTML（供槽位绑定） */
export function renderFragment(fragmentHtml: string, data: Record<string, unknown>): string {
  return nunjucks.renderString(fragmentHtml, data)
}
