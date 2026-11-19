import path from 'node:path'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { protocol } from 'electron'
import { collectResRoots, isAllowedResPath, parseByteRange, RES_MIME_BY_EXT } from './local-res-rules'

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
      // 音视频 Range（用户 2026-11-19：视频拖进度条必须 206 分段；无 Range 回 200 全量）
      // 只读请求区间，不把整文件读进内存（百 MB 视频关键信息）
      const size = statSync(p).size
      const range = parseByteRange(request.headers.get('range'), size)
      if (range) {
        const { start, end } = range
        const len = end - start + 1
        const buf = Buffer.allocUnsafe(len)
        let filled = 0
        const fd = openSync(p, 'r')
        try {
          while (filled < len) {
            const n = readSync(fd, buf, filled, len - filled, start + filled)
            if (n <= 0) break
            filled += n
          }
        } finally {
          closeSync(fd)
        }
        return new Response(new Uint8Array(buf.subarray(0, filled)), {
          status: 206,
          headers: {
            'content-type': mime,
            'content-range': `bytes ${start}-${end}/${size}`,
            'accept-ranges': 'bytes',
          },
        })
      }
      return new Response(new Uint8Array(readFileSync(p)), { headers: { 'content-type': mime, 'accept-ranges': 'bytes' } })
    } catch (err) {
      return new Response((err as Error).message || 'bad request', { status: 400 })
    }
  })
}
