/**
 * app:// 渲染层加载协议（用户 2026-11-18 拍板「必做」）：
 * 打包版不再用 loadFile(file://)——file:// 是 opaque origin，fetch/CORS/Worker/动态 chunk
 * 的行为与 dev 的 http 不一致，是 dev 与打包差异（monaco 高亮、弹框异常）的温床。
 * 改为标准特权协议 app://renderer/<path> → 主进程从 out/renderer 目录读文件回包，
 * dev 保持 http（默认）；dev 想同协议调试可设 SSHK_DEV_APP_PROTOCOL=1。
 * localres://（本地上传图片预览）与 app:// 必须在 app ready 前一次性注册特权。
 */
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { protocol } from 'electron'

const APP_SCHEME = 'app'
const APP_HOST = 'renderer'

/** 主窗口加载入口（hash 路由，无需 SPA fallback） */
export const APP_RENDERER_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

/** 必须在 app ready 之前调用（Electron 对自定义 protocol 的时序要求） */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    // localres：预览协议（见 local-res.ts），图片 + 音视频扩展名白名单（Range 回放靠 Response 206）
    // stream: true 是 <video>/<audio> 能播放的命门（2026-11-19 用户实测「下载完依然不能看」定位）：
    // 媒体栈要求协议按流式处理响应体，缺了它即使 Range/206 全对也无法播放；图片不受影响
    { scheme: 'localres', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    // app：标准协议（origin 解析 / 相对路径 / fetch / CORS 全按 http 语义）
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm', '.txt': 'text/plain', '.xml': 'application/xml',
}

/** app://renderer/<relPath> → rendererDir 下的静态文件（防目录穿越；hash 路由无需 fallback） */
export function installAppProtocolHandler(rendererDir: string): void {
  const root = path.resolve(rendererDir)
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const u = new URL(request.url)
      if (u.hostname.toLowerCase() !== APP_HOST) {
        return new Response('未知 app:// host', { status: 404 })
      }
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
      if (!rel) rel = 'index.html'
      const file = path.resolve(root, rel)
      if (file !== root && !file.startsWith(root + path.sep)) {
        return new Response('路径越界', { status: 403 })
      }
      const stat = await fsp.stat(file).catch(() => null)
      if (!stat?.isFile()) return new Response('资源不存在', { status: 404 })
      const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      const data = await fsp.readFile(file)
      return new Response(new Uint8Array(data), { headers: { 'content-type': mime } })
    } catch (err) {
      return new Response((err as Error).message || 'bad request', { status: 400 })
    }
  })
}
