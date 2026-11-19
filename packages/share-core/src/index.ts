import { createServer, type Server } from 'node:http'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { networkInterfaces } from 'node:os'
import { existsSync, readFileSync, statSync, createReadStream, mkdirSync, readdirSync } from 'node:fs'
import { writeFile, unlink, stat } from 'node:fs/promises'
import { extname, join, dirname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolveSafe } from '@sshk/repository'
import type {
  ShareRouteInput,
  ShareRouteTicket,
  ShareRouteInfo,
  ShareHubMount,
  ShareHubProxy,
  ShareIpInfo,
  ShareAccessLog,
  HubStatus,
  ShareContentResolverResult,
} from '@sshk/shared'
import { SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'

/** ttlHours 归一化为非负整数（0=永久），非法（负数/小数/NaN）回落默认值。 */
function normalizeTtl(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TTL_HOURS
}
/** 永久哨兵 → 到期时刻；有限时长 → now + hours。 */
function expiresAtFor(ttlHours: number, now = Date.now()): number {
  return ttlHours === 0 ? SHARE_PERMANENT_EXPIRES_AT : now + ttlHours * 3600_000
}

/** 局域网只读分享内核（plans/09 从零重写）：单端口、多路由、TTL 双保险、可撤销可续期。
 *  - 一个 HTTP server（0.0.0.0），路由表 Map<token, ShareRoute>，每条路由独立 root/TTL/口令/计数
 *  - 静态内核：MIME + 目录列表页 + Range（音视频拖进度）+ 防目录穿越
 *  - 状态持久化 hub-state.json（重启 resume 未过期路由）；访问日志环形缓冲（最近 500 条）
 *  - IP 策略：0.0.0.0 监听 + 全网卡枚举 + virtual 判定 + 自动优选 + 用户手输展示 IP
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
}

/** 判定网卡是否为虚拟网卡（虚拟机/容器/代理/蓝牙等）——只影响「自动优选」排序与展示标记，不阻止选择。 */
const VIRTUAL_NIC_RE = /vEthernet|VMware|VirtualBox|Loopback|Docker|WSL|TAP|TUN|Tailscale|蓝牙|Bluetooth|Hyper-V|Virtual|VMnet|ireth|Wi-Fi Direct/i

interface ShareRoute {
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

interface PersistedHub {
  version: 1
  routes: ShareRoute[]
}

const DEFAULT_TTL_HOURS = 72
/** 日志容量默认与滚动清理（可经宿主注入覆盖，plans/12） */
export const DEFAULT_LOG_MAX_COUNT = 5000
export const DEFAULT_LOG_RETENTION_DAYS = 30
const CLEAN_INTERVAL_MS = 60_000

/** 挂载别名规范化（URL 路径段）：小写、去首尾空白、空白转连字符；白名单 [a-z0-9-_] 长度 1-32。
 *  非法返回 ''（调用方跳过/报错）。渲染层生成与校验需保持同规则。 */
export function normalizeMountAlias(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  if (!s) return ''
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}

/** 代理规则运行态（ShareHubProxy 解析后）：target 解析为 URL 对象 */
interface ProxyRule {
  id: string
  prefix: string
  targetUrl: URL
  keepHost: boolean
}

/** 逐跳头（RFC 7230）：代理转发/回传两侧都要剥掉，交给 Node 自己管理连接 */
const HOP_BY_HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

/** 客户端 IP 规范化：IPv4-mapped IPv6（::ffff:192.168.1.5）还原为点分 IPv4 */
function normalizeClientIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

export class ShareHub {
  private server: Server | null = null
  private port = 0
  private routes = new Map<string, ShareRoute>()
  /** 挂载目录路由（key=别名）：配置权威、即时生效、不持久化到 hub-state（重启由宿主 setMounts 重建） */
  private mountRoutes = new Map<string, ShareRoute>()
  /** 代理规则（key=路径前缀）：配置权威、即时生效、不持久化（用户 2026-11-18 定版） */
  private proxyRules = new Map<string, ProxyRule>()
  /** 日志待写入队列（不再是读取源；500ms 防抖 flush 到注入的持久化层） */
  private logQueue: ShareAccessLog[] = []
  /** 日志持久化回调（宿主注入写 NeDB shareLogs）；未注入时日志仅存队列内存，不落库 */
  private logSink: ((rows: ShareAccessLog[]) => void | Promise<void>) | null = null
  /** 日志容量配置（宿主注入，默认 5000 条 / 30 天） */
  private logMaxCount = DEFAULT_LOG_MAX_COUNT
  private logRetentionDays = DEFAULT_LOG_RETENTION_DAYS
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null
  private cleanTimer: ReturnType<typeof setInterval> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  /** 用户配置的展示 IP；'' = 每次生成链接时按 §4.3 自动优选 */
  private preferredIp = ''
  /** 端口回落提示回调（固定端口被占时由宿主 ElMessage 告警） */
  private onPortFallback: ((requested: number, actual: number) => void) | null = null
  /** 内容 resolver（plans/11 方案 B）：宿主注入读库回调，core 不依赖 repository；null/Promise 均可（NeDB 异步）。
   *  返回 null=内容不存在/已归档→404。 */
  private contentResolver: ((contentId: string) => ShareContentResolverResult | null | Promise<ShareContentResolverResult | null>) | null = null
  /** 内容列表 resolver（plans/11 方案 C）：宿主构造「已发布文章列表页」完整 HTML，core 只输出，不碰数据。
   *  命中 entry=__list__ 的 content 路由时调用；返回 null=无 resolver→404。 */
  private contentListResolver: ((accessKey: string) => string | null | Promise<string | null>) | null = null
  /** 内容列表页入口标记（entry 值），区别于单篇 contentId */
  static readonly CONTENT_LIST_ENTRY = '__list__'

  constructor(private readonly stateFile: string) {}

  /** 注入宿主回调：固定端口被占回落时告警 */
  setPortFallbackHandler(fn: (requested: number, actual: number) => void): void {
    this.onPortFallback = fn
  }

  /** 注入日志持久化回调（plans/12）：宿主把日志批量写入 NeDB shareLogs。
   *  500ms 防抖合并；未注入时日志只在内存队列、不落库（测试/无数据层场景）。 */
  setLogSink(fn: (rows: ShareAccessLog[]) => void | Promise<void>): void {
    this.logSink = fn
  }

  /** 设置日志容量（条数/保留天数），宿主读 app.shareHub.logMaxCount/logRetentionDays 注入 */
  setLogCapacity(maxCount: number, retentionDays: number): void {
    this.logMaxCount = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : DEFAULT_LOG_MAX_COUNT
    this.logRetentionDays = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : DEFAULT_LOG_RETENTION_DAYS
  }

  /** 立即冲刷日志队列（退出/清空时调用）；循环防重入：sink 内若再产生日志留待下次 */
  async flushLogs(): Promise<void> {
    if (this.logFlushTimer) { clearTimeout(this.logFlushTimer); this.logFlushTimer = null }
    if (!this.logQueue.length) return
    // 容量裁剪：按保留天数截掉过旧的，再按 maxCount 只留最近 N 条（防队列无限膨胀）
    const minAt = Date.now() - this.logRetentionDays * 86_400_000
    let batch = this.logQueue.filter((l) => l.at >= minAt)
    if (batch.length > this.logMaxCount) batch = batch.slice(batch.length - this.logMaxCount)
    this.logQueue = []
    if (!this.logSink) return
    try { await this.logSink(batch) } catch { /* 日志写入失败不影响分享服务 */ }
  }

  /** 注入内容 resolver（plans/11）：宿主读库并把展示态 HTML 交给内核渲染阅读页。
   *  core 只持有函数引用，不 import repository——依赖方向 core→shared→(宿主)→repository，无反向依赖。 */
  registerContentResolver(fn: (contentId: string) => ShareContentResolverResult | null | Promise<ShareContentResolverResult | null>): void {
    this.contentResolver = fn
  }

  /** 注入内容列表 resolver（plans/11 方案 C）：宿主查库构造已发布文章列表页 HTML */
  registerContentListResolver(fn: (accessKey: string) => string | null | Promise<string | null>): void {
    this.contentListResolver = fn
  }

  /** 设置展示 IP（配置变更即时生效，已发链接不追溯改写） */
  setPreferredIp(ip: string): void {
    this.preferredIp = String(ip ?? '').trim()
  }

  get running(): boolean {
    return this.server !== null
  }

  getPort(): number {
    return this.port
  }

  /** 启动 HTTP 服务并 resume 状态文件；requestedPort 缺省读配置。返回实际监听端口。
   *  固定端口被占 → 回落随机并触发 onPortFallback 告警（never throw 端口占用）。 */
  async start(requestedPort = 0): Promise<{ port: number }> {
    if (this.running) return { port: this.port }
    await this.listen(requestedPort)
    this.resumeRoutes()
    this.cleanTimer = setInterval(() => this.sweepExpired(), CLEAN_INTERVAL_MS)
    this.cleanTimer.unref?.()
    return { port: this.port }
  }

  /** 停止服务，保留路由表与 token（再 start 即恢复）。状态落盘。 */
  async stop(): Promise<void> {
    if (this.cleanTimer) { clearInterval(this.cleanTimer); this.cleanTimer = null }
    const srv = this.server
    if (srv) {
      srv.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        srv.close(() => resolve())
        const t = setTimeout(resolve, 1500)
        srv.once('close', () => clearTimeout(t))
      })
      this.server = null
      this.port = 0
    }
    await this.flushPersist()
    await this.flushLogs()
  }

  /** 停止并清空全部路由 + 删除状态文件（所有链接永久失效）。 */
  async clear(): Promise<void> {
    await this.stop()
    this.routes.clear()
    this.logQueue = []
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    if (this.logFlushTimer) { clearTimeout(this.logFlushTimer); this.logFlushTimer = null }
    await unlink(this.stateFile).catch(() => { /* 本就不存在，忽略 */ })
  }

  /** 重启监听：保留全部路由与 token（token 属于路由不属于进程）。 */
  async restart(requestedPort = 0): Promise<{ port: number }> {
    const port = this.port || requestedPort
    await this.stop()
    return this.start(port)
  }

  /** 设置挂载目录（ShareHub mounts，用户 2026-11-18 定版）：配置权威、即时生效、无需重启。
   *  enabled=false 或无效项不注册（访客访问一律 404）。返回被跳过项的描述（供宿主日志）。 */
  setMounts(mounts: ShareHubMount[]): string[] {
    const skipped: string[] = []
    const next = new Map<string, ShareRoute>()
    for (const m of Array.isArray(mounts) ? mounts : []) {
      const dir = String(m?.dir ?? '').trim()
      const alias = normalizeMountAlias(m?.alias)
      const shown = alias || String(m?.alias ?? '').trim() || dir || '(空行)'
      // enabled=false 的挂载整目录不注册（注释契约 199 行 / 类型注释 / 文档 §10.2 一致；此前遗漏，与 setProxies 对齐）
      if (m?.enabled === false) { skipped.push(`「${shown}」：已禁用`); continue }
      if (!dir) { skipped.push(`「${shown}」：目录为空`); continue }
      if (!alias) { skipped.push(`「${shown}」：别名非法（限小写字母/数字/连字符/下划线）`); continue }
      if (next.has(alias)) { skipped.push(`「${alias}」：别名重复`); continue }
      try {
        if (!existsSync(dir) || !statSync(dir).isDirectory()) { skipped.push(`「${alias}」→ ${dir}：目录不存在`); continue }
      } catch { skipped.push(`「${alias}」→ ${dir}：目录不可读`); continue }
      // 别名不得与工具路由 token 冲突：请求解析 token 优先，冲突会让挂载永远不可达
      if (this.routes.has(alias)) { skipped.push(`「${alias}」：与既有分享链接 token 冲突`); continue }
      next.set(alias, {
        id: `mount:${m.id || alias}`, token: alias, toolId: 'share-hub-mount',
        label: alias, root: dir, entry: '', ttlHours: 0,
        createdAt: 0, updatedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, password: String(m.password ?? ''),
        // 逐目录目录浏览开关（用户 2026-11-18 拆分）：默认允许，关 = 仅具体文件路径可达
        allowIndex: m.allowIndex !== false, hits: 0, mountId: m.id || alias,
      })
    }
    this.mountRoutes = next
    return skipped
  }

  /** 设置代理规则（用户 2026-11-18 定版）：配置权威、即时生效、无需重启。
   *  全方法反向代理（GET/POST/…含请求体流式转发）；目标地址不限网络；keepHost 控制转发 Host。
   *  enabled=false / 前缀非法 / 目标非法 / 前缀冲突 → 不注册（访问 404），返回跳过明细供宿主日志。 */
  setProxies(proxies: ShareHubProxy[]): string[] {
    const skipped: string[] = []
    const next = new Map<string, ProxyRule>()
    for (const p of Array.isArray(proxies) ? proxies : []) {
      const prefix = normalizeMountAlias(p?.prefix)
      const rawTarget = String(p?.target ?? '').trim()
      const shown = prefix || String(p?.prefix ?? '').trim() || rawTarget || '(空行)'
      if (!prefix) { skipped.push(`「${shown}」：前缀非法（限小写字母/数字/连字符/下划线）`); continue }
      if (!rawTarget) { skipped.push(`「${prefix}」：目标地址为空`); continue }
      let u: URL
      try { u = new URL(rawTarget) } catch { skipped.push(`「${prefix}」→ ${rawTarget}：目标地址不是合法 URL`); continue }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { skipped.push(`「${prefix}」→ ${rawTarget}：仅支持 http/https`); continue }
      if (next.has(prefix)) { skipped.push(`「${prefix}」：前缀重复`); continue }
      // 前缀不得与分享 token / 挂载别名冲突：解析顺序 token → 挂载 → 代理，冲突的代理永远不可达
      if (this.routes.has(prefix) || this.mountRoutes.has(prefix)) {
        skipped.push(`「${prefix}」：与既有分享链接/挂载目录冲突`); continue
      }
      if (p.enabled === false) continue // 关 = 不注册（保存后重新打开即时恢复）
      next.set(prefix, { id: p.id || prefix, prefix, targetUrl: u, keepHost: p.keepHost !== false }) // 默认保留原始 Host（用户 2026-11-18 拍板）
    }
    this.proxyRules = next
    return skipped
  }

  /** 密码继承（用户 2026-11-19）：同 root 下、entry 为当前祖先目录或整根（entry=''）且带口令的路由，
   *  取 entry 最长（最近父级）者的口令。整根 entry='' 不再向上继承；挂载路由不参与（配置权威、另算）。 */
  private inheritedPassword(root: string, entry: string): string {
    if (!entry) return ''
    const cur = entry.replace(/\/+$/, '')
    let best: ShareRoute | undefined
    for (const r of this.routes.values()) {
      if (!r.password || r.root !== root) continue
      const dir = r.entry.replace(/\/+$/, '')
      if (dir && !cur.startsWith(dir + '/')) continue
      if (!best || dir.length > best.entry.replace(/\/+$/, '').length) best = r
    }
    return best?.password ?? ''
  }

  /** 创建一条分享路由。root 必须是存在的绝对路径（主进程校验），token 12B base64url。 */
  async create(input: ShareRouteInput): Promise<ShareRouteTicket> {
    const root = String(input?.root ?? '').trim()
    const isContent = input?.kind === 'content'
    if (!root) throw new Error('分享根目录不能为空')
    // content kind 的 root 是虚拟标记（内容在 NeDB 不在磁盘），跳过磁盘存在性校验；file kind 保持原语义
    if (!isContent && (!existsSync(root) || !statSync(root).isDirectory())) throw new Error(`分享根目录不存在或不是目录：${root}`)
    // 防穿越：入口若给出，必须在 root 内（content kind 无磁盘 root，跳过）
    const entry = String(input?.entry ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
    const isContentList = isContent && entry === ShareHub.CONTENT_LIST_ENTRY
    if (isContent && !isContentList && !String(input?.contentId ?? '')) throw new Error('content 路由必须提供 contentId')
    if (!String(input?.toolId ?? '')) throw new Error('toolId 不能为空')
    if (entry && !isContent) resolveSafe(root, entry)

    const ttlHours = normalizeTtl(input.ttlHours)
    const now = Date.now()
    // 密码每条路由独立；未设置（空）时继承同 root 下最近祖先路由的密码（用户 2026-11-19）
    const password = String(input.password ?? '') || this.inheritedPassword(root, entry)
    const route: ShareRoute = {
      id: randomUUID(),
      token: randomBytes(12).toString('base64url'),
      toolId: String(input.toolId),
      label: String(input.label ?? '分享'),
      root,
      entry,
      ttlHours,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAtFor(ttlHours, now),
      password,
      // 应用级默认（app.shareHub.allowIndex）由宿主在 IPC 层注入；share-core 未收到时保持允许（兼容旧调用方）
      allowIndex: input.allowIndex === undefined ? undefined : Boolean(input.allowIndex),
      hits: 0,
      kind: isContent ? 'content' : 'file',
      contentId: isContent ? String(input.contentId) : undefined,
    }
    this.routes.set(route.token, route)
    this.schedulePersist()
    return this.ticket(route)
  }

  /** 撤销一条路由（按 id 或 token 均可）。 */
  async revoke(idOrToken: string): Promise<boolean> {
    const route = this.findBy(idOrToken)
    if (!route) return false
    this.routes.delete(route.token)
    this.schedulePersist()
    return true
  }

  /**
   * 续期一条路由（复用 token，URL 不变），返回新 ticket。
   * mode='reset'：从当前时刻重新计时 ttlHours（默认）；
   * mode='extend'：在当前到期时刻上累加 ttlHours（永久路由累加仍为永久）；
   * ttlHours=0：无论何种 mode 都设为永久有效；
   * ttlHours=null：不改有效期（仅应用 patch，供目录浏览开关等属性级修改，token/链接不变）；
   * patch.allowIndex：同时改写目录浏览开关（undefined = 不动）。
   */
  async renew(idOrToken: string, ttlHours: number | null, mode: 'reset' | 'extend' = 'reset', patch?: { allowIndex?: boolean; password?: string }): Promise<ShareRouteTicket> {
    const route = this.findBy(idOrToken)
    if (!route) throw new Error('分享路由不存在或已过期')
    if (ttlHours !== null) {
      const hours = normalizeTtl(ttlHours)
      if (hours === 0) {
        route.ttlHours = 0
        route.expiresAt = SHARE_PERMANENT_EXPIRES_AT
      } else if (mode === 'extend') {
        // 累加：永久路由保持永久（累加有限时长不应撤销永久授权）
        if (route.expiresAt !== SHARE_PERMANENT_EXPIRES_AT) {
          const base = Math.max(route.expiresAt, Date.now())
          route.expiresAt = base + hours * 3600_000
        }
        route.ttlHours = hours
      } else {
        route.ttlHours = hours
        route.expiresAt = expiresAtFor(hours)
      }
    }
    if (patch && patch.allowIndex !== undefined) route.allowIndex = Boolean(patch.allowIndex)
    if (patch && patch.password !== undefined) route.password = String(patch.password ?? '')
    route.updatedAt = Date.now()
    this.schedulePersist()
    return this.ticket(route)
  }

  /** 路由列表（可按 toolId 过滤），时间倒序。 */
  listRoutes(toolId?: string): ShareRouteInfo[] {
    return [...this.routes.values()]
      .filter((r) => !toolId || r.toolId === toolId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id, toolId: r.toolId, label: r.label, entry: r.entry, root: r.root,
        ttlHours: r.ttlHours, expiresAt: r.expiresAt, createdAt: r.createdAt, updatedAt: r.updatedAt, hits: r.hits,
        allowIndex: r.allowIndex !== false, password: r.password ?? '',
        kind: r.kind ?? 'file', contentId: r.contentId,
      }))
  }

  /** 服务状态快照（status IPC 返回）。 */
  status(): HubStatus {
    return {
      running: this.running,
      port: this.port,
      displayIp: this.displayIp(),
      ips: this.listIps(),
      routes: this.listRoutes(),
    }
  }

  /** 枚举本机 IPv4 候选（含虚拟网卡标记）；不在此处过滤禁用项——UI 需要展示「虚拟但可选」。 */
  listIps(): ShareIpInfo[] {
    const seen = new Set<string>()
    const result: ShareIpInfo[] = []
    for (const [nic, list] of Object.entries(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family !== 'IPv4' || ni.internal || seen.has(ni.address)) continue
        if (ni.address.startsWith('127.') || ni.address.startsWith('169.254.')) continue
        seen.add(ni.address)
        result.push({ ip: ni.address, nic, virtual: VIRTUAL_NIC_RE.test(nic) })
      }
    }
    // 排序：以太网/WLAN 优先，然后 10.* > 192.168.* > 172.*，其余最后
    const rank = (ip: string): number => ip.startsWith('10.') ? 0 : ip.startsWith('192.168.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
    result.sort((a, b) => {
      const an = /以太网|Ethernet|WLAN|Wi-Fi/i.test(a.nic) ? 0 : 1
      const bn = /以太网|Ethernet|WLAN|Wi-Fi/i.test(b.nic) ? 0 : 1
      return an - bn || rank(a.ip) - rank(b.ip)
    })
    return result
  }

  /** 当前生效的展示 IP：手输优先；否则按 §4.3 规则自动优选。 */
  displayIp(): string {
    if (this.preferredIp) return this.preferredIp
    const ips = this.listIps().filter((x) => !x.virtual)
    const pick = (prefix: (ip: string) => boolean): string | undefined =>
      ips.find((x) => prefix(x.ip))?.ip
    return pick((ip) => ip.startsWith('10.'))
      ?? pick((ip) => ip.startsWith('192.168.'))
      ?? pick((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
      ?? ips[0]?.ip
      ?? '127.0.0.1'
  }

  private findBy(idOrToken: string): ShareRoute | undefined {
    if (!idOrToken) return undefined
    const direct = this.routes.get(idOrToken)
    if (direct) return direct
    return [...this.routes.values()].find((r) => r.id === idOrToken)
  }

  private ticket(route: ShareRoute): ShareRouteTicket {
    return { id: route.id, token: route.token, urls: this.urls(route.token, route.password), expiresAt: route.expiresAt }
  }

  /** 生成展示链接：展示 IP 排第一，其余有效候选兜底（去重）；带口令时补 ?ak=accessKey。 */
  private urls(token: string, password?: string): string[] {
    if (!this.running || !this.port) return []
    const display = this.displayIp()
    const candidates = [display, ...this.listIps().map((x) => x.ip), '127.0.0.1']
    const ak = password ? `?ak=${encodeURIComponent(password)}` : ''
    const urls: string[] = []
    const seen = new Set<string>()
    for (const ip of candidates) {
      if (!ip || seen.has(ip)) continue
      seen.add(ip)
      urls.push(`http://${ip}:${this.port}/${token}/${ak}`)
    }
    return urls
  }

  private async listen(requestedPort: number): Promise<void> {
    const server = createServer((req, res) => { void this.handle(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(requestedPort === 0 ? 0 : requestedPort, '0.0.0.0', () => resolve())
    })
    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : requestedPort
    if (requestedPort > 0 && this.port !== requestedPort) {
      this.onPortFallback?.(requestedPort, this.port)
    }
    this.server = server
  }

  /** 静态请求处理：token 路由 → 口令校验 → 入口/列表页/资源 → Range → 计数 + 日志。 */
  private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const clientIp = req.socket.remoteAddress ?? ''
    let routeId = ''
    let status = 404
    let rel = ''
    try {
      const url = new URL(req.url ?? '/', 'http://local')
      const token = url.pathname.split('/')[1] ?? ''
      // 三级解析（用户 2026-11-18）：工具分享 token → 挂载别名 → 代理前缀（前缀冲突时先注册者语义优先由 setProxies 拦截）
      const route = this.routes.get(token) ?? this.mountRoutes.get(token)
      if (!route) {
        const rule = this.proxyRules.get(token)
        if (rule) {
          await this.handleProxy(req, res, rule, clientIp, token, url)
          return
        }
        this.finish(res, 404, 'Not Found')
        this.log(clientIp, routeId, rel, 404)
        return
      }
      if (Date.now() > route.expiresAt) {
        this.routes.delete(token)
        this.finish(res, 404, 'Not Found')
        this.log(clientIp, routeId, rel, 404)
        return
      }
      routeId = route.id

      // 访问密钥校验：入口 ?ak= 与资源 ?ak= 都要带（链接本身携带 ak=accessKey）
      if (route.password && url.searchParams.get('ak') !== route.password) {
        this.finish(res, 403, 'Forbidden: 需要访问口令')
        this.log(clientIp, routeId, rel, 403)
        return
      }

      // 内容路由（plans/11 方案 B/C）：宿主注入的 resolver 读库；core 不依赖 repository。
      //  entry=__list__ → 方案 C 公用总链（已发布文章列表页，宿主构造 HTML）；否则单篇活路由（方案 B）。
      //  null=内容不存在/已归档/resolver 未注入→404，避免悬空旧内容。
      if (route.kind === 'content') {
        let html: string | null = null
        const reqId = url.searchParams.get('id')
        const isListRoute = route.entry === ShareHub.CONTENT_LIST_ENTRY
        if (isListRoute && !reqId) {
          // C 公用总链：已发布文章列表页
          html = await this.contentListResolver?.(url.searchParams.get('ak') ?? '') ?? null
        } else {
          // 单篇：C 列表里点进来的 ?id=<cnt>，或行级 B 路由绑定的 contentId
          const contentId = reqId || route.contentId
          const content = contentId ? await this.contentResolver?.(contentId) ?? null : null
          if (content) html = this.renderArticle(route, content)
        }
        if (!html) {
          this.finish(res, 404, 'Not Found')
          this.log(clientIp, routeId, rel, 404)
          return
        }
        route.hits++
        if (!route.mountId) this.schedulePersist()
        this.finish(res, 200, html, { 'content-type': MIME['.html']! })
        this.log(clientIp, routeId, rel, 200)
        return
      }

      let relRaw = decodeURIComponent(url.pathname.slice(token.length + 2))
      if (!relRaw) relRaw = route.entry || ''
      rel = relRaw

      // 目录浏览开关（用户 2026-11-18：默认不允许）：目录列表页（根/子目录）在关闭时一律 404；
      // 直接文件路径不受影响——「前缀+文件路径」的行级直达链接仍然可用
      const indexAllowed = route.allowIndex !== false

      if (!relRaw) {
        if (!indexAllowed) {
          this.finish(res, 404, 'Not Found')
          this.log(clientIp, routeId, rel, 404)
          return
        }
        // 目录列表页（root 根）
        const html = this.renderIndex(route, '')
        this.finish(res, 200, html, { 'content-type': MIME['.html']! })
        route.hits++
        if (!route.mountId) this.schedulePersist() // 挂载路由计数仅内存态（配置权威，不落盘）
        this.log(clientIp, routeId, rel, 200)
        return
      }

      const abs = resolveSafe(route.root, relRaw)
      const st = await stat(abs)
      route.hits++
      if (!route.mountId) this.schedulePersist() // 挂载路由计数仅内存态

      if (st.isDirectory()) {
        if (!indexAllowed) {
          this.finish(res, 404, 'Not Found')
          this.log(clientIp, routeId, rel, 404)
          return
        }
        const html = this.renderIndex(route, relRaw.replace(/\/+$/, ''))
        this.finish(res, 200, html, { 'content-type': MIME['.html']! })
        status = 200
        this.log(clientIp, routeId, rel, status)
        return
      }

      status = 200
      const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.range
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0
          const end = m[2] ? parseInt(m[2], 10) : st.size - 1
          if (start >= 0 && end >= start && start < st.size) {
            const safeEnd = Math.min(end, st.size - 1)
            res.writeHead(206, {
              'content-type': type,
              'content-length': String(safeEnd - start + 1),
              'content-range': `bytes ${start}-${safeEnd}/${st.size}`,
              'accept-ranges': 'bytes',
            })
            createReadStream(abs, { start, end: safeEnd }).pipe(res)
            this.log(clientIp, routeId, rel, 206)
            return
          }
          res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end()
          this.log(clientIp, routeId, rel, 416)
          return
        }
      }
      res.writeHead(200, { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes' })
      createReadStream(abs).pipe(res)
      this.log(clientIp, routeId, rel, status)
    } catch {
      this.finish(res, 404, 'Not Found')
      this.log(clientIp, routeId, rel, 404)
    }
  }

  /** 全方法反向代理（用户 2026-11-18 定版）：请求体/响应体流式 pipe（支持 POST 等），不落盘不缓存；
   *  hop-by-hop 头两侧剥离；keepHost=false 时 Host 改为目标 host，true 保留客户端原始 Host。 */
  private async handleProxy(
    req: IncomingMessage,
    res: ServerResponse,
    rule: ProxyRule,
    clientIp: string,
    token: string,
    url: URL,
  ): Promise<void> {
    // 剩余路径透传编码串（目标服务器自行 decode）；拼目标基础路径与 query
    const rel = url.pathname.slice(token.length + 1)
    const basePath = rule.targetUrl.pathname.replace(/\/+$/, '')
    const outPath = `${basePath}/${rel}${url.search}`
    const headers: Record<string, string | string[] | undefined> = { ...req.headers }
    for (const h of HOP_BY_HOP_HEADERS) delete headers[h]
    if (!rule.keepHost) headers.host = rule.targetUrl.host
    // X-Forwarded-*（用户 2026-11-18 拍板）：本服务是可信代理，一律**覆盖**而非追加，防访客伪造链路；
    // 后端需要代理链信息时从这三个头取（X-Forwarded-Host=客户端访问的 host，Proto=客户端协议恒 http，For=客户端 IP）
    headers['x-forwarded-for'] = normalizeClientIp(clientIp)
    headers['x-forwarded-host'] = String(req.headers.host ?? '')
    headers['x-forwarded-proto'] = 'http'
    const send = rule.targetUrl.protocol === 'https:' ? httpsRequest : httpRequest
    const proxyReq = send({
      protocol: rule.targetUrl.protocol,
      hostname: rule.targetUrl.hostname,
      port: rule.targetUrl.port || (rule.targetUrl.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: outPath,
      headers,
    }, (pr) => {
      const status = pr.statusCode ?? 502
      const outHeaders: Record<string, string | string[] | undefined> = { ...pr.headers }
      for (const h of HOP_BY_HOP_HEADERS) delete outHeaders[h]
      res.writeHead(status, outHeaders)
      pr.pipe(res) // 响应体流式回传
      this.log(clientIp, `proxy:${rule.id}`, rel || '/', status)
    })
    proxyReq.setTimeout(30_000, () => proxyReq.destroy(new Error('代理请求超时（30s）')))
    proxyReq.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return }
      this.finish(res, 502, `Bad Gateway: ${(err as Error).message}`)
      this.log(clientIp, `proxy:${rule.id}`, rel || '/', 502)
    })
    req.pipe(proxyReq) // 请求体流式转发（GET body 为空无影响）
  }

  /** 目录列表页：HTML 转义防 XSS，条目带 URL 编码的 rel 路径。 */
  private renderIndex(route: ShareRoute, relDir: string): string {
    const absDir = relDir ? resolveSafe(route.root, relDir) : route.root
    const entries = existsSync(absDir)
      ? readdirSyncSafe(absDir).map((name) => {
          const full = join(absDir, name)
          const isDir = statSync(full).isDirectory()
          const relPath = relDir ? `${relDir}/${name}` : name
          const href = `/${route.token}/${relPath.split('/').map(encodeURIComponent).join('/')}` +
            (route.password ? `?ak=${encodeURIComponent(route.password)}` : '')
          return `<li><a href="${esc(href)}">${esc(name)}${isDir ? '/' : ''}</a></li>`
        }).sort((a, b) => a.localeCompare(b))
      : []
    const title = esc(route.label || '分享')
    const parent = relDir
      ? `<p><a href="/${route.token}/${relDir.split('/').slice(0, -1).map(encodeURIComponent).join('/')}${route.password ? `?ak=${encodeURIComponent(route.password)}` : ''}">← 上级</a></p>`
      : ''
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:14px/1.6 system-ui,sans-serif;margin:32px;color:#c9d3ee;background:#0b0e1c}a{color:#5eb0ff;text-decoration:none}a:hover{text-decoration:underline}li{padding:2px 0}h1{font-size:18px}</style></head><body><h1>${title}</h1>${parent}<ul>${entries.join('')}</ul></body></html>`
  }

  /** 文章阅读页（plans/11 方案 B）：标题转义防 XSS；正文 html 是编辑器展示态（宿主已 toDisplayHtml），
   *  图片为外链或有效 ShareHub 图片链接，直接内嵌。 */
  private renderArticle(route: ShareRoute, content: ShareContentResolverResult): string {
    const title = esc(content.title || route.label || '文章')
    const summary = content.summary ? `<p class="summary">${esc(content.summary)}</p>` : ''
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
      body{font:16px/1.8 system-ui,-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f2430;background:#fff}
      h1{font-size:28px;line-height:1.4;margin:0 0 8px;border-bottom:1px solid #e8eaf0;padding-bottom:16px}
      .summary{color:#6b7280;font-size:14px;margin:0 0 28px}
      .article img{max-width:100%;height:auto}
      pre{overflow:auto;background:#f5f6f8;padding:12px;border-radius:6px}
      blockquote{border-left:3px solid #5eb0ff;margin:0;padding-left:16px;color:#555}
      a{color:#2563eb}
    </style></head><body><article><h1>${title}</h1>${summary}<div class="article">${content.html}</div></article></body></html>`
  }

  private finish(res: import('node:http').ServerResponse, code: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', ...headers })
    res.end(body)
  }

  private log(ip: string, routeId: string, path: string, status: number): void {
    // 写入时即生成 UUID（不依赖 NeDB _id 回执），作为删除/批量勾选的稳定键
    this.logQueue.push({ id: randomUUID(), at: Date.now(), ip, path, status, routeId })
    if (this.logFlushTimer) return
    this.logFlushTimer = setTimeout(() => {
      this.logFlushTimer = null
      void this.flushLogs()
    }, 500)
    this.logFlushTimer.unref?.()
  }

  /** 按内容 id 移除尚未落库的日志（删除已查出的记录时，防止队列里旧的再写回） */
  removeQueuedLogs(ids: string[]): void {
    const kill = new Set(ids)
    this.logQueue = this.logQueue.filter((l) => !kill.has(l.id))
  }

  /** TTL 双保险之一：定时清理过期路由（之二为命中时惰性校验）。 */
  private sweepExpired(): void {
    const now = Date.now()
    let changed = false
    for (const [token, route] of this.routes) {
      if (now > route.expiresAt) { this.routes.delete(token); changed = true }
    }
    if (changed) this.schedulePersist()
  }

  /** 从状态文件恢复未过期路由（已过期剔除并从文件移除）。 */
  private resumeRoutes(): void {
    if (!existsSync(this.stateFile)) return
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as PersistedHub
      if (!saved || !Array.isArray(saved.routes)) return
      const now = Date.now()
      for (const r of saved.routes) {
        // plans/12 总原则：不兼容旧数据——缺 updatedAt 的旧路由视为脏数据丢弃（旧链接失效，用户已接受）
        if (!r?.token || !r.root || !r.expiresAt || typeof r.updatedAt !== 'number') continue
        if (now > r.expiresAt) continue
        // content kind 的 root 是虚拟标记（内容在 NeDB），不校验磁盘存在；file kind 保持
        if (r.kind !== 'content' && !existsSync(r.root)) continue
        this.routes.set(r.token, {
          id: r.id ?? randomUUID(), token: r.token, toolId: r.toolId ?? '',
          label: r.label ?? '分享', root: r.root, entry: r.entry ?? '',
          ttlHours: r.ttlHours ?? DEFAULT_TTL_HOURS, createdAt: r.createdAt ?? now,
          updatedAt: r.updatedAt, expiresAt: r.expiresAt, password: r.password ?? '',
          allowIndex: r.allowIndex, hits: r.hits ?? 0,
          kind: r.kind ?? 'file', contentId: r.contentId,
        })
      }
      void this.flushPersist()
    } catch {
      // 状态文件损坏：忽略，从空路由表开始（不影响服务启动）
    }
  }

  /** 写操作串行化 + 500ms 节流合并（多工具并发 create 不重复落盘）。 */
  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.flushPersist()
    }, 500)
    this.persistTimer.unref?.()
  }

  private async flushPersist(): Promise<void> {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    if (!this.stateFile) return
    try {
      const dir = dirname(this.stateFile)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const state: PersistedHub = { version: 1, routes: [...this.routes.values()] }
      await writeFile(this.stateFile, JSON.stringify(state), 'utf8')
    } catch {
      // 落盘失败不影响当次分享（内存态仍是权威）
    }
  }
}

/** readdirSync 的薄封装（集中在内核内，便于类型收窄）；避免遗漏 withFileTypes 参数。 */
function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() || e.isDirectory())
    .map((e) => e.name)
}

/** HTML 转义（防目录名 XSS） */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** 计算剩余有效期描述（分钟）——保留导出以兼容外部可能的引用。 */
export function ttlMinutesLeft(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
}

/** 旧状态文件名（badge/edm）——由宿主启动时检测即静默删除，内核不读取不迁移。 */
export const LEGACY_SHARE_STATE_FILES = ['badge-share-state.json', 'edm-share-state.json']
