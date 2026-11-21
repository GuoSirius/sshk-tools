import { randomUUID } from 'node:crypto'
import type { ShareAccessLog } from '@sshk/shared'

/**
 * 访问日志域（P6-6 自 index.ts 拆出）：环形缓冲 + 500ms 防抖 flush 到注入的持久化层。
 * 容量裁剪：按保留天数截掉过旧的，再按 maxCount 只留最近 N 条（防队列无限膨胀）。
 */
/** 日志容量默认与滚动清理（可经宿主注入覆盖，plans/12） */
export const DEFAULT_LOG_MAX_COUNT = 5000
export const DEFAULT_LOG_RETENTION_DAYS = 30

export class LogBuffer {
  /** 日志待写入队列（不再是读取源；500ms 防抖 flush 到注入的持久化层） */
  private queue: ShareAccessLog[] = []
  /** 日志持久化回调（宿主注入写 NeDB shareLogs）；未注入时日志仅存队列内存，不落库 */
  private sink: ((rows: ShareAccessLog[]) => void | Promise<void>) | null = null
  /** 日志容量配置（宿主注入，默认 5000 条 / 30 天） */
  private maxCount = DEFAULT_LOG_MAX_COUNT
  private retentionDays = DEFAULT_LOG_RETENTION_DAYS
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  /** 注入日志持久化回调（plans/12）：宿主把日志批量写入 NeDB shareLogs。
   *  500ms 防抖合并；未注入时日志只在内存队列、不落库（测试/无数据层场景）。 */
  setSink(fn: (rows: ShareAccessLog[]) => void | Promise<void>): void {
    this.sink = fn
  }

  /** 设置日志容量（条数/保留天数），宿主读 app.shareHub.logMaxCount/logRetentionDays 注入 */
  setCapacity(maxCount: number, retentionDays: number): void {
    this.maxCount = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : DEFAULT_LOG_MAX_COUNT
    this.retentionDays = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : DEFAULT_LOG_RETENTION_DAYS
  }

  /** 入队一条访问日志（写入时即生成 UUID，不依赖 NeDB _id 回执），作为删除/批量勾选的稳定键 */
  push(ip: string, routeId: string, path: string, status: number): void {
    this.queue.push({ id: randomUUID(), at: Date.now(), ip, path, status, routeId })
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, 500)
    this.flushTimer.unref?.()
  }

  /** 立即冲刷日志队列（退出/清空时调用）；循环防重入：sink 内若再产生日志留待下次 */
  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    if (!this.queue.length) return
    // 容量裁剪：按保留天数截掉过旧的，再按 maxCount 只留最近 N 条（防队列无限膨胀）
    const minAt = Date.now() - this.retentionDays * 86_400_000
    let batch = this.queue.filter((l) => l.at >= minAt)
    if (batch.length > this.maxCount) batch = batch.slice(batch.length - this.maxCount)
    this.queue = []
    if (!this.sink) return
    try { await this.sink(batch) } catch { /* 日志写入失败不影响分享服务 */ }
  }

  /** 按内容 id 移除尚未落库的日志（删除已查出的记录时，防止队列里旧的再写回） */
  removeQueued(ids: string[]): void {
    const kill = new Set(ids)
    this.queue = this.queue.filter((l) => !kill.has(l.id))
  }

  /** 清空队列与防抖定时器（clear 内核时调用） */
  clearQueue(): void {
    this.queue = []
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
  }
}
