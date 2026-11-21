/**
 * ShareHub 常驻分享服务宿主封装（plans/09）。
 * - 持有主进程唯一 ShareHub 实例（@sshk/share-core），收敛生命周期：
 *   autoStart 启动 / 固定端口被占回落告警 / powerMonitor.resume 自动重启 / 退出落盘
 * - 旧状态文件（badge-share-state.json / edm-share-state.json）启动检测即静默删除（决策 11）
 * - toolId 记账鉴权：工具只能撤销/续期自己创建的路由，宿主（空 toolId）可管理全部
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { powerMonitor } from 'electron'
import { ShareHub, LEGACY_SHARE_STATE_FILES } from '@sshk/share-core'
import { AppError, IPC_CHANNELS,
  TOOL_IDS,
  type   ShareRouteInput,
  type ShareHubMount,
  type ShareHubProxy,
  type HubStatus,
  type ShareContentResolverResult,
  type ShareLogsQuery,
  type ShareAccessLog,
  format, } from '@sshk/shared'
import type { ConfigService, Repository, ShareLogDoc } from '@sshk/repository'
import { handleOk } from './ipc-wrap'
import { logger } from './logger'

export interface ShareHubHost {
  hub: ShareHub
  /** 启动应使用的端口：固定端口（port>0）优先；自动分配模式沿用上次持久化的 autoPort */
  resolvePort(): number
  /** 新建路由未显式指定时的「允许访问目录」默认值（app.shareHub.allowIndex，默认不允许） */
  getDefaultAllowIndex(): boolean
  /** 由 index.ts 在 whenReady 中调用；重复调用幂等 */
  init(): Promise<void>
  /** 退出前停止并落盘 */
  dispose(): Promise<void>
}

/** toolId 参数来源：调用方 renderer 自报。撤销/续期按 route.toolId 严格匹配（P1-5 硬鉴权，'*' 通配已废除）；
 *  不传 toolId 仅限分享管理台（应用模块的跨工具管理特权，RoutesPage）。 */
function resolveToolId(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/**
 * hub-state.json 工具改名迁移（2026-11-19 上传管理→文件管理，幂等）：
 * 路由的 toolId 是撤销/续期的记账鉴权依据（内核 handle 校验 route.toolId === caller），
 * 不迁移的话改名后工具对自己的旧分享路由「无权操作」且列表查不到（复用原则被破坏）。
 * 在内核加载状态文件前重写 routes[].toolId；无文件/无匹配时零副作用。
 */
function migrateShareStateToolId(stateFile: string): void {
  try {
    if (!existsSync(stateFile)) return
    const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as { routes?: Array<{ toolId?: string }> }
    if (!Array.isArray(raw.routes)) return
    let moved = 0
    // 旧 id 链全量覆盖（upload-config 时期的路由理论上不存在，防历史遗留漏迁）
    for (const r of raw.routes) {
      if (r?.toolId === 'upload-manager' || r?.toolId === 'upload-config') { r.toolId = TOOL_IDS.fileManager; moved++ }
    }
    if (moved > 0) {
      writeFileSync(stateFile, JSON.stringify(raw, null, 2), 'utf8')
      logger.info('shareHub', `分享路由归属迁移：upload-manager/upload-config → ${TOOL_IDS.fileManager}（${moved} 条）`)
    }
  } catch (err) {
    logger.error('shareHub', `分享路由归属迁移失败（不影响启动）：${(err as Error).message}`)
  }
}

export function createShareHubHost(cfg: ConfigService, opts: {
  userDataDir: string
  isDev: boolean
  /** 内容 resolver（plans/11 方案 B）：由 index.ts 注入（宿主读库），core 不依赖 repository */
  contentResolver?: (contentId: string) => ShareContentResolverResult | null | Promise<ShareContentResolverResult | null>
  /** 内容列表页 resolver（plans/11 方案 C）：宿主构造已发布文章列表页 HTML */
  contentListResolver?: (accessKey: string) => string | null | Promise<string | null>
  /** 数据层（plans/12）：访问日志持久化 NeDB shareLogs 集合；未传则日志不落库 */
  repository?: Repository
}): ShareHubHost {
  const stateFile = join(opts.userDataDir, 'hub-state.json')
  migrateShareStateToolId(stateFile)
  const hub = new ShareHub(stateFile)
  if (opts.contentResolver) hub.registerContentResolver(opts.contentResolver)
  if (opts.contentListResolver) hub.registerContentListResolver(opts.contentListResolver)

  // ── 访问日志持久化（plans/12）：内核批量 flush → NeDB shareLogs；容量清理随写入顺带做 ──
  /** 容量 clamp：条数 1~100000（默认 5000），天数 1~365（默认 30）；非法回默认（plans/12 §十二④） */
  function clampLogCapacity(): { maxCount: number; days: number } {
    const rawCount = Number(cfg.get('app.shareHub.logMaxCount'))
    const rawDays = Number(cfg.get('app.shareHub.logRetentionDays'))
    const maxCount = Number.isInteger(rawCount) && rawCount > 0 ? Math.min(rawCount, 100_000) : 5000
    const days = Number.isInteger(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30
    return { maxCount, days }
  }
  if (opts.repository) {
    const repo = opts.repository
    let cleaning = false
    hub.setLogSink(async (rows: ShareAccessLog[]) => {
      for (const row of rows) {
        await repo.insert<ShareLogDoc>('shareLogs', { id: row.id, at: row.at, ip: row.ip, path: row.path, status: row.status, routeId: row.routeId })
      }
      // 滚动清理：30 天前删除 + 超 N 条删最旧（无提示，与清空/批量删除边界独立）
      if (cleaning) return
      cleaning = true
      void (async () => {
        try {
          const { maxCount, days } = clampLogCapacity()
          const cutoff = Date.now() - days * 86_400_000
          await repo.removeWhere('shareLogs', { at: { $lt: cutoff } })
          const total = await repo.count('shareLogs')
          if (total > maxCount) {
            const stale = await repo.list<ShareLogDoc>('shareLogs', {}, { at: 1 })
            const excess = stale.slice(0, total - maxCount).map((d) => d.id)
            if (excess.length) await repo.removeWhere('shareLogs', { id: { $in: excess } })
          }
        } catch (err) {
          logger.warn('shareHub', `访问日志清理失败（不影响写入）：${(err as Error).message}`)
        } finally {
          cleaning = false
        }
      })()
    })
  }
  function applyLogCapacity(): void {
    const { maxCount, days } = clampLogCapacity()
    hub.setLogCapacity(maxCount, days)
  }

  // 固定端口被占回落 → 日志 +（dev）终端告警；ElMessage 由渲染层 status 轮询感知端口变化后提示
  hub.setPortFallbackHandler((requested, actual) => {
    const msg = `[shareHub] 固定端口 ${requested} 被占用，已回落到随机端口 ${actual}`
    logger.warn('shareHub', msg)
    if (opts.isDev) console.warn(msg)
  })

  function applyPreferredIp(): void {
    hub.setPreferredIp(String(cfg.get('app.shareHub.preferredIp') ?? ''))
  }

  /**
   * 启动端口决策（用户 2026-11-18：自动分配也要沿用，链接不能每次变）：
   *  - 固定端口 port>0 → 直接用（被占由内核回落随机）
   *  - port=0 自动分配 → 沿用上次持久化的 autoPort；首次为 0 时交给系统分配
   */
  function resolvePort(): number {
    const fixed = Number(cfg.get('app.shareHub.port') ?? 0) || 0
    if (fixed > 0) return fixed
    return Number(cfg.get('app.shareHub.autoPort') ?? 0) || 0
  }

  /** 自动分配模式下把实际端口持久化到 autoPort（固定端口模式不动，保留用户的 0 设置） */
  function persistAutoPort(): void {
    const fixed = Number(cfg.get('app.shareHub.port') ?? 0) || 0
    if (fixed > 0) return
    const actual = hub.getPort()
    if (actual > 0 && Number(cfg.get('app.shareHub.autoPort') ?? 0) !== actual) {
      cfg.set('app.shareHub.autoPort', actual)
    }
  }

  /** 统一启动入口：按 resolvePort 启动 + 回写 autoPort。
   *  已在运行时先 stop 再 start——内核 restart(requestedPort) 会沿用旧端口，
   *  固定端口变更必须走显式重启才能生效。 */
  async function startHub(): Promise<void> {
    const port = resolvePort()
    if (hub.running) await hub.stop()
    await hub.start(port)
    persistAutoPort()
  }

  function removeLegacyStates(): void {
    for (const name of LEGACY_SHARE_STATE_FILES) {
      const file = join(opts.userDataDir, name)
      try { if (existsSync(file)) unlinkSync(file) } catch { /* 静默忽略删除失败 */ }
    }
  }

  /** 挂载目录（多目录分享，用户 2026-11-18）：配置 app.shareHub.mounts 为权威，
   *  变更即时生效（setMounts 重建别名路由，无需重启）；无效项记日志不阻断。 */
  function applyMounts(): void {
    const raw = cfg.get('app.shareHub.mounts')
    // 粗过滤：仅收结构合法的行（细校验在内核 setMounts）
    const mounts: ShareHubMount[] = (Array.isArray(raw) ? raw : []).filter(
      (m): m is ShareHubMount => !!m && typeof m === 'object' && typeof (m as ShareHubMount).dir === 'string',
    )
    const skipped = hub.setMounts(mounts)
    if (skipped.length) logger.warn('shareHub', `挂载目录部分无效已跳过：${skipped.join('；')}`)
  }

  /** 代理规则（用户 2026-11-18）：配置 app.shareHub.proxies 为权威，变更即时生效（setProxies）。 */
  function applyProxies(): void {
    const raw = cfg.get('app.shareHub.proxies')
    const proxies: ShareHubProxy[] = (Array.isArray(raw) ? raw : []).filter(
      (p): p is ShareHubProxy => !!p && typeof p === 'object' && typeof (p as ShareHubProxy).target === 'string',
    )
    const skipped = hub.setProxies(proxies)
    if (skipped.length) logger.warn('shareHub', `代理规则部分无效已跳过：${skipped.join('；')}`)
  }

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    removeLegacyStates()
    applyPreferredIp()
    applyMounts()
    applyProxies()
    applyLogCapacity()
    if (cfg.get('app.shareHub.autoStart') !== false) {
      try { await startHub() } catch (err) {
        logger.error('shareHub', `自动启动失败：${(err as Error).message}`)
      }
    }
    // 配置即时生效：preferredIp 立即换；autoStart 开→启动、关→停止（保留路由）；port 变更→用新端口重启
    cfg.onChanged((ns, key) => {
      if (ns !== 'app' || !key.startsWith('shareHub.')) return
      if (key === 'shareHub.preferredIp') { applyPreferredIp(); return }
      // 挂载目录/代理规则变更即时生效（保存即生效，无需重启——用户 2026-11-18 定版）
      if (key === 'shareHub.mounts') { applyMounts(); return }
      if (key === 'shareHub.proxies') { applyProxies(); return }
      // 日志容量变更即时生效（plans/12：clamp 后注入内核）
      if (key === 'shareHub.logMaxCount' || key === 'shareHub.logRetentionDays') { applyLogCapacity(); return }
      if (key === 'shareHub.autoStart') {
        const on = cfg.get('app.shareHub.autoStart') !== false
        if (on && !hub.running) void startHub()
        if (!on && hub.running) void hub.stop()
        return
      }
      // autoPort 由本宿主自己写入（persistAutoPort），不触发重启
      if (key === 'shareHub.port' && hub.running) {
        void startHub()
      }
    })
    // 系统睡眠恢复：自动 restart（保留路由与 token）
    powerMonitor.on('resume', () => {
      if (hub.running) void hub.restart().catch(() => { /* 端口短暂不可用不影响后续 */ })
    })
  }

  async function dispose(): Promise<void> {
    await hub.stop()
  }

  return {
    hub,
    resolvePort,
    // 应用级「允许访问目录」默认：未配置/配置非 true 一律不允许（用户 2026-11-18 定版）
    getDefaultAllowIndex: () => cfg.get('app.shareHub.allowIndex') === true,
    init,
    dispose,
  }
}

/** 注册 ShareHub 的 IPC（create/list/revoke/renew/status/control + logs/exportLogs/deleteLogs/clearLogs）。
 *  全部经 handleOk，遵守 check:ipc 门禁。repository 为日志持久化数据层（plans/12，可选）。 */
/** P1-5（A15/Q-13）硬鉴权守卫：sender 必须是主窗口 webContents（可信身份绑定），
 *  toolId 必须是在册工具（目录裁决）；守卫缺省视为通过（单测/兼容）。 */
export interface ShareHubGuards {
  isTrustedSender: (sender: unknown) => boolean
  isKnownTool: (toolId: string) => boolean
}

export function registerShareHubIpc(host: ShareHubHost, repository?: Repository, guards?: ShareHubGuards): void {
  const hub = host.hub
  const hostRepository = repository
  const trusted = (e: unknown): void => {
    if (guards && !guards.isTrustedSender((e as { sender?: unknown })?.sender)) {
      throw new AppError('分享通道拒绝非主窗口调用', 'permission')
    }
  }

  handleOk(IPC_CHANNELS.shareHubCreate, (e, input: ShareRouteInput) => {
    trusted(e)
    if (!input?.toolId || !guards?.isKnownTool(input.toolId)) {
      throw new AppError('分享路由归属工具非法（toolId 不在册）', 'validation')
    }
    // 应用级默认（app.shareHub.allowIndex，默认不允许）：弹框未显式指定时在此注入（弹框值优先）
    return hub.create({ ...input, allowIndex: input.allowIndex ?? host.getDefaultAllowIndex() })
  })

  handleOk(IPC_CHANNELS.shareHubList, (e, toolId?: string) => {
    trusted(e)
    return hub.listRoutes(resolveToolId(toolId) || undefined)
  })

  handleOk(IPC_CHANNELS.shareHubRevoke, (e, id: string, toolId?: string) => {
    trusted(e)
    const caller = resolveToolId(toolId)
    // P1-5：'*' 通配绕过已废除——带 toolId 即严格匹配；不传 = 分享管理台特权
    if (caller) {
      const route = hub.listRoutes().find((r) => r.id === id)
      if (!route) return false
      if (route.toolId !== caller) throw new AppError('无权撤销其它工具的分享路由', 'permission')
    }
    return hub.revoke(id)
  })

  handleOk(IPC_CHANNELS.shareHubRenew, (e, id: string, ttlHours: number | null, toolId?: string, mode?: 'reset' | 'extend', patch?: { allowIndex?: boolean; password?: string }) => {
    trusted(e)
    const caller = resolveToolId(toolId)
    if (caller) {
      const route = hub.listRoutes().find((r) => r.id === id)
      if (!route) throw new AppError('分享路由不存在', 'io')
      if (route.toolId !== caller) throw new AppError('无权续期其它工具的分享路由', 'permission')
    }
    return hub.renew(id, ttlHours, mode, patch)
  })

  handleOk(IPC_CHANNELS.shareHubStatus, (): HubStatus => hub.status())

  // ── 访问日志独立通道（plans/12）：读取链路彻底改造，不走 status；NeDB shareLogs ──
  /** 查询条件 → NeDB query（时间毫秒/IP·路径模糊/状态码分组/工具·路由反查）；routeId→toolId 反查在 handler 内做 */
  function buildLogQuery(q: ShareLogsQuery | undefined, routeIds?: string[]): Record<string, unknown> {
    const query: Record<string, unknown> = {}
    if (q?.from !== undefined || q?.to !== undefined) {
      query.at = { ...(q?.from !== undefined ? { $gte: q.from } : {}), ...(q?.to !== undefined ? { $lte: q.to } : {}) }
    }
    if (q?.ip?.trim()) query.ip = { $regex: new RegExp(escapeRegExp(q.ip.trim()), 'i') }
    if (q?.path?.trim()) query.path = { $regex: new RegExp(escapeRegExp(q.path.trim()), 'i') }
    if (q?.statusGroup) {
      const base = Number(q.statusGroup[0]) * 100
      query.status = { $gte: base, $lt: base + 100 }
    }
    if (routeIds) query.routeId = { $in: routeIds }
    return query
  }
  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  /** 归属工具/标签反查不在日志行存储：toolId 过滤时先从路由表查出该工具全部 routeId */
  function routeIdsOf(toolId: string): string[] {
    return hub.listRoutes().filter((r) => r.toolId === toolId).map((r) => r.id)
  }

  handleOk(IPC_CHANNELS.shareHubLogs, async (_e, q?: ShareLogsQuery) => {
    const repo = hostRepository
    if (!repo) throw new AppError('数据层未就绪，无法读取访问日志', 'io')
    const routeIds = q?.toolId?.trim() ? routeIdsOf(q.toolId.trim()) : undefined
    // 工具过滤下无匹配路由 → 直接空结果（避免 $in 空数组语义歧义）
    if (routeIds && routeIds.length === 0) return { rows: [], total: 0 }
    const query = buildLogQuery(q, routeIds)
    const total = await repo.count('shareLogs', query)
    const limit = Math.min(Math.max(Number(q?.limit) || 200, 1), 1000)
    const offset = Math.max(Number(q?.offset) || 0, 0)
    // CR-45（P1-4）：skip/limit 下推 NeDB，翻页不再全表扫描 + 内存 slice
    const docs = await repo.list<ShareLogDoc>('shareLogs', query, { at: -1 }, { skip: offset, limit })
    const rows: ShareAccessLog[] = docs.map((d) => ({ id: d.id, at: d.at, ip: d.ip, path: d.path, status: d.status, routeId: d.routeId }))
    return { rows, total }
  })

  handleOk(IPC_CHANNELS.shareHubExportLogs, async (_e, q?: ShareLogsQuery) => {
    const repo = hostRepository
    if (!repo) throw new AppError('数据层未就绪，无法导出访问日志')
    const routeIds = q?.toolId?.trim() ? routeIdsOf(q.toolId.trim()) : undefined
    if (routeIds && routeIds.length === 0) return ''
    const query = buildLogQuery(q, routeIds)
    const docs = await repo.list<ShareLogDoc>('shareLogs', query, { at: -1 })
    // 路由 id → 标签/归属 映射（撤销后的路由不在表内，留空）
    const routeMap = new Map(hub.listRoutes().map((r) => [r.id, r]))
    const csvRows = [['时间(北京)', '来源IP', '路径', '状态码', '命中路由ID', '归属工具', '标签']]
    for (const d of docs) {
      const r = routeMap.get(d.routeId)
      csvRows.push([
        format(d.at), // P0-3：北京时间统一格式（禁 toLocale*）
        d.ip, d.path, String(d.status), d.routeId, r?.toolId ?? '', r?.label ?? '',
      ])
    }
    // UTF-8 BOM 防 Excel 中文乱码；字段引号包裹防逗号/换行注入
    const csv = '\ufeff' + csvRows.map((cells) => cells.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    return csv
  })

  handleOk(IPC_CHANNELS.shareHubDeleteLogs, async (_e, ids: string[]) => {
    const repo = hostRepository
    if (!repo) throw new AppError('数据层未就绪，无法删除访问日志')
    const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x) : []
    if (!list.length) return 0
    // 尚未落库的队列记录同步移除，防止删除后又被 flush 写回
    hub.removeQueuedLogs(list)
    return repo.removeWhere('shareLogs', { id: { $in: list } })
  })

  handleOk(IPC_CHANNELS.shareHubClearLogs, async () => {
    const repo = hostRepository
    if (!repo) throw new AppError('数据层未就绪，无法清空访问日志')
    return repo.removeWhere('shareLogs', {})
  })

  // 生命周期控制：宿主「分享服务」tab 使用（action 白名单，防误用）
  handleOk(IPC_CHANNELS.shareHubControl, async (_e, action: 'start' | 'restart' | 'stop' | 'clear') => {
    switch (action) {
      case 'start': return hub.start(host.resolvePort())
      case 'restart': return hub.restart()
      case 'stop': await hub.stop(); return { port: 0 }
      case 'clear': await hub.clear(); return { port: 0 }
      default: throw new AppError(`未知的分享服务操作：${String(action)}`)
    }
  })
}
