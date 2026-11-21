import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { join, extname } from 'node:path'
import type { ShareContentResolverResult } from '@sshk/shared'
import { format } from '@sshk/shared'
import { resolveSafe } from '@sshk/repository'
import type { ShareRoute } from './routes'

/**
 * 静态服务域（P6-6 自 index.ts 拆出）：MIME 表、目录列表页、文章阅读页（plans/11 方案 B/C）。
 * 纯渲染函数：入参显式传 route/条目，不持有内核状态（由 server.ts 的 ShareHub 调用）。
 */
export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
}

/** readdirSync 的薄封装（集中在内核内，便于类型收窄）；避免遗漏 withFileTypes 参数。 */
export function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() || e.isDirectory())
    .map((e) => e.name)
}

/** HTML 转义（防目录名 XSS） */
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function mimeOf(absPath: string): string {
  return MIME[extname(absPath).toLowerCase()] ?? 'application/octet-stream'
}

export { createReadStream }

/** 目录列表页：HTML 转义防 XSS，条目带 URL 编码的 rel 路径。 */
export function renderIndex(route: ShareRoute, relDir: string): string {
  const absDir = relDir ? resolveSafe(route.root, relDir) : route.root
  const entries = existsSync(absDir)
    ? readdirSyncSafe(absDir).map((name) => {
        const full = join(absDir, name)
        const isDir = statSync(full).isDirectory()
        const relPath = relDir ? `${relDir}/${name}` : name
        const href = `/${route.token}/${relPath.split('/').map(encodeURIComponent).join('/')}` +
          (route.password ? `?ak=${encodeURIComponent(route.password)}` : '')
        return `<li><a href="${esc(href)}">${esc(name)}${isDir ? '/' : ''}</a></li>`
      }).sort((a, b) => a.localeCompare(b))
    : []
  const title = esc(route.label || '分享')
  const parent = relDir
    ? `<p><a href="/${route.token}/${relDir.split('/').slice(0, -1).map(encodeURIComponent).join('/')}${route.password ? `?ak=${encodeURIComponent(route.password)}` : ''}">← 上级</a></p>`
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:14px/1.6 system-ui,sans-serif;margin:32px;color:#c9d3ee;background:#0b0e1c}a{color:#5eb0ff;text-decoration:none}a:hover{text-decoration:underline}li{padding:2px 0}h1{font-size:18px}</style></head><body><h1>${title}</h1>${parent}<ul>${entries.join('')}</ul></body></html>`
}

/** 文章阅读页（plans/11 方案 B）：标题转义防 XSS；正文 html 是编辑器展示态（宿主已 toDisplayHtml），
 *  图片为外链或有效 ShareHub 图片链接，直接内嵌。 */
export function renderArticle(route: ShareRoute, content: ShareContentResolverResult): string {
  const title = esc(content.title || route.label || '文章')
  // 新闻详情排版（用户 2026-11-20 #131）：标题 → 发布时间/更新时间 → 描述 → 正文
  // 时间取 ISO 带 +08:00 字符串，统一走 shared format（北京时区，禁手拼/toISOString）
  const published = content.publishAt ? format(content.publishAt) : ''
  const updated = content.updatedAt ? format(content.updatedAt) : ''
  const metaParts: string[] = []
  if (published) metaParts.push(`发布时间：${esc(published)}`)
  if (updated) metaParts.push(`更新时间：${esc(updated)}`)
  const meta = metaParts.length ? `<p class="meta">${metaParts.join('　　')}</p>` : ''
  const summary = content.summary ? `<p class="summary">${esc(content.summary)}</p>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
      body{font:16px/1.8 system-ui,-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f2430;background:#fff}
      h1{font-size:28px;line-height:1.4;margin:0 0 10px;color:#161b26}
      .meta{color:#9aa1ad;font-size:13px;margin:0 0 16px;padding-bottom:14px;border-bottom:1px solid #e8eaf0}
      .summary{color:#5b6472;font-size:15px;line-height:1.75;margin:0 0 28px;padding:10px 14px;background:#f7f8fa;border-left:3px solid #5eb0ff;border-radius:0 4px 4px 0}
      .article img{max-width:100%;height:auto}
      pre{overflow:auto;background:#f5f6f8;padding:12px;border-radius:6px}
      blockquote{border-left:3px solid #5eb0ff;margin:0;padding-left:16px;color:#555}
      a{color:#2563eb}
    </style></head><body><article><h1>${title}</h1>${meta}${summary}<div class="article">${content.html}</div></article></body></html>`
}
