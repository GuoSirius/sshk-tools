import { isExpiresAlive, type ShareRouteTicket } from '@sshk/shared'

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

/** ticket 是否仍在有效期（永久哨兵视为永久有效；谓词本体在 @sshk/shared isExpiresAlive，内核/渲染层同源） */
export function isTicketAlive(t: ShareRouteTicket | null | undefined): boolean {
  return Boolean(t && isExpiresAlive(t.expiresAt))
}

/** 由分享链接基址 + 文件相对 root 路径拼「文件直达 URL」。
 *  ShareHub 的 token 绑定 root，URL 子路径即相对 root 的路径；allowIndex=false 只封目录列表，
 *  文件直达仍可用（内核 handle：非目录分支不受 indexAllowed 限制）。 */
export function shareFileDirectUrl(baseUrl: string, relPath: string): string {
  const rel = String(relPath ?? '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!baseUrl) return ''
  // 用 URL API 在 pathname 上追相对路径，保留 base 自带的 ?ak= 查询串（密钥）——
  // 裸字符串拼接会把路径塞进 query（...?ak=xxx/child），导致密钥与路径都失效。
  try {
    const u = new URL(baseUrl)
    u.pathname = u.pathname.replace(/\/+$/, '') + (rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : '')
    return u.toString()
  } catch {
    // 非法 URL（理论上不会出现）：退回原拼接，至少不抛错
    const base = String(baseUrl).replace(/\/+$/, '')
    return rel ? `${base}/${rel.split('/').map(encodeURIComponent).join('/')}` : base
  }
}

/** 由访问域名 + 通道相对路径拼媒体直链，并套可选的签名 URL 模板。
 *  - base：访问域名（baseUrl），去尾斜杠；空则返回空串。
 *  - relPath：通道相对路径（带前导 / 亦可），逐段编码。
 *  - signTemplate：用 {url} 占位符代表裸直链；无占位符/为空则忽略模板回裸链。
 *  用于远端/云通道的视频/音频预览：直链免下载、服务端 Range；失败再由调用方回退下载。 */
export function buildDirectUrl(baseUrl: string, relPath: string, signTemplate?: string): string {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return ''
  const rel = String(relPath ?? '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const raw = `${base}/${rel.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  const tpl = String(signTemplate ?? '').trim()
  if (!tpl || !tpl.includes('{url}')) return raw
  return tpl.split('{url}').join(raw)
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
