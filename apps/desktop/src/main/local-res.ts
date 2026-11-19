import path from 'node:path'
import { closeSync, existsSync, openSync, readSync, readFileSync, statSync } from 'node:fs'
import { protocol } from 'electron'
import { collectResRoots, isAllowedResPath, parseByteRange, RES_MIME_BY_EXT } from './local-res-rules'
import { getMediaDownload, isMediaStreaming, waitForMediaBytes } from './media-stream'

/**
 * localres:// 预览协议（用户反馈 2026-11-16：本地上传 profile 回填 file:// URL，
 * Chromium 禁止 http 页面加载本地资源 → 「Not allowed to load local resource」预览全挂）。
 *
 * 存储契约不动；仅渲染层【预览显示】走 localres:///，主进程白名单放行：
 * 允许根 = 全局本地上传目录 + 各工具 localDir 覆盖 + 媒体临时目录；图片/音视频扩展名。
 * 白名单判定纯逻辑在 local-res-rules.ts（可单测）。
 *
 * 边下边播（2026-11-19）：媒体临时文件若仍在下载（media-stream 表标记为 streaming），
 * Range 请求的区间未写入时不立即返回空，而是短轮询等字节到达；content-range 分母用
 * 预期 total（非当前 size），保证浏览器进度条/拖拽正确。下载失败/超时回错误响应 →
 * 渲染层 <video onerror> 自动回退到「下载到本地」路径。
 */

interface ConfigLike {
  get(key: string): unknown
}

const SCHEME = 'localres'

/** 读取文件指定区间（闭区间）到 Buffer；实际读入字节可能少于 len（文件尚在写），返回实读长度 */
function readRange(p: string, start: number, end: number): { buf: Buffer; filled: number } {
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
  return { buf, filled }
}

/** 等待流式落盘的文件出现（云 SDK 首包前 destFile 可能尚未创建，2026-11-19 用户实测 404）：
 *  文件出现 / 会话终态 / 停滞超时即返回当前存在性；有进展就续期（同 waitForMediaBytes 语义） */
async function waitForMediaFileStart(p: string, stallTimeoutMs = 15_000): Promise<boolean> {
  let lastUploaded = -1
  let lastProgressAt = Date.now()
  while (true) {
    if (existsSync(p)) return true
    const st = getMediaDownload(p)
    if (!st || st.done || st.error) return existsSync(p)
    if (st.uploaded !== lastUploaded) {
      lastUploaded = st.uploaded
      lastProgressAt = Date.now()
    }
    if (Date.now() - lastProgressAt >= stallTimeoutMs) return existsSync(p)
    await new Promise<void>((r) => setTimeout(r, 50))
  }
}

/** localres:///D:/xxx.png → 主进程按白名单读文件回响应（图片 + 音视频，含 Range/边下边播） */
export function installLocalResHandler(config: ConfigLike): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const pathname = new URL(request.url).pathname // '/D:/workspace/.../x.png'（percent-encoded）
      const p = path.resolve(decodeURIComponent(pathname.replace(/^\//, '')))
      const mime = RES_MIME_BY_EXT[path.extname(p).toLowerCase()]
      if (!mime) return new Response('仅支持图片/音视频资源预览', { status: 403 })
      if (!isAllowedResPath(p, collectResRoots(config))) {
        return new Response('路径不在允许的上传目录内', { status: 403 })
      }
      // 边下边播会话已注册但文件还没落盘：等首包写盘（云 SDK download 首包前 destFile 不存在），
      // 直接 404 会让 <video> 立刻 error；等待无果（下载失败/停滞）才回 404
      if (!existsSync(p) && isMediaStreaming(p)) {
        if (!(await waitForMediaFileStart(p))) {
          return new Response('媒体数据未就绪（下载未开始或已失败）', { status: 404 })
        }
      }
      if (!existsSync(p)) return new Response('文件不存在', { status: 404 })

      // 边下边播：文件仍在下载 → 以预期 total 为分母，等所需字节就绪
      const streaming = isMediaStreaming(p)
      const effectiveTotal = streaming
        ? (getMediaDownload(p)?.total ?? statSync(p).size)
        : statSync(p).size

      const rangeHeader = request.headers.get('range')
      const range = parseByteRange(rangeHeader, effectiveTotal)
      if (range) {
        const { start, end } = range
        // 下载中：等 start+1 字节就绪（读到请求起点才有意义）；超时=下载停滞判定，
        // 下载推进期间 tail Range（moov 在尾部）会持续等待直到区间落盘或终态
        if (streaming) {
          const st = await waitForMediaBytes(p, start + 1, { timeoutMs: 30_000 })
          if (!st || st.error || (st.uploaded <= start && st.done)) {
            // 下载失败 / 文件结束仍不足 → 让播放器 onerror 回退下载
            return new Response('媒体数据未就绪', { status: 503 })
          }
        }
        let realEnd = end
        if (streaming) {
          // 只返回已写入的部分（clamp 到当前 size-1）；浏览器收到短区间会自动续请求
          const cur = statSync(p).size
          realEnd = Math.min(end, cur - 1)
          if (realEnd < start) return new Response('媒体数据未就绪', { status: 503 })
        }
        const { buf, filled } = readRange(p, start, realEnd)
        return new Response(new Uint8Array(buf.subarray(0, filled)), {
          status: 206,
          headers: {
            'content-type': mime,
            'content-range': `bytes ${start}-${start + filled - 1}/${effectiveTotal}`,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
          },
        })
      }
      // 无 Range：下载中则回 503 让播放器改用 Range（浏览器请求媒体通常都会带 Range）
      if (streaming) return new Response('请使用 Range 请求', { status: 503 })
      return new Response(new Uint8Array(readFileSync(p)), {
        headers: { 'content-type': mime, 'accept-ranges': 'bytes' },
      })
    } catch (err) {
      return new Response((err as Error).message || 'bad request', { status: 400 })
    }
  })
}
