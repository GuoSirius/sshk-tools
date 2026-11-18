import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { protocol } from 'electron'
import { collectResRoots, isAllowedResPath, RES_MIME_BY_EXT } from './local-res-rules'

/**
 * localres:// 预览协议（用户反馈 2026-11-16：本地上传 profile 回填 file:// URL，
 * Chromium 禁止 http 页面加载本地资源 → 「Not allowed to load local resource」预览全挂）。
 *
 * 存储契约不动（local profile 仍回填 file://，生成产物本地有效）；
 * 仅渲染层【预览显示】把 file:/// 转成 localres:///，由主进程白名单放行：
 * 允许根 = 全局本地上传目录 + 各工具 localDir 覆盖目录，且仅放行图片扩展名。
 * 白名单判定纯逻辑在 local-res-rules.ts（可单测）。
 *
 * 特权注册统一在 renderer-protocol.ts（与 app:// 一次性注册，必须 app ready 前）。
 */

interface ConfigLike {
  get(key: string): unknown
}

const SCHEME = 'localres'

/** localres:///D:/xxx.png → 主进程按白名单读文件回图（仅图片扩展名，防目录遍历/任意读） */
export function installLocalResHandler(config: ConfigLike): void {
  protocol.handle(SCHEME, (request) => {
    try {
      const pathname = new URL(request.url).pathname // '/D:/workspace/.../x.png'（percent-encoded）
      const p = path.resolve(decodeURIComponent(pathname.replace(/^\//, '')))
      if (!RES_MIME_BY_EXT[path.extname(p).toLowerCase()]) {
        return new Response('仅支持图片资源预览', { status: 403 })
      }
      if (!isAllowedResPath(p, collectResRoots(config))) {
        return new Response('路径不在允许的上传目录内', { status: 403 })
      }
      if (!existsSync(p)) return new Response('文件不存在', { status: 404 })
      const mime = RES_MIME_BY_EXT[path.extname(p).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(readFileSync(p)), { headers: { 'content-type': mime } })
    } catch (err) {
      return new Response((err as Error).message || 'bad request', { status: 400 })
    }
  })
}
