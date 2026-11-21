/**
 * 渲染层导出产物内核（plans/11 §六 · B12-T6 · P5-4）：三件套 ZIP（原始 HTML / 阅读页 HTML / MD）
 * + 单文件 HTML/MD。纯前端生成（fflate zipSync + Blob 下载），不占主进程 IPC。
 * 往返不保真（MD 单向，文档已声明）。
 *
 * 收敛口径（P5-4）：渲染层「导出产物」域的 fflate 直用只此一处——本包是唯一落点；
 * main 层（diagnostics/runtime-installer/file archive/工具 main ipc）与 backup 的 fflate 属
 * 其它域，不收编。文件名编码统一：safeName（标题→文件名安全段）+ toFileName（时间戳文件名，
 * re-export 自 @sshk/shared time.ts 唯一真相源）。
 */
import { zipSync, strToU8 } from 'fflate'
import { htmlToMarkdown, toDisplayHtml } from '@sshk/rich-text'
import type { ContentRecord } from '@sshk/shared'
import { toFileName } from '@sshk/shared'

/** 时间戳文件名唯一真相源（@sshk/shared time.ts）的导出域统一再出口 */
export { toFileName }

/** 标题 → 文件名安全段：非法字符替换 + 空白裁剪，兜底「未命名内容」 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名内容'
}

/** 阅读页 HTML：展示态 HTML（图片协议已转换）+ 简洁样式壳 */
function readingHtml(rec: ContentRecord): string {
  const title = rec.name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    body{font:16px/1.8 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f2430;background:#fff}
    h1{font-size:28px;border-bottom:1px solid #e8eaf0;padding-bottom:16px} img{max-width:100%}
    pre{overflow:auto;background:#f5f6f8;padding:12px;border-radius:6px} blockquote{border-left:3px solid #5eb0ff;margin:0;padding-left:16px;color:#555}
  </style></head><body><article><h1>${title}</h1>${rec.summary ? `<p style="color:#6b7280">${rec.summary}</p>` : ''}<div>${toDisplayHtml(rec.html)}</div></article></body></html>`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 三件套 ZIP：每篇一个子目录（批量时），单篇则直接放在 zip 根 */
export function exportTriple(records: ContentRecord[]): void {
  const entries: Record<string, Uint8Array> = {}
  const multi = records.length > 1
  for (const rec of records) {
    const base = safeName(rec.name)
    const dir = multi ? `${base}/` : ''
    entries[`${dir}原始内容.html`] = strToU8(rec.html)
    entries[`${dir}阅读页.html`] = strToU8(readingHtml(rec))
    entries[`${dir}内容.md`] = strToU8(htmlToMarkdown(rec.html))
  }
  const zip = zipSync(entries, { level: 6 })
  const singleName = records.length > 0 ? safeName(records[0]!.name) : '未命名内容'
  downloadBlob(new Blob([zip], { type: 'application/zip' }), multi ? '内容导出.zip' : `${singleName}.zip`)
}

/** 单文件阅读页 HTML（多篇时各下一份） */
export function exportHtml(records: ContentRecord[]): void {
  for (const rec of records) {
    downloadBlob(new Blob([readingHtml(rec)], { type: 'text/html;charset=utf-8' }), `${safeName(rec.name)}.html`)
  }
}

/** 单文件 Markdown（多篇时各下一份） */
export function exportMarkdown(records: ContentRecord[]): void {
  for (const rec of records) {
    downloadBlob(new Blob([htmlToMarkdown(rec.html)], { type: 'text/markdown;charset=utf-8' }), `${safeName(rec.name)}.md`)
  }
}
