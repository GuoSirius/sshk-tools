/**
 * 源码查看弹窗的 HTML 美化/压缩（用户需求 2026-11-17）：
 * - 格式化：Prettier standalone，浏览器端可用（不依赖 Node API）；残缺 HTML 不做修复性改写；
 * - 压缩：只去掉标签间的格式化空白，保留文本语义空格与 <pre>/<code> 原始空白。
 * 注意这两项只改变弹窗展示文本；写回仍由编辑器 setHtml 统一归一化。
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
    // 格式化失败（插件解析边界）时保留原文，不让编辑器内容丢失
    return html
  }
}

/** 压缩：去标签间格式化换行与多余缩进；<pre>/<code> 整块先占位保护 */
export function compactHtml(html: string): string {
  const protectedBlocks: string[] = []
  // 用合法自定义标签占位，使其参与「标签间换行」清理，同时块内原文不被触碰
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
