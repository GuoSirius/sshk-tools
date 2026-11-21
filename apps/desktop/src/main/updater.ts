// ⚠️ 必须在 import 'electron-updater' 之前求值：electron-updater 构造期缓存 app 版本快照，
// dev 伪装版本号的覆盖必须先发生（详见 update-dev-fake.ts 头注释）。
// P3-1 拆分后 electron-updater 只在本模块导入，update-dev-fake → electron-updater 的求值顺序在本文件内保证。
import { updateDevCheck, resetDevUpdatePendingCache, devUpdateMirrorFeedUrl } from './update-dev-fake'
// electron-updater 是 CJS 模块：ESM 主进程必须默认导入再解构（具名导入运行时报错）
import electronUpdaterPkg from 'electron-updater'

/** 全仓唯一 electron-updater 单例（ipc/update 域与 updater 状态机共用；禁止他处直接 import 'electron-updater'） */
export const { autoUpdater } = electronUpdaterPkg
import { IPC_CHANNELS } from '@sshk/shared'
import { getMainWindow } from './window'
import { logger } from './logger'
import type { AppServices } from './services'

/**
 * 分发包自动更新（P3-1 自 index.ts 拆出）：
 * 主进程持有唯一更新状态，事件触发时推给渲染层（单一真相源，避免重复 toast）。
 * 渲染层据此展示状态指示、进度条与「立即安装」提示，告别一次性 toast。
 * dev 更新接线（update-dev-fake 引用）随本模块迁移。
 */

type UpdatePhase =
  | 'idle' | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'dev' | 'disabled'
interface UpdateState {
  phase: UpdatePhase
  version?: string
  percent?: number
  error?: string
}

let updateState: UpdateState = { phase: 'idle' }
let latestVersion: string | undefined
/** 下载进度日志节流游标：每跨 10% 落一条（download-progress 高频，不逐条刷日志） */
let progressLogMark = 0
/** 下载阶段标记：error 事件无阶段上下文，用它区分「下载失败」与「检查失败」文案（渲染层横幅直接展示） */
let downloadStarted = false
/** P1-3：checkForUpdates 互斥闸门（手动检查 + 启动自动检查共用） */
let updateCheckInFlight = false

export function getUpdateState(): UpdateState {
  return updateState
}

export function pushUpdate(patch: Partial<UpdateState>): void {
  const prevPhase = updateState.phase
  updateState = { ...updateState, ...patch }
  // H3-3 埋点：phase 变化才落盘（download-progress 高频进度不刷日志）
  if (patch.phase && patch.phase !== prevPhase) {
    logger.info('updater', `更新状态 → ${patch.phase}${updateState.version ? ` v${updateState.version}` : ''}${updateState.error ? `：${updateState.error}` : ''}`)
  }
  getMainWindow()?.webContents.send(IPC_CHANNELS.updateState, updateState)
}

/** P1-3：检查互斥闸门（update ipc 域消费）——未占用时占用并返回 true */
export function beginUpdateCheck(): boolean {
  if (updateCheckInFlight) return false
  updateCheckInFlight = true
  return true
}

export function endUpdateCheck(): void {
  updateCheckInFlight = false
}

/** 「下载更新后重启自动安装」开关随配置即时生效（ipc/config.ts onChanged 消费） */
export function applyAutoInstallOnAppQuit(enabled: boolean): void {
  autoUpdater.autoInstallOnAppQuit = enabled
}

/** 给 autoUpdater 挂全生命周期监听，把状态与进度实时推到渲染层 */
function wireAutoUpdater(services: AppServices | null): void {
  // dev 测试模式：electron-updater 默认在非打包环境拒绝工作，必须打开 forceDevUpdateConfig 才会读 GitHub 源
  if (updateDevCheck) (autoUpdater as unknown as { forceDevUpdateConfig: boolean }).forceDevUpdateConfig = true
  // dev 测试镜像源：国内直连 GitHub 下载常「等首字节」挂起（进度永远 0%），设了镜像前缀就切 generic feed 走镜像
  const mirrorFeed = devUpdateMirrorFeedUrl()
  if (mirrorFeed) {
    ;(autoUpdater as unknown as { setFeedURL: (cfg: unknown) => void }).setFeedURL({ provider: 'generic', url: mirrorFeed })
    logger.info('updater', `dev 更新测试：更新源走镜像 → ${mirrorFeed}`)
  }
  autoUpdater.autoDownload = true
  // 复核项 10：「下载更新后重启自动安装」默认关闭，由 app.autoInstallOnAppQuit 控制；
  // dev 测试模式强制关自动安装（用户验收项7：只验下载流程，不执行安装）。
  autoUpdater.autoInstallOnAppQuit = updateDevCheck ? false : Boolean(services?.config.get('app.autoInstallOnAppQuit'))
  autoUpdater.on('checking-for-update', () => {
    progressLogMark = 0
    downloadStarted = false
    pushUpdate({ phase: 'checking', error: undefined })
  })
  autoUpdater.on('update-available', (info: { version: string }) => {
    latestVersion = info.version
    pushUpdate({ phase: 'available', version: info.version, error: undefined })
    // autoDownload=true：update-available 后 electron-updater 立即开下，但首个 download-progress
    // 要等首字节到达——GitHub 直连经常长时间挂起（2026-11-18 实测 available 卡几分钟无进度）。
    // 乐观推 downloading 0%：UI 立刻进入「下载中」，首字节后真实进度覆盖；出错由 error 事件纠正。
    downloadStarted = true
    pushUpdate({ phase: 'downloading', version: info.version, percent: 0, error: undefined })
  })
  autoUpdater.on('update-not-available', (info: { version: string }) => {
    latestVersion = info.version
    pushUpdate({ phase: 'not-available', version: info.version, percent: undefined, error: undefined })
  })
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    const percent = Math.round(p.percent)
    if (!Number.isFinite(percent)) return // 防 NaN 污染进度条（?? 不兜 NaN）
    downloadStarted = true
    pushUpdate({ phase: 'downloading', version: latestVersion, percent, error: undefined })
    // 节流落盘：每 10% 记一条，便于诊断「下载中无进度」类网络问题（GitHub 直连卡顿）
    if (percent - progressLogMark >= 10 || percent === 100) {
      progressLogMark = percent
      logger.info('updater', `下载进度 ${percent}%`)
    }
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    pushUpdate({ phase: 'downloaded', version: info.version, percent: 100, error: undefined })
  })
  autoUpdater.on('error', (err: Error) => {
    console.warn('[sshk] 更新出错：', err)
    // P1-3：error 事件不区分阶段——下载进行中（downloading）的检查类错误不覆盖进度状态，
    // 否则一次后台检查失败会把正在跑的下载进度条踩成 error
    if (updateState.phase === 'downloading' && !downloadStarted) {
      logger.warn('updater', `下载进行中，忽略检查类错误：${err.message}`)
      return
    }
    pushUpdate({ phase: 'error', error: (downloadStarted ? '下载失败：' : '检查失败：') + err.message })
  })
}

export interface AutoUpdateOptions {
  isDev: boolean
  /** SSHK_APP_AUTO_UPDATE=0 / 构建期禁用（index.ts 常量，分发定制场景） */
  autoUpdateDisabled: boolean
}

export function setupAutoUpdate(services: AppServices | null, opts: AutoUpdateOptions): void {
  // SSHK_APP_AUTO_UPDATE=0：自动更新机制整体禁用——不挂监听、不检查，推 disabled 让渲染层隐藏全部更新入口
  if (opts.autoUpdateDisabled) {
    pushUpdate({ phase: 'disabled' })
    return
  }
  if (opts.isDev && !updateDevCheck) return
  if (updateDevCheck) logger.info('updater', 'dev 更新测试模式已启用：连接 GitHub 更新源，下载但绝不安装')
  wireAutoUpdater(services)
  // 尊重「自动更新」开关：关闭则仅在用户手动「检查更新」时检测
  const auto = services?.config.get('app.autoUpdate')
  if (auto !== false) {
    // dev 更新测试：启动自动检查同样先清 pending 缓存（与手动检查口径一致）
    if (updateDevCheck) resetDevUpdatePendingCache()
    // P1-3：与手动检查共用互斥闸门
    if (!beginUpdateCheck()) return
    void autoUpdater.checkForUpdates()
      .then(() => { endUpdateCheck() })
      .catch((err: unknown) => {
        endUpdateCheck()
        console.warn('[sshk] 自动更新检查失败：', err)
        pushUpdate({ phase: 'error', error: (err as Error).message })
      })
  }
}
