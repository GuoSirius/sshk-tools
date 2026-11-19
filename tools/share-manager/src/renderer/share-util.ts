import { IPC_CHANNELS as C, SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'
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

/** 路由状态：有效 / 已过期 / 永久 */
export function routeState(r: ShareRouteInfo): '有效' | '已过期' | '永久' {
  if (r.expiresAt === SHARE_PERMANENT_EXPIRES_AT) return '永久'
  return r.expiresAt > Date.now() ? '有效' : '已过期'
}

export function routeStateTag(t: string): 'success' | 'danger' | 'warning' {
  return t === '有效' ? 'success' : t === '已过期' ? 'danger' : 'warning'
}

/** 北京时间展示（yyyy-MM-dd HH:mm:ss） */
export function fmtDateTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export { C, SHARE_PERMANENT_EXPIRES_AT }
