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
 * Range 请求按「渐进下载」语义处理——206 承诺完整区间，body 用 ReadableStream 随磁盘
 * 落盘推进供数（与真实 HTTP 渐进下载服务器同构，播放器像面对慢网络一样等待）；分母用
 * 预期 total 保证进度条/拖拽正确。停滞超时/下载失败 → 流报错 → 播放器 onerror 回退。
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

/** 单次读取 [pos, pos+maxLen) 内已落盘字节；文件未创建/尚未写到 pos/实际读到 0 字节返回 null */
function readChunk(p: string, pos: number, maxLen: number): Uint8Array | null {
  let size = 0
  try { size = statSync(p).size } catch { return null }
  if (size <= pos) return null
  const len = Math.min(maxLen, size - pos)
  const buf = Buffer.allocUnsafe(len)
  let filled = 0
  const fd = openSync(p, 'r')
  try { filled = readSync(fd, buf, 0, len, pos) } finally { closeSync(fd) }
  return filled > 0 ? new Uint8Array(buf.subarray(0, filled)) : null
}

/**
 * 渐进下载流（2026-11-19 云播放 code=4 最终修复）：完整承诺请求的 Range 区间，
 * 响应体按磁盘落盘速度供数——与真实 HTTP 渐进下载服务器同构。
 *
 * 此前「只回当前已写部分 + 短区间 206」的形态是错的：本地文件复制瞬时完成、首次请求
 * 到达时文件已全部落盘（等于永远回完整文件）所以侥幸能播；云下载持续数分钟，短区间
 * 206 在 Chromium 媒体栈 + custom protocol 组合下不被接受 → code=4。
 *
 * stall 超时：uploaded 与磁盘 size 均不动超过 stallTimeoutMs → 流报错断开
 * （→ 播放器 onerror 回退）；任一在涨即续期（下载慢但健康不算停滞）。
 */
function createMediaStream(p: string, start: number, end: number, stallTimeoutMs = 30_000): ReadableStream<Uint8Array> {
  let pos = start
  let lastSig = -1
  let lastProgressAt = Date.now()
  let cancelled = false
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (pos <= end) {
          if (cancelled) return // 播放器 abort/重发请求：立刻停止供数
          const chunk = readChunk(p, pos, 512 * 1024)
          if (chunk) {
            pos += chunk.byteLength
            lastProgressAt = Date.now()
            controller.enqueue(chunk)
            return // 让出控制权等下一次 pull（背压）
          }
          const st = getMediaDownload(p)
          if (!st || st.done || st.error) {
            if (st?.error) throw new Error(`媒体下载失败：${st.error}`)
            controller.close() // 已终态：磁盘有的都给完（正常完成时 pos 应已达 end）
            return
          }
          let size = 0
          try { size = statSync(p).size } catch { /* 文件未创建 */ }
          const sig = Math.max(st.uploaded, size)
          if (sig !== lastSig) {
            lastSig = sig
            lastProgressAt = Date.now()
          } else if (Date.now() - lastProgressAt >= stallTimeoutMs) {
            throw new Error('媒体下载停滞超时')
          }
          await sleep(50)
        }
        controller.close()
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)))
      }
    },
    cancel() { cancelled = true },
  })
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
      // 会话在途但文件未创建：交给渐进下载流等待首包（直接 404 会立刻打断 <video>）；
      // 无会话且无文件才真 404
      const streaming = isMediaStreaming(p)
      if (!existsSync(p) && !streaming) return new Response('文件不存在', { status: 404 })

      // 分母：流式用会话预期 total（拖进度条正确），完整文件用实际 size
      const total = streaming ? (getMediaDownload(p)?.total ?? 0) : statSync(p).size

      const rangeHeader = request.headers.get('range')
      const range = parseByteRange(rangeHeader, total)
      if (range) {
        const { start, end } = range
        if (streaming) {
          if (total <= 0) return new Response('媒体总大小未知', { status: 503 })
          // 渐进下载语义：206 承诺完整区间，body 按落盘速度供数（含等待 moov 在尾部的场景，
          // 播放器像面对慢网络一样耐心等待）；停滞超时/下载失败流报错 → onerror 回退
          return new Response(createMediaStream(p, start, end), {
            status: 206,
            headers: {
              'content-type': mime,
              'content-range': `bytes ${start}-${end}/${total}`,
              'content-length': String(end - start + 1),
              'accept-ranges': 'bytes',
              'cache-control': 'no-store',
            },
          })
        }
        const { buf, filled } = readRange(p, start, end)
        return new Response(new Uint8Array(buf.subarray(0, filled)), {
          status: 206,
          headers: {
            'content-type': mime,
            'content-range': `bytes ${start}-${start + filled - 1}/${total}`,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
          },
        })
      }
      // 无 Range：流式回 200 全量流；完整文件直接读
      if (streaming) {
        if (total <= 0) return new Response('媒体总大小未知', { status: 503 })
        return new Response(createMediaStream(p, 0, total - 1), {
          status: 200,
          headers: {
            'content-type': mime,
            'content-length': String(total),
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
          },
        })
      }
      return new Response(new Uint8Array(readFileSync(p)), {
        headers: { 'content-type': mime, 'accept-ranges': 'bytes' },
      })
    } catch (err) {
      return new Response((err as Error).message || 'bad request', { status: 400 })
    }
  })
}
