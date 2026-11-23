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
  /** 终态落定时间（CR-41：TTL 回收依据） */
  finishedAt?: number
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

// CR-41（P1-4）：终态会话 60s 后自动移除——此前 finish 只置 done 从不回收，
// Map 与 listeners 无界增长（长听歌/长视频会话累积泄漏）。30s 扫一次。
const MEDIA_TTL_MS = 60_000
setInterval(() => {
  const cutoff = Date.now() - MEDIA_TTL_MS
  let removed = false
  for (const [key, st] of downloads) {
    if (st.done && (st.finishedAt ?? 0) < cutoff) { downloads.delete(key); removed = true }
  }
  if (removed) emit()
}, 30_000).unref?.()

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
  st.finishedAt = Date.now()
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
