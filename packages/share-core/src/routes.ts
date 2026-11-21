import { SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'

/**
 * 路由域（P6-6 自 index.ts 拆出）：ShareRoute 数据契约、TTL 口径、挂载别名规范化、密码继承。
 * 纯函数无 IO；内核类 ShareHub 见 server.ts。
 */
export interface ShareRoute {
  id: string
  token: string
  toolId: string
  label: string
  root: string
  entry: string
  ttlHours: number
  createdAt: number
  /** 最近变更时刻：create=createdAt，renew/patch 刷新，访问命中不刷新（plans/12） */
  updatedAt: number
  expiresAt: number
  password: string
  /** 是否允许浏览目录列表（用户 2026-11-18：默认不允许；旧路由无此字段视为允许，不破坏既有链接） */
  allowIndex?: boolean
  /** 命中计数（访问入口 + 资源） */
  hits: number
  /** 挂载目录路由标记（ShareHub mounts）：非持久化、配置权威；token 字段存别名 */
  mountId?: string
  /** 路由种类（plans/11 方案 B）：缺省 file；content=文章内容，由注入的 resolver 动态渲染 */
  kind?: 'file' | 'content'
  /** content kind 的内容 id（cnt_*） */
  contentId?: string
}

export const DEFAULT_TTL_HOURS = 72

/** ttlHours 归一化为非负整数（0=永久），非法（负数/小数/NaN）回落默认值。 */
export function normalizeTtl(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TTL_HOURS
}

/** 永久哨兵 → 到期时刻；有限时长 → now + hours。 */
export function expiresAtFor(ttlHours: number, now = Date.now()): number {
  return ttlHours === 0 ? SHARE_PERMANENT_EXPIRES_AT : now + ttlHours * 3600_000
}

/** 挂载别名规范化（URL 路径段）：小写、去首尾空白、空白转连字符；白名单 [a-z0-9-_] 长度 1-32。
 *  非法返回 ''（调用方跳过/报错）。渲染层生成与校验需保持同规则。 */
export function normalizeMountAlias(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  if (!s) return ''
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}

/** 计算剩余有效期描述（分钟）——保留导出以兼容外部可能的引用。 */
export function ttlMinutesLeft(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
}

/** 密码继承（用户 2026-11-19）：同 root 下、entry 为当前祖先目录或整根（entry=''）且带口令的路由，
 *  取 entry 最长（最近父级）者的口令。整根 entry='' 不再向上继承；挂载路由不参与（配置权威、另算）。 */
export function inheritedPassword(routes: Map<string, ShareRoute>, root: string, entry: string): string {
  if (!entry) return ''
  const cur = entry.replace(/\/+$/, '')
  let best: ShareRoute | undefined
  for (const r of routes.values()) {
    if (!r.password || r.root !== root) continue
    const dir = r.entry.replace(/\/+$/, '')
    if (dir && !cur.startsWith(dir + '/')) continue
    if (!best || dir.length > best.entry.replace(/\/+$/, '').length) best = r
  }
  return best?.password ?? ''
}
