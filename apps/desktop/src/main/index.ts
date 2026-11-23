import './env-load'
// ⚠️ './updater' 必须早于一切引入 electron-updater 的模块求值：其内部先 import update-dev-fake
// （版本伪装覆盖）再 import electron-updater（构造期缓存 app 版本快照），顺序见 updater.ts 头注释
import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getEnvBool, now, SSHK_DEV } from '@sshk/shared'
import { setupServices, type AppServices } from './services'
import {
  allManifests,
  assertKnownTool,
  buildCatalog,
  getPluginStatus,
  isElevated,
  isToolActive,
  pickOverrides,
  readProvider,
  readRecord,
  setPluginStatus,
  setupCatalog,
} from './catalog'
import { makeContentListResolver, makeContentResolver, startContentScheduler, stopContentScheduler } from './modules/file/content'
import { compactDatabase } from './compact'
import { registerDevTools } from './dev-tools'
import { reloadManifestFile } from './discovery'
import { seedDefaultProviders } from './provider-seed'
import { installLocalResHandler } from './modules/file/local-res'
import { killUtilityTools } from './plugins'
import { logger } from './logger'
import { purgeExpiredUsageOnStart } from './usage'
import { installAppProtocolHandler, registerPrivilegedSchemes } from './renderer-protocol'
import { createTray, getTray } from './tray'
import { setupAutoUpdate } from './updater'
import { createWindow, getMainWindow, wireWindowLifecycle } from './window'
import { registerAppIpc } from './ipc/app'
import { registerBackupIpc } from './ipc/backup'
import { registerConfigIpc } from './ipc/config'
import type { IpcContext } from './ipc/context'
import { registerFsIpc } from './ipc/fs'
import { registerLlmIpc } from './ipc/llm'
import { registerMiscIpc } from './ipc/misc'
import { registerOsIpc } from './ipc/os'
import { registerRuntimeIpc } from './ipc/runtime'
import { registerToolsIpc } from './ipc/tools'
import { registerUpdateIpc } from './ipc/update'
import { registerUploadIpc } from './ipc/upload'
import type { FsRuntime } from './modules/file/runtime'
import { createShareHubHost, isKnownShareOwner, registerShareHubIpc, type ShareHubGuards, type ShareHubHost } from './modules/share/share-hub'

/** 必须在 app ready 前注册：localres:// 预览协议 + app:// 渲染层加载协议（特权一次性注册） */
registerPrivilegedSchemes()

const here = path.dirname(fileURLToPath(import.meta.url))

// dev 判据唯一化（P0-1 · D55）：全仓只认构建期注入的 __SSHK_DEV__（含 preview，终审 C-1）；
// 「是否源码仓库」的判定在 dev-tools.ts 的 findRepoRoot()，两者概念分离（D-4）。
const isDev = SSHK_DEV
/** 分发包自动更新总开关：SSHK_APP_AUTO_UPDATE=0/false 显式关闭——顶栏按钮不显示、更新流程完全不走（默认开启）。
 *  用于内网/定制分发场景：即使包里带着更新源配置，也不会发起任何网络检查。
 *  打包版没有 .env（env-load 静默跳过），构建期走 __SSHK_AUTO_UPDATE_DISABLED__ define +
 *  __SSHK_BAKED_ENV__ 烤入双保险，任一生效即禁用；.env 声明的键默认不允许本机 env 覆盖（baked-env）。 */
const autoUpdateDisabled = __SSHK_AUTO_UPDATE_DISABLED__ || !getEnvBool('SSHK_APP_AUTO_UPDATE', true)

let services: AppServices | null = null
/** ShareHub 常驻分享服务单例（plans/09）：whenReady 初始化，退出前停止落盘 */
let shareHubHost: ShareHubHost | null = null
/** P1-5：分享通道硬鉴权守卫（whenReady 装配，registerShareHubIpc 消费） */
let shareHubGuards: ShareHubGuards | undefined
/** plans/10：传输队列运行时引用（ipc/fs 创建后回写；before-quit 落盘用） */
let fsRuntimeRef: FsRuntime | null = null

/** 退出清理（window.ts before-quit 回调，await 完成后才真正退出）：沙箱回收/分享服务落盘/NeDB 压缩/传输队列落盘 */
async function onBeforeQuit(): Promise<void> {
  // 退出前回收所有 utilityProcess 沙箱（外部包 main 子进程）
  killUtilityTools()
  // 定时发布轮询停止（F-01：定时器纳入 app 生命周期）
  stopContentScheduler()
  // ShareHub：停止监听 + 未过期路由落盘（plans/09）。2026-11-22 复核：await 落盘完成再退出，
  // 此前 fire-and-forget 可能被退出中断丢最后 ≤500ms 状态
  if (shareHubHost) await shareHubHost.dispose()
  // H6：退出兜底压缩（fire-and-forget；NeDB compact 原子替换，中断安全）
  void compactDatabase(services, 'quit')
  // plans/10：传输队列同步落盘（未完结 upload/download 持久化，重启恢复为 paused）
  try { fsRuntimeRef?.flushTransferPersist() } catch { /* 忽略 */ }
}

// quit/close 生命周期事件随 window.ts 迁移（before-quit / window-all-closed，注册一次）
wireWindowLifecycle({ onBeforeQuit })

const windowDeps = {
  isDev,
  // 「关闭时最小化到托盘」：配置开启且托盘可用才隐藏，否则回落二次确认（window.ts close 链路）
  hideToTrayOnClose: (): boolean => services?.config.get('app.closeToTray') === true && Boolean(getTray()),
  onBeforeQuit,
}

/** registerIpc 装配：handler 按域拆分到 ipc/ 目录（P3-1 · B14/B20/O2），此处只做组装编排 */
async function registerIpc(): Promise<void> {
  const ctx: IpcContext = {
    services: services!,
    isDev,
    autoUpdateDisabled,
    getMainWindow,
    allManifests,
    buildCatalog,
    isToolActive,
    assertKnownTool,
    readProvider,
    readRecord,
    pickOverrides,
    isElevated,
    getPluginStatus,
    setPluginStatus,
    setFsRuntime: (rt) => { fsRuntimeRef = rt },
  }

  // ── 开发者工具：仅源码开发环境注册（打包版自动禁用）──
  registerDevTools((file) => {
    // 开发者改完 manifest 写盘后：原地重载内存清单 → 重建目录随响应返回渲染层刷新
    if (!reloadManifestFile(file)) return undefined
    return buildCatalog()
  })
  registerConfigIpc(ctx)
  // ── ShareHub 常驻分享服务（plans/09；plans/12 日志持久化）：通道注册，单例由 whenReady 初始化 ──
  if (shareHubHost) registerShareHubIpc(shareHubHost, services?.repository, shareHubGuards)
  registerAppIpc(ctx)
  registerToolsIpc(ctx)
  registerBackupIpc(ctx)
  registerRuntimeIpc(ctx)
  registerUpdateIpc(ctx)
  registerLlmIpc(ctx)
  registerUploadIpc(ctx)
  registerFsIpc(ctx)
  registerOsIpc(ctx)
  await registerMiscIpc(ctx)
}

void app.whenReady().then(async () => {
  services = setupServices()
  setupCatalog(services)
  // F-01（2026-11-22 复核）：启动即拉起定时发布轮询——扫描所有到期 scheduled 一次性翻 published，
  // 此前仅保存定时内容时启动，重启后定时任务永久失效（静默不发布）
  startContentScheduler(services.repository)
  // 2026-11-22 复核：用量明细「保留 90 天」此前仅手动清理兑现，启动时补齐过期清理
  purgeExpiredUsageOnStart(services.repository)
  installLocalResHandler(services.config)
  // app:// 渲染层静态文件服务（打包版 / dev 显式开启时替代 loadFile 的 file://）
  installAppProtocolHandler(path.join(here, '../renderer'))
  // ShareHub 常驻分享服务（plans/09）：单例创建 + 自动启动 + 旧状态文件清理 + powerMonitor
  shareHubHost = createShareHubHost(services.config, {
    userDataDir: app.getPath('userData'),
    isDev,
    // 内容 resolver 由宿主注入：core 不依赖 repository，读库回调在此提供（plans/11 方案 B/C）
    contentResolver: makeContentResolver(services.repository),
    contentListResolver: makeContentListResolver(services.repository),
  })
  // P1-5（A15/Q-13）：分享硬鉴权守卫——sender 绑定主窗口 + toolId 在册校验。
  // P4-8b：在册口径扩为「纯工具 manifest ∪ 内置模块 id ∪ 旧 id」——三基础模块并入应用本体后
  // 不在 MANIFESTS，但其页面以模块 id 建路由、存量数据可能带旧 id（口径见 share-hub.ts 头注释）
  shareHubGuards = {
    isTrustedSender: (sender) => Boolean(sender) && sender === getMainWindow()?.webContents,
    isKnownTool: (id) => isKnownShareOwner(id, allManifests()),
  }
  await shareHubHost.init()
  seedDefaultProviders(services)
  await registerIpc()
  // H3 日志：启动清理过期文件 + 记录启动事件
  const removedLogs = logger.clean()
  if (removedLogs > 0) logger.info('app', `已清理 ${removedLogs} 个过期日志文件`)
  logger.info('app', `应用启动 v${app.getVersion()}（${SSHK_DEV ? 'dev（含 preview）' : 'packaged'}）`)
  // H6 NeDB 防膨胀：每日首次启动全量压缩一次；超阈(>10MB)文件无论何时启动都压缩
  const today = now().slice(0, 10)
  if (services.config.get('app.lastCompactAt') !== today) {
    services.config.set('app.lastCompactAt', today)
    void compactDatabase(services, 'daily')
  } else {
    void compactDatabase(services, 'startup')
  }
  // 应用内自绘标题栏与工具栏，去掉系统默认菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null)
  createTray()
  createWindow(windowDeps)
  setupAutoUpdate(services, { isDev, autoUpdateDisabled })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(windowDeps)
  })
})

// H3：主进程兜底异常落盘（不改变退出行为）
process.on('uncaughtException', (err) => {
  logger.error('process', `uncaughtException：${err.message}`, err.stack)
})
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  logger.error('process', `unhandledRejection：${err.message}`, err.stack)
})
