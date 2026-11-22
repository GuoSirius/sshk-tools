import { IPC_CHANNELS as C, isExpiresAlive, SHARE_PERMANENT_EXPIRES_AT, format } from '@sshk/shared'
import type { ShareRouteInfo } from '@sshk/shared'

/** share-manager 各页面共享的小工具函数（无状态）。 */

/** 剩余有效期文案（永久 tag 由模板判断） */
export function ttlLeft(expiresAt: number): string {
  if (expiresAt === SHARE_PERMANENT_EXPIRES_AT) return '永久'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return '已过期'
  const h = Math.floor(ms / 3600_000)
  const m = Math.max(1, Math.floor((ms % 3600_000) / 60000))
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** 路由状态：有效 / 已过期 / 永久（J-04：存活比较收编 isExpiresAlive 单一谓词） */
export function routeState(r: ShareRouteInfo): '有效' | '已过期' | '永久' {
  if (r.expiresAt === SHARE_PERMANENT_EXPIRES_AT) return '永久'
  return isExpiresAlive(r.expiresAt) ? '有效' : '已过期'
}

export function routeStateTag(t: string): 'success' | 'danger' | 'warning' {
  return t === '有效' ? 'success' : t === '已过期' ? 'danger' : 'warning'
}

/** 北京时间展示（yyyy-MM-dd HH:mm:ss）：实现收敛到 @sshk/shared time（2026-11-20 统一时间封装） */
export function fmtDateTime(at: number): string {
  return format(at)
}

export { C, SHARE_PERMANENT_EXPIRES_AT }
