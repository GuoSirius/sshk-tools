import { marked } from 'marked'
import TurndownService from 'turndown'

/**
 * P1=C：Markdown ↔ HTML 互转。
 * ⚠️ HTML→MD→HTML **往返不保真**：wangEditor 是 HTML 富文本、Markdown 是其子集，
 *    复杂表格 / 嵌套样式 / 自定义 class 会丢失。仅提供「导入 md」「导出 md」单向能力，
 *    不要做自动往返同步（用户已确认接受该限制）。
 */
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string
}

export function htmlToMarkdown(html: string): string {
  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(html)
}
