/**
 * ShareHub 常驻分享服务宿主封装（plans/09）。
 * - 持有主进程唯一 ShareHub 实例（@sshk/share-core），收敛生命周期：
 *   autoStart 启动 / 固定端口被占回落告警 / powerMonitor.resume 自动重启 / 退出落盘
 * - 旧状态文件（badge-share-state.json / edm-share-state.json）启动检测即静默删除（决策 11）
 * - toolId 记账鉴权：工具只能撤销/续期自己创建的路由，宿主（空 toolId）可管理全部
 */
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { powerMonitor } from 'electron'
import { ShareHub, LEGACY_SHARE_STATE_FILES } from '@sshk/share-core'
import {
  IPC_CHANNELS,
  type ShareRouteInput,
  type HubStatus,
} from '@sshk/shared'
import type { ConfigService } from '@sshk/repository'
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

/** toolId 参数来源：调用方 renderer 自报（网关不做强认证，仅避免误操作别的工具路由；宿主 tab 传 '*' 管理全部）。 */
function resolveToolId(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

export function createShareHubHost(cfg: ConfigService, opts: { userDataDir: string; isDev: boolean }): ShareHubHost {
  const stateFile = join(opts.userDataDir, 'hub-state.json')
  const hub = new ShareHub(stateFile)

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

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    removeLegacyStates()
    applyPreferredIp()
    if (cfg.get('app.shareHub.autoStart') !== false) {
      try { await startHub() } catch (err) {
        logger.error('shareHub', `自动启动失败：${(err as Error).message}`)
      }
    }
    // 配置即时生效：preferredIp 立即换；autoStart 开→启动、关→停止（保留路由）；port 变更→用新端口重启
    cfg.onChanged((ns, key) => {
      if (ns !== 'app' || !key.startsWith('shareHub.')) return
      if (key === 'shareHub.preferredIp') { applyPreferredIp(); return }
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

/** 注册 ShareHub 的 6 条 IPC（6 通道 → create/list/revoke/renew/status/control）。
 *  全部经 handleOk，遵守 check:ipc 门禁。 */
export function registerShareHubIpc(host: ShareHubHost): void {
  const hub = host.hub

  handleOk(IPC_CHANNELS.shareHubCreate, (_e, input: ShareRouteInput) =>
    // 应用级默认（app.shareHub.allowIndex，默认不允许）：弹框未显式指定时在此注入（弹框值优先）
    hub.create({ ...input, allowIndex: input.allowIndex ?? host.getDefaultAllowIndex() }))

  handleOk(IPC_CHANNELS.shareHubList, (_e, toolId?: string) => hub.listRoutes(resolveToolId(toolId) || undefined))

  handleOk(IPC_CHANNELS.shareHubRevoke, (_e, id: string, toolId?: string) => {
    const caller = resolveToolId(toolId)
    if (caller && caller !== '*') {
      const route = hub.listRoutes().find((r) => r.id === id)
      if (!route) return false
      if (route.toolId !== caller) throw new Error('无权撤销其它工具的分享路由')
    }
    return hub.revoke(id)
  })

  handleOk(IPC_CHANNELS.shareHubRenew, (_e, id: string, ttlHours: number | null, toolId?: string, mode?: 'reset' | 'extend', patch?: { allowIndex?: boolean }) => {
    const caller = resolveToolId(toolId)
    if (caller && caller !== '*') {
      const route = hub.listRoutes().find((r) => r.id === id)
      if (!route) throw new Error('分享路由不存在')
      if (route.toolId !== caller) throw new Error('无权续期其它工具的分享路由')
    }
    return hub.renew(id, ttlHours, mode, patch)
  })

  handleOk(IPC_CHANNELS.shareHubStatus, (): HubStatus => hub.status())

  // 生命周期控制：宿主「分享服务」tab 使用（action 白名单，防误用）
  handleOk(IPC_CHANNELS.shareHubControl, async (_e, action: 'start' | 'restart' | 'stop' | 'clear') => {
    switch (action) {
      case 'start': return hub.start(host.resolvePort())
      case 'restart': return hub.restart()
      case 'stop': await hub.stop(); return { port: 0 }
      case 'clear': await hub.clear(); return { port: 0 }
      default: throw new Error(`未知的分享服务操作：${String(action)}`)
    }
  })
}
