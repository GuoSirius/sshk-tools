import path from 'node:path'
import { closeSync, existsSync, openSync, readSync, readFileSync, statSync } from 'node:fs'
import { protocol } from 'electron'
import { collectResRoots, isAllowedResPath, parseByteRange, RES_MIME_BY_EXT } from './local-res-rules'
import { getMediaDownload, isMediaStreaming } from './media-stream'

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

/**
 * 等待磁盘文件写入到至少 needBytes 字节（2026-11-19 云播放 code=4 根因修复）。
 *
 * 就绪判定必须以【磁盘 size】为准，不能用会话 uploaded（网络侧 onProgress）：
 * OSS/云 SDK 的进度回调先于数据落盘，按 uploaded 放行后 statSync clamp 会得到
 * realEnd < start → 503，而 custom protocol 的 503 媒体栈不重试 → 直接 code=4。
 * 本地文件非流式不走此分支，所以此前只有云播放挂、本地一直正常。
 *
 * 进展续期信号 = max(uploaded, 磁盘 size)——任一在涨都不算停滞；
 * 停滞超时 / 会话终态即返回当前磁盘 size（文件不存在为 0），由调用方裁决。
 */
async function waitForMediaFileBytes(p: string, needBytes: number, stallTimeoutMs = 30_000): Promise<number> {
  let lastSig = -1
  let lastProgressAt = Date.now()
  while (true) {
    let size = 0
    try { size = statSync(p).size } catch { /* 文件尚未创建：按 0 继续等 */ }
    if (size >= needBytes) return size
    const st = getMediaDownload(p)
    if (!st || st.done || st.error) return size // 终态：按磁盘现状交调用方裁决
    const sig = Math.max(st.uploaded, size)
    if (sig !== lastSig) {
      lastSig = sig
      lastProgressAt = Date.now()
    }
    if (Date.now() - lastProgressAt >= stallTimeoutMs) return size
    await new Promise<void>((r) => setTimeout(r, 40))
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
        if ((await waitForMediaFileBytes(p, 1)) === 0) {
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
        let realEnd = end
        if (streaming) {
          // 等磁盘写到请求起点（就绪以磁盘 size 为准，见 waitForMediaFileBytes 注释）：
          // tail Range（moov 在尾部）会一直等到区间落盘或下载终态；只有停滞/终态不足才 503
          const cur = await waitForMediaFileBytes(p, start + 1)
          if (cur <= start) return new Response('媒体数据未就绪', { status: 503 })
          // 只返回已写入的部分（clamp 到当前 size-1）；浏览器收到短区间会自动续请求
          realEnd = Math.min(end, cur - 1)
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
