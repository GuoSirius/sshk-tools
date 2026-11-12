import { monotonicFactory } from 'ulid'

/** 使用成熟 ulid 库（Crockford Base32，时间可排序）；monotonicFactory 保证同毫秒内单调递增 */
const monotonicUlid = monotonicFactory()

export function ulid(nowMs: number = Date.now()): string {
  return monotonicUlid(nowMs)
}

/** 生成带业务前缀的实体 ID，如 `brd_01hq…`（数据契约 §1） */
export function entityId(prefix: string, nowMs: number = Date.now()): string {
  return `${prefix}_${ulid(nowMs).toLowerCase()}`
}
