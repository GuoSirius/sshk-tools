/**
 * HTML 源码美化 / 压缩（用户 2026-11-17：压缩后的 HTML 单行无高亮，需一键格式化便于修改）。
 * - 格式化：Prettier standalone，浏览器端可用（不依赖 Node API）；残缺 HTML 不做修复性改写；
 * - 压缩：只去掉标签间的格式化空白，保留文本语义空格与 <pre>/<code> 原始空白。
 * 与 rich-text 的 source-format 同源；放共享编辑器包供 badge-studio 等复用。
 */
import { format } from 'prettier/standalone'
import * as htmlPlugin from 'prettier/plugins/html'
import * as postcssPlugin from 'prettier/plugins/postcss'

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 标签配对检查：残缺内容直接保留原文，避免 Prettier 自动补标签后与用户实际存储不一致 */
function isBalanced(html: string): boolean {
  const stack: string[] = []
  const re = /<\/?([a-z][\w-]*)\b[^>]*>/gi
  for (const match of html.matchAll(re)) {
    const token = match[0]
    const name = match[1]!.toLowerCase()
    if (VOID_TAGS.has(name) || token.endsWith('/>')) continue
    if (token.startsWith('</')) {
      if (stack.pop() !== name) return false
    } else {
      stack.push(name)
    }
  }
  return stack.length === 0
}

export async function formatHtml(html: string): Promise<string> {
  if (!isBalanced(html)) return html
  try {
    return await format(html, {
      parser: 'html',
      plugins: [htmlPlugin],
      printWidth: 120,
      tabWidth: 2,
      htmlWhitespaceSensitivity: 'css',
    })
  } catch {
    return html
  }
}

/** Nunjucks 标记（插值/语句/注释）：Prettier 会在其内部折行，须占位后再格式化，原样还原 */
const TPL_TOKEN = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g
const TPL_PREFIX = '__SSHK_TPL_TOKEN_'

function guardTemplateTokens(text: string): { text: string; restore(out: string): string } | null {
  // 用户源码恰好含占位前缀时不格式化，避免误替换
  if (text.includes(TPL_PREFIX)) return null
  const tokens: string[] = []
  const masked = text.replace(TPL_TOKEN, (m) => `${TPL_PREFIX}${tokens.push(m) - 1}__`)
  return {
    text: masked,
    restore: (out) => out.replace(new RegExp(`${TPL_PREFIX}(\\d+)__`, 'g'), (_m, i: string) => tokens[Number(i)] ?? ''),
  }
}

/** njk 源码格式化：模板标记零改写，残缺 HTML / 解析失败原样返回 */
export async function formatNjk(njk: string): Promise<string> {
  const guarded = guardTemplateTokens(njk)
  if (!guarded || !isBalanced(guarded.text)) return njk
  try {
    const out = await format(guarded.text, {
      parser: 'html',
      plugins: [htmlPlugin],
      printWidth: 120,
      tabWidth: 2,
      htmlWhitespaceSensitivity: 'css',
    })
    return guarded.restore(out)
  } catch {
    return njk
  }
}

/** CSS 格式化（版本内联 style.css / 外置 css 共用）：模板插值原样保留，非法 CSS 原样返回 */
export async function formatCss(css: string): Promise<string> {
  const guarded = guardTemplateTokens(css)
  if (!guarded) return css
  try {
    const out = await format(guarded.text, {
      parser: 'css',
      plugins: [postcssPlugin],
      printWidth: 120,
      tabWidth: 2,
    })
    return guarded.restore(out)
  } catch {
    return css
  }
}

/** 压缩：去标签间格式化换行与多余缩进；<pre>/<code> 整块先占位保护 */
export function compactHtml(html: string): string {
  const protectedBlocks: string[] = []
  const masked = html.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const token = `<sshk-protected-block data-i="${protectedBlocks.length}"></sshk-protected-block>`
    protectedBlocks.push(block)
    return token
  })
  const compacted = masked
    .replace(/>\s*\n\s*</g, '><')
    .replace(/^\s+|\s+$/g, '')
  return compacted.replace(/<sshk-protected-block data-i="(\d+)"><\/sshk-protected-block>/g,
    (_m, i: string) => protectedBlocks[Number(i)] ?? '')
}
