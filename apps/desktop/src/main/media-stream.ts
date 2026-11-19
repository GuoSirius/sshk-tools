/**
 * 媒体边下边播会话表（纯逻辑，无 electron 依赖，供单测）。
 *
 * 背景：fs.readMedia 原是「全量下载完才返回 localres URL」，大文件 + 慢网络时用户
 * 一直盯着「加载中」。改为注册会话后**立即返回 URL**，后台边下边写临时文件；
 * localres handler 读「下载中」文件时查本表：请求字节未就绪则短轮询等待，
 * 并用预期总大小 total 作为 content-range 分母（拖进度条才正确）。
 *
 * 本模块是主进程单例：fs.ts（写状态）与 local-res.ts（读状态）import 同一实例。
 */

export interface MediaDownloadState {
  /** 临时文件绝对路径（与 readMedia 返回的 localres URL 对应） */
  key: string
  /** 预期总字节（stat.size） */
  total: number
  /** 已写入字节（driver.download onProgress 累加） */
  uploaded: number
  /** 下载是否完成 */
  done: boolean
  /** 下载失败信息 */
  error?: string
}

type Listener = (states: MediaDownloadState[]) => void

const downloads = new Map<string, MediaDownloadState>()
const listeners = new Set<Listener>()

function emit(): void {
  if (!listeners.size) return
  const snap = [...downloads.values()]
  for (const cb of listeners) {
    try { cb(snap) } catch { /* 单个监听异常不影响其它 */ }
  }
}

/** 开始下载：注册会话（同 key 重复调用 = 覆盖重置） */
export function beginMediaDownload(key: string, total: number): void {
  downloads.set(key, { key, total: Math.max(0, total), uploaded: 0, done: false })
  emit()
}

/** 更新已写入字节（单调不减，钳到 total） */
export function updateMediaDownload(key: string, uploaded: number): void {
  const st = downloads.get(key)
  if (!st || st.done) return
  const v = Math.min(st.total, Math.max(st.uploaded, Number(uploaded) || 0))
  if (v === st.uploaded) return
  st.uploaded = v
  emit()
}

/** 下载完成 / 失败：置终态。保留会话一小段时间供尾部 Range 请求读到 done 信号。 */
export function finishMediaDownload(key: string, error?: string): void {
  const st = downloads.get(key)
  if (!st) return
  st.done = true
  if (error) st.error = error
  else st.uploaded = st.total
  emit()
}

/** 获取会话快照（调用方勿改返回值） */
export function getMediaDownload(key: string): MediaDownloadState | undefined {
  return downloads.get(key)
}

/** 移除会话（下载完成且播放器关闭后由渲染层通知，或定时清理） */
export function removeMediaDownload(key: string): void {
  if (downloads.delete(key)) emit()
}

/** 会话是否处于「下载中」（未完成、无错误） */
export function isMediaStreaming(key: string): boolean {
  const st = downloads.get(key)
  return Boolean(st && !st.done && !st.error)
}

/**
 * 等待至少 need 字节就绪（或下载进入终态）。
 * 供 localres handler 在 Range 落到未写入区域时调用，避免浏览器拿到空响应卡住。
 *
 * 超时语义（2026-11-19 改进）：timeoutMs 是「无进展停滞超时」——只要下载还在推进
 * （uploaded 增长）就继续等，tail Range（mp4 moov 在尾部时浏览器必请求文件尾）
 * 会一直等到该区间落盘或下载终态，而不是固定 30s 就 503 打断播放。
 * 返回最新会话状态；会话不存在返回 undefined。
 */
export async function waitForMediaBytes(
  key: string,
  need: number,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MediaDownloadState | undefined> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const intervalMs = opts.intervalMs ?? 40
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastUploaded = -1
  let lastProgressAt = Date.now()
  while (true) {
    const st = downloads.get(key)
    if (!st) return undefined
    if (st.error || st.done || st.uploaded >= need) return st
    if (st.uploaded !== lastUploaded) {
      lastUploaded = st.uploaded
      lastProgressAt = Date.now()
    }
    if (Date.now() - lastProgressAt >= timeoutMs) return st // 下载停滞（无进展）才超时
    await sleep(intervalMs)
  }
}

/** 订阅全部会话变更（主进程推送 fs:media:event 用）；返回退订函数 */
export function subscribeMediaDownloads(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 清空（单测用） */
export function resetMediaDownloads(): void {
  downloads.clear()
  listeners.clear()
}
