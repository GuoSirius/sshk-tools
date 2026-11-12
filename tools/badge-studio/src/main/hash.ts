import { createHash } from 'node:crypto'

/** 源文件指纹：poster.sourceHash，用于「源已更新」提示（数据契约 §7）。仅主进程使用 */
export function hashHtml(html: string): string {
  return `sha256:${createHash('sha256').update(html, 'utf8').digest('hex')}`
}
