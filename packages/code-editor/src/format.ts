/**
 * HTML 源码美化 / 压缩（用户 2026-11-17：压缩后的 HTML 单行无高亮，需一键格式化便于修改）。
 * - 格式化：Prettier standalone，浏览器端可用（不依赖 Node API）；残缺 HTML 不做修复性改写；
 * - 压缩：只去掉标签间的格式化空白，保留文本语义空格与 <pre>/<code> 原始空白。
 * 与 rich-text 的 source-format 同源；放共享编辑器包供 badge-studio 等复用。
 */
import { format } from 'prettier/standalone'
import * as htmlPlugin from 'prettier/plugins/html'

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
