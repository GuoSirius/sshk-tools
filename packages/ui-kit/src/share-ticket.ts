import { SHARE_PERMANENT_EXPIRES_AT, type ShareRouteTicket } from '@sshk/shared'

/**
 * ShareDialog 分享凭证的存取（单一来源）：
 * - storageKey：同一分享目标（toolId+label+root+entry 四元组）跨重启复用链接，
 *   键只对四元组取短哈希，不把路径/中文直接塞进 localStorage 键名。
 * - ShareDialog 打开时读写；工具页（如海报列表「复制链接」）用 readShareTicket
 *   按同一把键读取既有链接，实现「行有自己的分享用自己，否则用列表前缀拼」。
 */
export function shareDialogStorageKey(toolId: string, label: string, root: string, entry?: string): string {
  const raw = [toolId, label, root, entry ?? ''].join('|')
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `sshk:share-dialog:${(h >>> 0).toString(36)}`
}

/** 读取该分享目标既有的 ticket；字段不完整视为无效。过期与否由调用方结合 list 校验。 */
export function readShareTicket(toolId: string, label: string, root: string, entry?: string): ShareRouteTicket | null {
  try {
    const raw = localStorage.getItem(shareDialogStorageKey(toolId, label, root, entry))
    if (!raw) return null
    const t = JSON.parse(raw) as ShareRouteTicket
    if (!t?.id || !Array.isArray(t.urls) || !t.urls.length || typeof t.expiresAt !== 'number') return null
    return t
  } catch { return null }
}

/** ticket 是否仍在有效期（永久哨兵视为永久有效） */
export function isTicketAlive(t: ShareRouteTicket | null | undefined): boolean {
  return Boolean(t && (t.expiresAt === SHARE_PERMANENT_EXPIRES_AT || t.expiresAt > Date.now()))
}

/** 按路由 id 反查凭证（遍历分享键匹配 ticket.id）。
 *  键是四元组哈希、且内核 route.entry 会 strip 前导 /，用 entry 反推键会对不上——
 *  列表「复制分享链接」按 id 匹配最稳，与 label/root/entry 格式无关。 */
export function findShareTicketById(id: string): ShareRouteTicket | null {
  if (!id) return null
  try {
    const prefix = 'sshk:share-dialog:'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const t = JSON.parse(raw) as ShareRouteTicket
        if (t?.id === id && Array.isArray(t.urls) && t.urls.length) return t
      } catch { /* 单个键损坏：跳过 */ }
    }
  } catch { /* localStorage 不可用 */ }
  return null
}
