import './env-load'
// ⚠️ 必须在 import 'electron-updater' 之前求值：electron-updater 构造期缓存 app 版本快照，
// dev 伪装版本号的覆盖必须先发生（详见 update-dev-fake.ts 头注释）
import { updateDevCheck, resetDevUpdatePendingCache, devUpdateMirrorFeedUrl } from './update-dev-fake'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, Tray, Menu } from 'electron'
// electron-updater 是 CJS 模块：ESM 主进程必须默认导入再解构（具名导入运行时报错）
import electronUpdaterPkg from 'electron-updater'
const { autoUpdater } = electronUpdaterPkg
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path, { join } from 'node:path'
import {
  ACCESS_GRANT,
  IPC_CHANNELS,
  collectDefaultProviders,
  resolveToolCatalog,
  shouldSeedDefaultProviders,
  type ToolCatalogPayload,
  type ToolDescriptor,
  type ToolOverrides,
  type ToolPluginStatus,
  now,
  getEnvBool,
} from '@sshk/shared'
import { chatWithFallback, healthCheck, listModels, type LlmProvider } from '@sshk/llm-gateway'
import { setupServices, type AppServices } from './services'
import { handleOk } from './ipc-wrap'
import { logger } from './logger'
import { collectDiagnostics, exportDiagnosisZip } from './diagnostics'
import { collectToolHealth, toolRecentErrors } from './health'
import { findRepoRoot, listSessions, loadSession, resolveSessionsDir, runAutoCheck, saveSession } from './verify-sessions'
import type { VerifySession } from '@sshk/shared'
import { exportPreset, importPreset, type PresetSecretStore } from './presets'
import { recordUsage, collectUsageStats, clearUsage } from './usage'
import { exportBackup } from '@sshk/backup'
import { importBackup } from '@sshk/backup'
import { installPackage, listInstalled, loadRuntimeManifests, previewInstall, readRenderer, uninstallPackage } from './runtime-installer'
import { defaultConfigPath, listSnapshots, restoreSnapshot, clearSnapshots } from '@sshk/repository'
import { loadToolPlugins, killUtilityTools } from './plugins'
import { MANIFESTS, reloadManifestFile, PULLED_IN_TOOLS } from './discovery'
import { registerDevTools } from './dev-tools'
import { UploadRuntime, type UploadListRequest, type UploadRequest, type UploadTestRequest } from './upload'
import { FsRuntime } from './fs'
import { installLocalResHandler } from './local-res'
import { APP_RENDERER_URL, installAppProtocolHandler, registerPrivilegedSchemes } from './renderer-protocol'
import { allowWindowDrop } from './win32-drop'
import { createShareHubHost, registerShareHubIpc, type ShareHubHost } from './share-hub'

/** 必须在 app ready 前注册：localres:// 预览协议 + app:// 渲染层加载协议（特权一次性注册） */
registerPrivilegedSchemes()
import { devtoolsKeyMatches, isDevOpAuthorized, markDevOpAuthorized, type DevKeyOperation } from './dev-access'

const here = path.dirname(fileURLToPath(import.meta.url))
const preloadScript = path.join(here, '../preload/index.cjs')
const iconFile = path.join(here, '../../build/icon.png')
const trayIconFile = path.join(here, '../../build/tray.png')

const isDev = !app.isPackaged
/** dev 更新测试开关与版本号伪装统一收敛在 ./update-dev-fake（必须在 electron-updater import 前求值，见其头注释）。
 *  版本号伪装：SSHK_DEV_UPDATE_FAKE_VERSION=1.1.0 覆盖 app.getVersion()，updater 据此判定有新版；
 *  不设则读 package.json —— 老办法是本地把 version 改旧，dev 启动复现后改回。 */
/** 分发包自动更新总开关：SSHK_APP_AUTO_UPDATE=0/false 显式关闭——顶栏按钮不显示、更新流程完全不走（默认开启）。
 *  用于内网/定制分发场景：即使包里带着更新源配置，也不会发起任何网络检查。
 *  打包版没有 .env（env-load 静默跳过），构建期走 __SSHK_AUTO_UPDATE_DISABLED__ define +
 *  __SSHK_BAKED_ENV__ 烤入双保险，任一生效即禁用；.env 声明的键默认不允许本机 env 覆盖（baked-env）。 */
const autoUpdateDisabled = __SSHK_AUTO_UPDATE_DISABLED__ || !getEnvBool('SSHK_APP_AUTO_UPDATE', true)
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let services: AppServices | null = null
/** 退出中标志：关闭确认通过后由渲染层回调置位，放行 before-quit / close 链路 */
let quitting = false
/** 开发者模式提权闸门（2026-11-17 起走 dev-access 按操作缓存：isDevOpAuthorized('developerMode')） */
/** 插件加载结果：单个插件失败不影响宿主与其它工具 */
let pluginStatus: Record<string, ToolPluginStatus> = {}
/** ShareHub 常驻分享服务单例（plans/09）：whenReady 初始化，退出前停止落盘 */
let shareHubHost: ShareHubHost | null = null
/** plans/10：传输队列运行时引用（registerIpc 内创建；before-quit 落盘用） */
let fsRuntimeRef: FsRuntime | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    icon: iconFile,
    show: false,
    backgroundColor: '#0B0E1C',
    webPreferences: {
      preload: preloadScript,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 浏览器式刷新：F5 / Ctrl(Cmd)+R 普通刷新，Shift 或 Ctrl+F5 忽略缓存
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const mod = input.control || input.meta
    if (key !== 'f5' && !(mod && key === 'r')) return
    event.preventDefault()
    const force = input.shift || (input.control && key === 'f5')
    if (force) mainWindow?.webContents.reloadIgnoringCache()
    else mainWindow?.webContents.reload()
  })

  // 渲染层 console 落盘（warn/error）：打包版排查「高亮丢失 / 弹框异常」等只有现场才有的问题时，
  // 不再依赖用户开 DevTools——日志文件里直接看渲染层报错（console-message Electron 35+ 为 detail 对象，兼容旧签名）
  mainWindow.webContents.on('console-message', (_event, ...args: unknown[]) => {
    const detail = args[0] as { level?: number | string; message?: string } | number
    const level = typeof detail === 'object' ? (detail.level ?? 0) : (detail as number)
    const message = typeof detail === 'object' ? (detail.message ?? '') : String(args[1] ?? '')
    if (typeof level === 'number' && level >= 2 && message) {
      logger.warn('renderer', `[console] ${message}`)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 管理员模式拖放放行：应用清单强制 requireAdministrator，UIPI 会拦截 Explorer 的拖入消息；
    // 对窗口放行 WM_DROPFILES / WM_COPYGLOBALDATA 后普通权限资源管理器可拖文件进窗口（非 Windows 静默跳过）
    void allowWindowDrop(mainWindow)
    if (isDev) mainWindow?.webContents.openDevTools()
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // 关闭二次确认（防误触退出）：dev 不拦截；确认后置 quitting 放行 before-quit 链路。
  // 关闭动作通知渲染层，使用与主题色匹配的 ElMessageBox 确认（原生 dialog 与主题不搭）。
  app.on('before-quit', () => {
    quitting = true
    // 退出前回收所有 utilityProcess 沙箱（外部包 main 子进程）
    killUtilityTools()
    // ShareHub：停止监听 + 未过期路由落盘（plans/09）
    if (shareHubHost) void shareHubHost.dispose()
    // H6：退出兜底压缩（fire-and-forget；NeDB compact 原子替换，中断安全）
    void compactDatabase('quit')
    // plans/10：传输队列同步落盘（未完结 upload/download 持久化，重启恢复为 paused）
    try { fsRuntimeRef?.flushTransferPersist() } catch { /* 忽略 */ }
  })
  mainWindow.on('close', (event) => {
    if (quitting || isDev) return
    event.preventDefault()
    // 「关闭时最小化到托盘」开启（用户 2026-11-18）：点关闭 = 隐藏到托盘不退出；
    // 托盘不可用（设置里关了系统托盘/创建失败）时回落二次确认退出，避免窗口藏起来找不到
    if (services?.config.get('app.closeToTray') === true && tray) {
      mainWindow!.hide()
      return
    }
    // 交给渲染层弹出主题色确认框；用户确认后渲染层回调 app:confirmClose 真正退出
    mainWindow!.webContents.send(IPC_CHANNELS.appRequestClose)
  })

  // 加载通道统一（用户 2026-11-18 拍板）：打包版一律 app://（file:// 是 opaque origin，
  // fetch/CORS/Worker/动态 chunk 行为与 dev http 不一致，是 dev/打包差异的温床）；
  // dev 默认走 dev server http，SSHK_DEV_APP_PROTOCOL=1 时也走 app:// 便于同协议排查。
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const devUseApp = isDev && getEnvBool('SSHK_DEV_APP_PROTOCOL', false)
  if (isDev && devUrl && !devUseApp) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadURL(APP_RENDERER_URL)
}

function createTray(): void {
  try {
    tray = new Tray(trayIconFile)
    tray.setToolTip('sshk-tools')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主界面', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ]))
    tray.on('click', () => mainWindow?.show())
  } catch (err) {
    console.warn('[sshk] 托盘图标暂不可用：', err)
  }
}

function readProvider(_event: unknown, provider: LlmProvider): LlmProvider {
  if (!/^https?:\/\//i.test(provider?.baseURL ?? '')) {
    throw new Error('baseURL 必须是 http(s) 地址')
  }
  return provider
}

/** 构建期内置清单 + 运行时已安装包清单，统一参与目录裁决。
 *  同 id 冲突一律 tools/ 源码优先、安装副本仅补位：内建工具不可被外部安装覆盖（既定规则），
 *  dev 迭代已安装的外部包时也因此始终消费源码、实时生效（安装记录保留但不消费）。 */
function allManifests(): ToolDescriptor[] {
  const runtime = loadRuntimeManifests({ userDataDir: app.getPath('userData'), importedKeys: [] })
  for (const problem of runtime.problems) console.warn('[sshk] 运行时工具包：', problem)
  const builtinIds = new Set(MANIFESTS.map((m) => m.id))
  return [...MANIFESTS, ...runtime.manifests.filter((m) => !builtinIds.has(m.id))]
}

function assertKnownTool(id: string): void {
  if (!allManifests().some((tool) => tool.id === id)) throw new Error(`未知工具: ${id}`)
}

/** Windows 是否提权运行：net session 仅管理员可成功（结果缓存，权限不会中途变化） */
let elevatedCache: boolean | null = null
function isElevated(): boolean {
  if (process.platform !== 'win32') return false
  if (elevatedCache === null) {
    try { execSync('net session', { stdio: 'ignore' }); elevatedCache = true } catch { elevatedCache = false }
  }
  return elevatedCache
}

function readRecord<T>(key: string): Record<string, T> {
  const raw = services!.config.get(key)
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, T>
    : {}
}

/** 只接受白名单字段，避免渲染层写入任意配置段 */
function pickOverrides(raw: unknown): ToolOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('非法工具元数据')
  const out: ToolOverrides = {}
  for (const key of ['name', 'description', 'icon'] as const) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string') out[key] = value.slice(0, 500)
  }
  const category = (raw as Record<string, unknown>)['category']
  if (typeof category === 'string') out.category = category.slice(0, 500)
  else if (Array.isArray(category)) {
    out.category = category
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, 100))
      .slice(0, 20)
  }
  return out
}

/**
 * 工具目录单一裁决：构建期发现的清单 + 配置覆盖 + 分发 + 插件可用性 + 权限 + 依赖链。
 * 渲染层只能拿到裁决结果，拿不到密钥明文，也无法自行放开受限工具。
 */
function buildCatalog(): ToolCatalogPayload {
  const cfg = services!.config
  const manifests = allManifests()
  const enabled: Record<string, boolean> = {}
  const grants: Record<string, string> = {}
  const dependsOn: Record<string, string[]> = {}
  for (const tool of manifests) {
    const value = cfg.get(`tools.${tool.id}.enabled`)
    enabled[tool.id] = typeof value === 'boolean' ? value : tool.enabled
    grants[tool.id] = String(cfg.get(`tools.${tool.id}.requiredGrant`) ?? '')
    const rawDeps = cfg.get(`tools.${tool.id}.dependsOn`)
    dependsOn[tool.id] = Array.isArray(rawDeps)
      ? rawDeps.filter((id): id is string =>
        typeof id === 'string' && id !== tool.id && manifests.some((t) => t.id === id))
      : (tool.dependsOn ?? [])
  }
  const rawInclude = cfg.get('app.distribution.includeTools')
  const includeTools = Array.isArray(rawInclude)
    ? rawInclude.filter((id): id is string => typeof id === 'string' && manifests.some((t) => t.id === id))
    : null
  const { hasAccessKey, grants: heldGrants } = services!.getAccessKeyState()
  return resolveToolCatalog(manifests, {
    enabled,
    grants,
    dependsOn,
    overrides: readRecord<ToolOverrides>('app.toolOverrides'),
    includeTools,
    heldGrants,
    settingsToolIds: cfg.listToolIds(),
    pluginStatus,
    // X5-A 依赖闭包拉入的工具：能力保留但任何位置强制不可见（用户 2026-11-17 定稿）
    forcedHidden: PULLED_IN_TOOLS,
    hasAccessKey,
  })
}

function isToolActive(id: string): boolean {
  return buildCatalog().tools.find((tool) => tool.id === id)?.visible === true
}

/**
 * 默认 Provider 只播种一次：公开端点与模型名来自工具包 manifest，宿主不硬编码厂商。
 * 密钥不播种，由用户在「模型控制台」填一次；用户删空后重启也不会复活。
 */
function seedDefaultProviders(): void {
  const cfg = services!.config
  const seeds = collectDefaultProviders(MANIFESTS)
  if (!seeds.length) return
  if (!shouldSeedDefaultProviders(cfg.get('app.llm.providersSeeded'), cfg.get('app.llm.providers'))) return
  cfg.set('app.llm.providers', seeds)
  cfg.set('app.llm.activeProviderId', seeds.find((p) => p.enabled)?._id ?? null)
  cfg.set('app.llm.providersSeeded', true)
}

/** 一次性迁移：旧 vision.baseURL/model 已不再被读取，匹配到 Provider 则转为 providerId/modelOverride */
function migrateLegacyVisionConfig(): void {
  const cfg = services!.config
  const raw = cfg.get('tools.badge-studio.vision')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const vision = { ...(raw as Record<string, unknown>) }
  const legacyURL = typeof vision['baseURL'] === 'string' ? (vision['baseURL'] as string) : ''
  const legacyModel = typeof vision['model'] === 'string' ? (vision['model'] as string) : ''
  if (!legacyURL && !legacyModel) return
  const providers = Array.isArray(cfg.get('app.llm.providers'))
    ? (cfg.get('app.llm.providers') as { _id: string; baseURL: string }[])
    : []
  const matched = providers.find((p) => p.baseURL === legacyURL)
  delete vision['baseURL']
  delete vision['model']
  if (matched && !vision['providerId']) vision['providerId'] = matched._id
  if (legacyModel && !vision['modelOverride']) vision['modelOverride'] = legacyModel
  cfg.set('tools.badge-studio.vision', vision)
}

/** D18：备份口令「填了就生效」（2026-11-17 用户验收项1：删除 SSHK_TOOLS_ALLOW_SECRET_MIGRATION env 门控——
 *  预设导出已提供「包含密钥」UI 开关，备份沿用同一自然语义：填口令=加密携带密钥，留空=不迁移） */

/** H6 NeDB 防膨胀：超阈集合按需压缩 + 全量压缩；失败只告警，绝不影响使用 */
async function compactDatabase(reason: 'daily' | 'startup' | 'quit'): Promise<void> {
  const repo = services?.repository
  if (!repo) return
  const started = Date.now()
  try {
    const bulky = await repo.compactIfBulky()
    await repo.compact()
    console.log(`[sshk] NeDB 压缩完成（${reason}${bulky.length > 0 ? ` · 超阈集合：${bulky.join('、')}` : ''} · ${Date.now() - started}ms）`)
  } catch (err) {
    console.warn(`[sshk] NeDB 压缩失败（${reason}，不影响使用）：`, err)
  }
}

async function registerIpc(): Promise<void> {
  const cfg = services!.config

  // ── 开发者工具：仅源码开发环境注册（打包版自动禁用）──
  registerDevTools((file) => {
    // 开发者改完 manifest 写盘后：原地重载内存清单 → 重建目录随响应返回渲染层刷新
    if (!reloadManifestFile(file)) return undefined
    return buildCatalog()
  })

  // ── 配置 ──
  handleOk(IPC_CHANNELS.configGet, (_event, key: string) => cfg.get(key) ?? null)
  handleOk(IPC_CHANNELS.configSet, (_event, key: string, value: unknown) => {
    // 打包版「关 → 开」开发者模式必须先在本会话通过访问密钥校验；
    // 已是开启状态再保存、或关闭，都不需要口令，避免误伤正常配置保存。
    if (key === 'app.developerMode' && value === true && !isDev &&
        !Boolean(cfg.get('app.developerMode')) && !isDevOpAuthorized('developerMode')) {
      throw new Error('开启开发者模式需要先通过访问密钥验证')
    }
    cfg.set(key, value)
    return true
  })
  cfg.onChanged((namespace, key) => {
    if (namespace === 'app' && key === 'themeMode') {
      const mode = cfg.get('app.themeMode')
      nativeTheme.themeSource = mode === 'system' ? 'system' : mode === 'light' ? 'light' : 'dark'
    }
    // 开关改动即时生效，不必重启应用
    if (namespace === 'app' && key === 'autoInstallOnAppQuit') {
      autoUpdater.autoInstallOnAppQuit = Boolean(cfg.get('app.autoInstallOnAppQuit'))
    }
    mainWindow?.webContents.send(IPC_CHANNELS.configChanged, { namespace, key })
  })
  const themeMode = cfg.get('app.themeMode')
  nativeTheme.themeSource = themeMode === 'system' ? 'system' : themeMode === 'light' ? 'light' : 'dark'

  // ── ShareHub 常驻分享服务（plans/09）：6 通道，单例由 whenReady 初始化 ──
  if (shareHubHost) registerShareHubIpc(shareHubHost)

  handleOk(IPC_CHANNELS.appVersion, () => app.getVersion())
  // 关于页运行环境信息（__APP_COMMIT__ 由 electron-vite define 注入，打包/dev 一致）
  handleOk(IPC_CHANNELS.appRuntime, () => ({
    version: app.getVersion(),
    commit: String(__APP_COMMIT__ ?? 'dev'),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  }))
  handleOk(IPC_CHANNELS.appOpenDataDir, () => shell.openPath(app.getPath('userData')))
  handleOk(IPC_CHANNELS.appReload, (_event, force?: boolean) => {
    const wc = mainWindow?.webContents
    if (!wc) return false
    if (force) wc.reloadIgnoringCache()
    else wc.reload()
    return true
  })
  // 渲染层确认关闭后回到主进程：置 quitting 并真正退出（close 链路见上）
  handleOk(IPC_CHANNELS.appConfirmClose, () => {
    quitting = true
    app.quit()
    return true
  })
  // 开发者工具：会话内按操作缓存密钥（项9）——有效期内再开不重输；与「开发者模式」各自独立。
  // 打包版密钥优先级：settings.json 显式哈希 > env SSHK_APP_DEVTOOLS_KEY > 内置 sshk-tools@888
  handleOk(IPC_CHANNELS.appToggleDevTools, (_event, key?: string) => {
    if (isDev) { mainWindow?.webContents.toggleDevTools(); return true }
    if (!isDevOpAuthorized('devtools')) {
      if (!devtoolsKeyMatches(String(cfg.get('app.devtoolsKeyHash') ?? ''), String(key ?? ''))) {
        throw new Error('访问密钥不正确')
      }
      markDevOpAuthorized('devtools')
    }
    mainWindow?.webContents.toggleDevTools()
    return true
  })
  // 开发者模式等敏感开关：只校验口令不打开 DevTools；按操作独立缓存，互不复用
  handleOk(IPC_CHANNELS.appVerifyDevtoolsKey, (_event, key?: string, operation?: DevKeyOperation) => {
    const op: DevKeyOperation = operation === 'devtools' ? 'devtools' : 'developerMode'
    if (isDevOpAuthorized(op)) return true
    if (isDev) { markDevOpAuthorized(op); return true }
    if (!devtoolsKeyMatches(String(cfg.get('app.devtoolsKeyHash') ?? ''), String(key ?? ''))) {
      throw new Error('访问密钥不正确')
    }
    markDevOpAuthorized(op)
    return true
  })

  // ── 工具目录（启用 / 权限 / 依赖 / 分发 / 元数据覆盖） ──
  handleOk(IPC_CHANNELS.toolsList, () => buildCatalog())
  handleOk(IPC_CHANNELS.toolsSetEnabled, (_event, id: string, enabled: boolean) => {
    assertKnownTool(id)
    cfg.set(`tools.${id}.enabled`, Boolean(enabled))
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetGrant, (_event, id: string, grant: string) => {
    assertKnownTool(id)
    if (grant && grant !== ACCESS_GRANT) throw new Error(`未知权限要求: ${grant}`)
    cfg.set(`tools.${id}.requiredGrant`, grant || '')
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetDependencies, (_event, id: string, raw: unknown) => {
    assertKnownTool(id)
    if (!Array.isArray(raw)) throw new Error('依赖必须是工具 id 数组')
    const ids = Array.from(new Set(raw.filter((dep): dep is string =>
      typeof dep === 'string' && dep !== id && MANIFESTS.some((t) => t.id === dep))))
    cfg.set(`tools.${id}.dependsOn`, ids)
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetOverrides, (_event, id: string, raw: unknown) => {
    assertKnownTool(id)
    const all = readRecord<ToolOverrides>('app.toolOverrides')
    all[id] = pickOverrides(raw)
    cfg.set('app.toolOverrides', all)
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetDistribution, (_event, raw: unknown) => {
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string' && allManifests().some((t) => t.id === id))
      : null
    cfg.set('app.distribution.includeTools', ids)
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsCleanupOrphans, () => {
    for (const id of buildCatalog().orphans) cfg.remove(`tools.${id}`)
    return buildCatalog()
  })
  handleOk(IPC_CHANNELS.accessKeySet, (_event, key: string) => {
    services!.setAccessKey(String(key ?? ''))
    return buildCatalog()
  })

  // ── 备份：settings + NeDB + 产物 → zip；导入含快照回滚 ──
  handleOk(IPC_CHANNELS.backupExport, async (_event, zipPath: string, passphrase?: string) => {
    const out = String(zipPath ?? '')
    if (!out) throw new Error('缺少导出路径')
    const manifest = await exportBackup({
      repository: services!.repository,
      settings: services!.config.snapshot() as unknown as Record<string, unknown>,
      outputRoot: services!.outputRoot,
      outZipPath: out,
      appVersion: app.getVersion(),
      secretsJson: services!.exportSecretsJson(),
      migrationPassphrase: passphrase || undefined,
    })
    return { counts: manifest.counts, file: out }
  })
  handleOk(IPC_CHANNELS.backupImport, async (_event, zipPath: string, passphrase?: string) => {
    const file = String(zipPath ?? '')
    if (!file) throw new Error('缺少导入文件')
    const dbDir = services!.dbDir
    const result = await importBackup({
      repository: services!.repository,
      zipPath: file,
      outputRoot: services!.outputRoot,
      snapshotDir: join(services!.outputRoot, '.tmp', 'import', 'pre-import-backup'),
      dbDir,
      settingsPath: defaultConfigPath(app.getPath('userData')),
      migrationPassphrase: passphrase || undefined,
    })
    if (result.secretsJson) services!.importSecretsJson(result.secretsJson)
    return { counts: result.manifest.counts, secretsRestored: result.secretsRestored, secretsMessage: result.secretsMessage }
  })

  // ── 运行时工具包：.sshktool 导入 / 列表 / 卸载（用户经由文件选择器提供路径） ──
  // 内置工具 id 集合：用于拦截「内建已分发又装同名外部包」的冲突（D-C）
  const builtinToolIds = (): string[] => {
    try {
      const toolsDir = join(app.getAppPath(), 'tools')
      return readdirSync(toolsDir).filter((name) => statSync(join(toolsDir, name)).isDirectory())
    } catch {
      return []
    }
  }
  const runtimeDeps = () => ({ userDataDir: app.getPath('userData'), importedKeys: (cfg.get('app.runtime.publicKeys') ?? []) as never[] })
  handleOk(IPC_CHANNELS.runtimePreview, (_event, zipPath: string) => {
    const path = String(zipPath ?? '')
    if (!/\.sshktool$/i.test(path)) throw new Error('仅支持 .sshktool 包')
    return previewInstall(path, runtimeDeps(), { builtinIds: builtinToolIds() })
  })
  handleOk(IPC_CHANNELS.runtimeInstall, (_event, zipPath: string, explicitlyTrusted?: boolean) => {
    const path = String(zipPath ?? '')
    if (!/\.sshktool$/i.test(path)) throw new Error('仅支持 .sshktool 包')
    const result = installPackage(path, runtimeDeps(), { explicitlyTrusted, builtinIds: builtinToolIds() })
    return { record: result.record, warnings: result.warnings }
  })
  handleOk(IPC_CHANNELS.runtimeList, () => listInstalled(runtimeDeps()))
  handleOk(IPC_CHANNELS.runtimeUninstall, (_event, id: string) => uninstallPackage(String(id ?? ''), runtimeDeps()))
  handleOk(IPC_CHANNELS.runtimeReadRenderer, (_event, id: string) => readRenderer(String(id ?? ''), runtimeDeps()))
  // ── 运行时公钥管理：导入（PEM 校验 + 指纹 keyId）/ 列表 / 撤销 ──
  const keyFingerprint = (pem: string) => createHash('sha256').update(pem.trim()).digest('hex').slice(0, 12)
  handleOk(IPC_CHANNELS.runtimeKeysList, () => cfg.get('app.runtime.publicKeys') ?? [])
  handleOk(IPC_CHANNELS.runtimeKeysImport, (_event, label: string, pem: string) => {
    const clean = String(pem ?? '').trim()
    if (!clean.startsWith('-----BEGIN')) throw new Error('不是有效的 PEM 公钥')
    try { createPublicKey(clean) } catch { throw new Error('PEM 公钥解析失败，请检查内容') }
    const entry = { keyId: 'pk_' + keyFingerprint(clean), label: String(label || '未命名发布者'), pem: clean, importedAt: now() }
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    if (keys.some((k) => k.keyId === entry.keyId)) throw new Error('该公钥已导入')
    cfg.set('app.runtime.publicKeys', [...keys, entry])
    return entry
  })
  handleOk(IPC_CHANNELS.runtimeKeysRevoke, (_event, keyId: string) => {
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    cfg.set('app.runtime.publicKeys', keys.filter((k) => k.keyId !== String(keyId ?? '')))
    return true
  })

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.themeSystemChanged)
  })

  // ── 更新 ──
  // autoUpdater 全生命周期状态：检查 → 发现 → 下载进度 → 完成 → 失败，统一推给渲染层。
  // 渲染层据此展示状态指示、进度条与「立即安装」提示，告别一次性 toast。
  handleOk(IPC_CHANNELS.updateGetState, () => updateState)
  handleOk(IPC_CHANNELS.updateCheck, async () => {
    if (autoUpdateDisabled) { pushUpdate({ phase: 'disabled' }); return { disabled: true } }
    if (isDev && !updateDevCheck) { pushUpdate({ phase: 'dev' }); return { dev: true } }
    // dev 更新测试：每次检查前清 pending 缓存 → 每次都重新下载，进度条可反复观察（KEEP_CACHE=1 保留）
    if (updateDevCheck) resetDevUpdatePendingCache()
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version ?? null
      // electron-updater 已按 semver 判定（含降级拦截）：装机 1.3.0 vs 线上 1.2.0 → false。
      // 此前这里用字符串不等号自判（「1.2.0」!==「1.3.0」→ true），装了最新版仍误报「发现新版本
      // 并已开始下载」，而内核实为 not-available → 按钮状态与进度都不动（2026-11-18 用户实测事故）
      const updateAvailable = result?.isUpdateAvailable === true
      return { dev: false, updateAvailable, version }
    } catch (err) {
      return { error: (err as Error).message }
    }
  })
  handleOk(IPC_CHANNELS.updateDownload, async () => {
    if (autoUpdateDisabled) return false
    if (isDev && !updateDevCheck) return false
    await autoUpdater.downloadUpdate()
    return true
  })
  handleOk(IPC_CHANNELS.updateQuitAndInstall, () => {
    if (autoUpdateDisabled) return { dev: false }
    if (updateDevCheck) {
      // dev 测试：只验证下载流程，绝不真装（否则会替换掉正在开发的 install 目录）
      logger.info('updater', 'dev 更新测试模式：拦截安装，仅下载不落盘安装')
      return { dev: true }
    }
    autoUpdater.quitAndInstall()
    return { dev: false }
  })

  // ── LLM（宿主能力：工具可依赖，应用不依赖工具） ──
  handleOk(IPC_CHANNELS.llmChat, (_event, provider: LlmProvider, messages: unknown, options?: { onDelta?: boolean; model?: string }) => {
    const p = readProvider(_event, provider)
    // 禁用拦截（2026-11-18）：应用级 Provider 被禁用后，即使渲染层缓存了元数据直连调用也拒绝
    const stored = services!.host.listProviders().find((s) => s._id === p._id)
    if (stored && stored.enabled === false) {
      throw new Error(`Provider「${stored.name}」已禁用，请先在「模型控制台」启用后再调用`)
    }
    const apiKey = services!.getApiKey(p._id)
    // 模型链优先级：options.model（工具自选）→ provider.model（默认）→ provider.fallbackModel（回退）
    const toolModel = typeof options?.model === 'string' && options.model.trim() ? options.model.trim() : ''
    const models = [...new Set([toolModel, p.model, p.fallbackModel ?? ''].map((m) => m.trim()).filter(Boolean))]
    const retries = Math.max(0, Math.min(5, Math.floor(Number(p.maxRetries) || 0)))
    // H3-3 埋点：chat 开始/完成/失败（模型链 + 耗时，不含任何密钥）
    const started = Date.now()
    let chunkNo = 0
    let lastAt = 0
    logger.info('llm', `chat start models=${models.join('→')}${options?.onDelta ? '（流式）' : ''}${retries ? ` retries=${retries}` : ''}`)
    const streaming = options?.onDelta && mainWindow
    const call = chatWithFallback(
      {
        provider: p,
        apiKey,
        messages: messages as never,
        // D-V3-1：delta 到达埋点（chunk 序号/大小/间隔），dev 控制台 + 日志落盘，
        // 用于核查「一下子输出」是端点聚合大分片还是非流式整包
        ...(streaming
          ? {
              onDelta: (delta: string) => {
                const at = Date.now()
                chunkNo++
                const gap = lastAt ? at - lastAt : 0
                logger.debug('llm', `chunk#${chunkNo} size=${delta.length} gap=${gap}ms`)
                if (isDev) console.log(`[llm] chunk#${chunkNo} size=${delta.length} gap=${gap}ms`)
                lastAt = at
                mainWindow?.webContents.send(IPC_CHANNELS.llmChat, { delta })
              },
            }
          : {}),
      },
      models,
      retries,
    )
    return call.then(
      (res) => {
        logger.info('llm', `chat done ${Date.now() - started}ms`)
        // D-Q1 用量记录（console 调试）：流式无 usage 时按内容长度估算 completion tokens
        recordUsage(services!.repository, {
          providerId: p._id,
          providerName: p.name,
          model: res.model,
          purpose: 'console',
          streamed: Boolean(options?.onDelta) && res.streamed !== false,
          contentLength: res.content.length,
          promptTokens: res.usage?.promptTokens,
          completionTokens: res.usage?.completionTokens,
          durationMs: Date.now() - started,
          ok: true,
        })
        return res
      },
      (err) => {
        logger.error('llm', `chat failed：${(err as Error).message}`)
        recordUsage(services!.repository, {
          providerId: p._id,
          providerName: p.name,
          model: models[0] ?? p.model,
          purpose: 'console',
          streamed: Boolean(options?.onDelta),
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        })
        throw err
      },
    )
  })
  // 渲染层可临时带 apiKey 做「保存前探测」；不传则读 safeStorage 中已存的密钥。
  // 临时 key 只在这一次 IPC 里使用，不落盘、不进配置。
  handleOk(IPC_CHANNELS.llmListModels, (_event, provider: LlmProvider, apiKey?: string) =>
    listModels(
      readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : services!.getApiKey(provider?._id ?? ''),
    ))
  handleOk(IPC_CHANNELS.llmHealthCheck, (_event, provider: LlmProvider, apiKey?: string) =>
    healthCheck(
      readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : services!.getApiKey(provider?._id ?? ''),
    ))
  handleOk(IPC_CHANNELS.llmSetApiKey, (_event, providerId: string, apiKey: string) => {
    services!.setApiKey(providerId, String(apiKey ?? ''))
    return true
  })
  // 编辑时按需查看已存密钥：用户主动点击才下发，绝不随列表默认下发
  handleOk(IPC_CHANNELS.llmGetApiKey, async (_event, providerId: string) => {
    await services!.ensureSecrets()
    return services!.getApiKey(String(providerId ?? ''))
  })
  // 应用级 Provider 共享：所有工具列同一份清单、按 id 复用密钥，禁止各自重复配置
  handleOk(IPC_CHANNELS.llmProviders, () => services!.host.listProviders())
  handleOk(IPC_CHANNELS.llmProviderModels, (_event, providerId: string, apiKey?: string) =>
    services!.host.listModelsByProvider(
      String(providerId ?? ''),
      typeof apiKey === 'string' && apiKey ? apiKey : undefined,
    ))

  // ── R26 应用级上传（全局 profile + 工具覆盖；密钥只在主进程经 safeStorage 解析） ──
  const uploads = new UploadRuntime({
    services: services!,
    onProgress: (p) => mainWindow?.webContents.send(IPC_CHANNELS.uploadProgress, p),
  })
  handleOk(IPC_CHANNELS.uploadSingle, async (_event, req: UploadRequest) => {
    // H3-3 埋点：上传开始/完成/失败（文件名 + 大小，不含密钥）
    const started = Date.now()
    logger.info('upload', `单文件上传：${String(req?.name ?? '')}（${Number(req?.size ?? 0)} B）`)
    try {
      const result = await uploads.single(req)
      logger.info('upload', `单文件上传完成 ${Date.now() - started}ms：${String(req?.name ?? '')}`)
      return result
    } catch (err) {
      logger.error('upload', `单文件上传失败：${String(req?.name ?? '')}：${(err as Error).message}`)
      throw err
    }
  })
  handleOk(IPC_CHANNELS.uploadBatch, async (_event, reqs: UploadRequest[]) => {
    const count = Array.isArray(reqs) ? reqs.length : 0
    const started = Date.now()
    logger.info('upload', `批量上传：${count} 个文件`)
    try {
      const results = await uploads.batch(reqs)
      logger.info('upload', `批量上传完成 ${Date.now() - started}ms：${count} 个`)
      return results
    } catch (err) {
      logger.error('upload', `批量上传失败：${(err as Error).message}`)
      throw err
    }
  })
  handleOk(IPC_CHANNELS.uploadManagerGet, () => uploads.getConfig())
  handleOk(IPC_CHANNELS.uploadManagerSet, (_event, raw: unknown) => uploads.setConfig(raw))
  handleOk(IPC_CHANNELS.uploadProfiles, (_event, type?: 'remote' | 'cloud') =>
    uploads.profiles(type === 'remote' || type === 'cloud' ? type : undefined))
  handleOk(IPC_CHANNELS.uploadSecretSet, (_event, profileId: string, value: string) =>
    uploads.setSecret(profileId, value))
  handleOk(IPC_CHANNELS.uploadSecretState, () => uploads.secretState())
  // N3 / N4：按 id 主动查看密钥、按 profile 独立连通性自检（临时密钥不落盘）
  handleOk(IPC_CHANNELS.uploadSecretGet, (_event, profileId: string) => uploads.getSecret(profileId))
  handleOk(IPC_CHANNELS.uploadTest, (_event, req: UploadTestRequest) => uploads.test(req))
  // 富文本图片库：按来源列出已有图片（上传 runtime 内部解析 profile 与密钥）
  handleOk(IPC_CHANNELS.uploadListImages, (_event, req: UploadListRequest) => uploads.listImages(req))
  // 富文本图片库：按来源列出真实目录（含空目录），供目录下拉
  handleOk(IPC_CHANNELS.uploadListDirectories, (_event, req: UploadListRequest) => uploads.listDirectories(req))

  // ── X6 文件系统（plans/08）：浏览/管理已配置上传通道 + 统一传输队列 ──
  const fsRuntime = new FsRuntime({
    services: services!,
    onEvent: (task) => mainWindow?.webContents.send(IPC_CHANNELS.fsTransferEvent, task),
    onMediaEvent: (e) => mainWindow?.webContents.send(IPC_CHANNELS.fsMediaEvent, e),
  })
  fsRuntimeRef = fsRuntime
  handleOk(IPC_CHANNELS.fsProfiles, () => fsRuntime.profilesPayload())
  handleOk(IPC_CHANNELS.fsList, (_event, req: { profileId: string; path: string; cursor?: string | null }) =>
    fsRuntime.list(req))
  handleOk(IPC_CHANNELS.fsStat, (_event, req: { profileId: string; path: string }) => fsRuntime.stat(req))
  handleOk(IPC_CHANNELS.fsMkdir, (_event, req: { profileId: string; path: string }) => fsRuntime.mkdir(req))
  handleOk(IPC_CHANNELS.fsRm, (_event, req: Parameters<FsRuntime['rm']>[0]) => fsRuntime.rm(req))
  handleOk(IPC_CHANNELS.fsCp, (_event, req: Parameters<FsRuntime['cp']>[0]) => fsRuntime.cp(req))
  handleOk(IPC_CHANNELS.fsMv, (_event, req: Parameters<FsRuntime['mv']>[0]) => fsRuntime.mv(req))
  handleOk(IPC_CHANNELS.fsCrossCopy, (_event, req: Parameters<FsRuntime['crossCopy']>[0]) => fsRuntime.crossCopy(req))
  // 递归搜索：边扫边把命中批次推给渲染层（流式显示，避免长时间空白）；最终全量结果仍由 invoke 返回
  handleOk(IPC_CHANNELS.fsSearch, (event, req: Parameters<FsRuntime['search']>[0]) =>
    fsRuntime.search(req, (batch) => {
      const reqId = String((req as { reqId?: string } | undefined)?.reqId ?? '')
      if (!reqId) return
      const payload: import('@sshk/shared').FsSearchEvent = {
        reqId,
        entries: batch.entries,
        done: batch.done,
        scannedDirs: batch.scannedDirs,
      }
      event.sender.send(IPC_CHANNELS.fsSearchEvent, payload)
    }))
  handleOk(IPC_CHANNELS.fsUsage, (_event, req: Parameters<FsRuntime['usage']>[0]) => fsRuntime.usage(req))
  handleOk(IPC_CHANNELS.fsRead, (_event, req: { profileId: string; path: string; maxBytes?: number }) =>
    fsRuntime.read(req))
  handleOk(IPC_CHANNELS.fsReadMedia, (_event, req: { profileId: string; path: string }) => fsRuntime.readMedia(req))
  handleOk(IPC_CHANNELS.fsWrite, (_event, req: Parameters<FsRuntime['write']>[0]) => fsRuntime.write(req))
  handleOk(IPC_CHANNELS.fsTransferStart, (_event, inputs: Parameters<FsRuntime['transferStart']>[0]) =>
    fsRuntime.transferStart(inputs))
  handleOk(IPC_CHANNELS.fsTransferList, () => fsRuntime.transferList())
  // plans/10：单一控制通道（取代旧 cancel/retry/clear 三通道，不做兼容）
  handleOk(IPC_CHANNELS.fsTransferControl, (_event, req: Parameters<FsRuntime['transferControl']>[0]) =>
    fsRuntime.transferControl(req))
  handleOk(IPC_CHANNELS.fsTransferMultipart, () => fsRuntime.transferMultipart())
  handleOk(IPC_CHANNELS.fsTransferMultipartSet, (_event, req: Parameters<FsRuntime['setTransferMultipart']>[0]) =>
    fsRuntime.setTransferMultipart(req))
  handleOk(IPC_CHANNELS.fsTransferOrphansClean, () => fsRuntime.cleanOrphanUploads())
  handleOk(IPC_CHANNELS.fsPickUpload, (_event, opts?: { type?: 'file' | 'dir' | 'any' }) =>
    fsRuntime.pickUpload(opts))
  handleOk(IPC_CHANNELS.fsFlattenLocal, (_event, paths: string[]) => fsRuntime.flattenLocal(paths))
  // 下载目录读取 / 修改（当前通道下载落点由渲染层用 getDir(profileId) 计算）
  handleOk(IPC_CHANNELS.fsDownloadDir, (_event, profileId: string) => fsRuntime.downloadDir(profileId))
  handleOk(IPC_CHANNELS.fsSetDownloadDir, (_event, dir: string) => fsRuntime.setDownloadDir(dir))
  // ── §十一 扩展（用户 2026-11-18 定版）：chmod / 文本转换 / 压缩解压 / 备注 / 收藏 ──
  handleOk(IPC_CHANNELS.fsChmod, (_event, req: Parameters<FsRuntime['chmod']>[0]) => fsRuntime.chmod(req))
  handleOk(IPC_CHANNELS.fsConvertText, (_event, req: Parameters<FsRuntime['convertText']>[0]) => fsRuntime.convertText(req))
  handleOk(IPC_CHANNELS.fsZip, (_event, req: Parameters<FsRuntime['zip']>[0]) => fsRuntime.zip(req))
  handleOk(IPC_CHANNELS.fsUnzip, (_event, req: Parameters<FsRuntime['unzip']>[0]) => fsRuntime.unzip(req))
  handleOk(IPC_CHANNELS.fsZipLimits, () => fsRuntime.zipLimits())
  handleOk(IPC_CHANNELS.fsZipLimitsSet, (_event, req: Parameters<FsRuntime['setZipLimits']>[0]) => fsRuntime.setZipLimits(req))
  handleOk(IPC_CHANNELS.fsTransferCaps, () => fsRuntime.transferCaps())
  handleOk(IPC_CHANNELS.fsTransferCapsSet, (_event, req: Parameters<FsRuntime['setTransferCaps']>[0]) => fsRuntime.setTransferCaps(req))
  handleOk(IPC_CHANNELS.fsAnnotationList, (_event, profileId: string) => fsRuntime.annotationList(profileId))
  handleOk(IPC_CHANNELS.fsAnnotationSet, (_event, req: Parameters<FsRuntime['annotationSet']>[0]) => fsRuntime.annotationSet(req))
  handleOk(IPC_CHANNELS.fsFavoriteList, () => fsRuntime.favoriteList())
  handleOk(IPC_CHANNELS.fsFavoriteAdd, (_event, req: Parameters<FsRuntime['favoriteAdd']>[0]) => fsRuntime.favoriteAdd(req))
  handleOk(IPC_CHANNELS.fsFavoriteRemove, (_event, id: string) => fsRuntime.favoriteRemove(id))

  // ── OS 能力（宿主提供） ──
  handleOk(IPC_CHANNELS.osPickFile, async (_event, opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts?.filters,
      ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    })
    return result.canceled ? [] : result.filePaths
  })
  handleOk(IPC_CHANNELS.osPickSave, async (_event, opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    // defaultPath 优先作为"目录/起始路径"，与 fileName 组合成默认完整路径；仅给 fileName 时退回原行为
    const base = opts?.defaultPath
      ? (opts.fileName ? join(opts.defaultPath, opts.fileName) : opts.defaultPath)
      : opts?.fileName
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: base,
      filters: opts?.extensions ? [{ name: '文件', extensions: opts.extensions }] : undefined,
    })
    return result.canceled ? '' : (result.filePath ?? '')
  })
  // 图片应用内预览：仅图片扩展名 + 10MB 上限，返回 data URI
  handleOk(IPC_CHANNELS.osReadDataUri, (_event, file: string) => {
    const target = String(file ?? '')
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(target)) throw new Error('仅支持图片文件预览')
    const buf = readFileSync(target)
    if (buf.byteLength > 10 * 1024 * 1024) throw new Error('图片超过 10MB，无法预览')
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    }
    const mime = mimeMap[/\.[a-z]+$/i.exec(target.toLowerCase())?.[0] ?? ''] ?? 'application/octet-stream'
    return 'data:' + mime + ';base64,' + buf.toString('base64')
  })
  // 文本写盘：路径必须来自用户经保存对话框选择（导出 HTML 等）
  handleOk(IPC_CHANNELS.osWriteText, (_event, path: string, content: string) => {
    const target = String(path || '')
    if (!target) throw new Error('缺少写入路径')
    writeFileSync(target, String(content ?? ''), 'utf8')
    return true
  })
  // 二进制写盘（base64 → 文件）：下载 PNG 等场景；路径同样必须来自用户保存对话框
  handleOk(IPC_CHANNELS.osWriteBinary, (_event, path: string, base64: string) => {
    const target = String(path || '')
    if (!target) throw new Error('缺少写入路径')
    if (!/^[A-Za-z0-9+/=]+$/.test(String(base64 ?? ''))) throw new Error('内容必须是合法 base64')
    writeFileSync(target, Buffer.from(String(base64), 'base64'))
    return true
  })
  handleOk(IPC_CHANNELS.osPickDir, async (_event, opts?: { defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      ...(opts?.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    })
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })
  handleOk(IPC_CHANNELS.osClipboardWrite, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  handleOk(IPC_CHANNELS.osShellOpen, async (_event, target: string) => {
    const t = String(target ?? '')
    if (/^https?:\/\//i.test(t)) return void shell.openExternal(t)
    if (await shell.openPath(t)) throw new Error(`拒绝打开: ${t}`)
    return true
  })
  handleOk(IPC_CHANNELS.osIsElevated, () => isElevated())

  // ── H3 日志落盘：渲染层日志汇入 + 日志目录信息 / 清空 ──
  ipcMain.on(IPC_CHANNELS.logFrontend, (_event, payload: { level?: string; scope?: string; msg?: string; detail?: unknown }) => {
    const level = (['debug', 'info', 'warn', 'error'].includes(String(payload?.level)) ? payload!.level : 'info') as 'debug' | 'info' | 'warn' | 'error'
    logger[level](String(payload?.scope ?? 'renderer').slice(0, 40), String(payload?.msg ?? '').slice(0, 4000), payload?.detail)
  })
  handleOk(IPC_CHANNELS.logDirGet, () => logger.describe())
  handleOk(IPC_CHANNELS.logClean, () => ({ removed: logger.clean() }))

  // ── N2 工具健康度面板：目录裁决 + 插件状态 + 日志 error 检索 ──
  handleOk(IPC_CHANNELS.toolsHealth, () => collectToolHealth(buildCatalog(), allManifests()))

  // ── U2 验证引导：会话存储 + main 侧自动判定（fileExists/catalogState/logScan）──
  // dev 落 <repo>/docs/verify-sessions（随 git 提交同步，跨设备/多人增量累计）；打包版落 userData
  const verifyDir = resolveSessionsDir(app.getPath('userData'), findRepoRoot(app.getAppPath()))
  handleOk(IPC_CHANNELS.verifySessionLoad, (_event, date?: string) => loadSession(verifyDir, date ? String(date) : undefined))
  handleOk(IPC_CHANNELS.verifySessionSave, (_event, session: unknown) => saveSession(verifyDir, session as VerifySession))
  handleOk(IPC_CHANNELS.verifySessionList, () => listSessions(verifyDir))
  handleOk(IPC_CHANNELS.verifyAutoCheck, (_event, req: { kind?: string; spec?: string }) => {
    const catalog = buildCatalog()
    const catalogMap: Record<string, { enabled: boolean; visible: boolean }> = {}
    for (const t of catalog.tools) catalogMap[t.id] = { enabled: t.enabled, visible: t.visible }
    const channelCounts: Record<string, number> = {}
    for (const m of allManifests()) channelCounts[m.id] = m.plugin?.channels?.length ?? 0
    return runAutoCheck(String(req?.kind ?? ''), String(req?.spec ?? ''), {
      catalog: catalogMap,
      channelCounts,
      lastErrors: (toolId) => toolRecentErrors(toolId),
      packagedResourceRoot: app.isPackaged ? process.resourcesPath : null,
    })
  })

  // ── N3 配置预设分享：导出（脱敏 JSON）/ 导入（按 id 合并）──
  // 预设密钥投影：含密钥导出/导入时经 services 读写 safeStorage（默认导出不带密钥，红线不变）
  const presetSecrets: PresetSecretStore = {
    getProviderKey: (id) => services!.getApiKey(id),
    getUploadKey: (id) => services!.getUploadSecret(id),
    setProviderKey: (id, key) => services!.setApiKey(id, key),
    setUploadKey: (id, key) => services!.setUploadSecret(id, key),
  }
  handleOk(IPC_CHANNELS.presetExport, (_event, req: string | { outPath: string; includeSecrets?: boolean }, inc?: boolean) => {
    // 兼容两条调用路径：命名方法传 (outPath, includeSecrets)；通用 IPC 透传 (channel, outPath, includeSecrets)
    const payload = typeof req === 'string'
      ? { outPath: req, includeSecrets: Boolean(inc) }
      : (req ?? { outPath: '' })
    return exportPreset(services!.config, String(payload.outPath ?? ''), presetSecrets, Boolean(payload.includeSecrets))
  })
  handleOk(IPC_CHANNELS.presetImport, (_event, filePath: string) => importPreset(services!.config, String(filePath ?? ''), presetSecrets))

  // ── N4 回滚快照：列表 / 恢复 / 清空（开关 app.outputSnapshot 在设置页）──
  const snapshotRoot = join(app.getPath('userData'), '.snapshots')
  handleOk(IPC_CHANNELS.snapshotList, () => listSnapshots(snapshotRoot))
  handleOk(IPC_CHANNELS.snapshotRestore, (_event, id: string) => restoreSnapshot(snapshotRoot, String(id ?? '')))
  handleOk(IPC_CHANNELS.snapshotClear, () => ({ removed: clearSnapshots(snapshotRoot) }))

  // ── N1 一键诊断：采集（预览）+ 导出 zip（report.md + 近 3 天日志）──
  handleOk(IPC_CHANNELS.diagCollect, () => collectDiagnostics(services!, pluginStatus, buildCatalog()))
  handleOk(IPC_CHANNELS.diagExport, (_event, zipPath: string) =>
    exportDiagnosisZip(collectDiagnostics(services!, pluginStatus, buildCatalog()), String(zipPath ?? '')))

  // ── D-Q1 模型用量日志：统计 / 清空 ──
  handleOk(IPC_CHANNELS.usageStats, async (_event, since?: string | null) =>
    collectUsageStats(services!.repository, typeof since === 'string' && since ? since : null))
  handleOk(IPC_CHANNELS.usageClear, async (_event, keepDays?: number) => {
    const removed = await clearUsage(services!.repository, Number(keepDays) || 0)
    logger.info('usage', `用量明细已清理：${removed} 条（keepDays=${Number(keepDays) || 0}）`)
    return { removed }
  })

  // ── 插件：按构建期发现的清单逐个加载，任一失败只影响它自己 ──
  pluginStatus = await loadToolPlugins({
    ipcMain,
    repository: services!.repository,
    outputRoot: services!.outputRoot,
    host: services!.host,
    config: services!.config,
    isActive: isToolActive,
  }, allManifests(), { userDataDir: app.getPath('userData') })
}

/**
 * 一次性迁移：productName 统一前的旧 userData（%APPDATA%/@sshk/desktop）→ 现目录。
 * 目标已存在的文件一律不覆盖（以现目录为准），避免回滚用户在新区已做的配置。
 */
function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), '@sshk', 'desktop')
  if (current === legacy || !existsSync(legacy)) return
  for (const name of ['settings.json', 'secrets.bin', 'db']) {
    const from = join(legacy, name)
    const to = join(current, name)
    if (existsSync(from) && !existsSync(to)) {
      try {
        cpSync(from, to, { recursive: true })
        console.warn(`[sshk] 已迁移旧数据：${name}`)
      } catch (err) {
        console.warn(`[sshk] 旧数据迁移失败（${name}）：`, err)
      }
    }
  }
}

type UpdatePhase =
  | 'idle' | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'dev' | 'disabled'
interface UpdateState {
  phase: UpdatePhase
  version?: string
  percent?: number
  error?: string
}

/** 主进程持有唯一更新状态，事件触发时推给渲染层（单一真相源，避免重复 toast） */
let updateState: UpdateState = { phase: 'idle' }
let latestVersion: string | undefined
/** 下载进度日志节流游标：每跨 10% 落一条（download-progress 高频，不逐条刷日志） */
let progressLogMark = 0
/** 下载阶段标记：error 事件无阶段上下文，用它区分「下载失败」与「检查失败」文案（渲染层横幅直接展示） */
let downloadStarted = false
function pushUpdate(patch: Partial<UpdateState>): void {
  const prevPhase = updateState.phase
  updateState = { ...updateState, ...patch }
  // H3-3 埋点：phase 变化才落盘（download-progress 高频进度不刷日志）
  if (patch.phase && patch.phase !== prevPhase) {
    logger.info('updater', `更新状态 → ${patch.phase}${updateState.version ? ` v${updateState.version}` : ''}${updateState.error ? `：${updateState.error}` : ''}`)
  }
  mainWindow?.webContents.send(IPC_CHANNELS.updateState, updateState)
}

/** 给 autoUpdater 挂全生命周期监听，把状态与进度实时推到渲染层 */
function wireAutoUpdater(): void {
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
    // error 事件不区分阶段；downloadStarted 区分「下载失败」（如 GitHub 挂起后超时）与「检查失败」
    pushUpdate({ phase: 'error', error: (downloadStarted ? '下载失败：' : '检查失败：') + err.message })
  })
}

function setupAutoUpdate(): void {
  // SSHK_APP_AUTO_UPDATE=0：自动更新机制整体禁用——不挂监听、不检查，推 disabled 让渲染层隐藏全部更新入口
  if (autoUpdateDisabled) {
    pushUpdate({ phase: 'disabled' })
    return
  }
  if (isDev && !updateDevCheck) return
  if (updateDevCheck) logger.info('updater', 'dev 更新测试模式已启用：连接 GitHub 更新源，下载但绝不安装')
  wireAutoUpdater()
  // 尊重「自动更新」开关：关闭则仅在用户手动「检查更新」时检测
  const auto = services?.config.get('app.autoUpdate')
  if (auto !== false) {
    // dev 更新测试：启动自动检查同样先清 pending 缓存（与手动检查口径一致）
    if (updateDevCheck) resetDevUpdatePendingCache()
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.warn('[sshk] 自动更新检查失败：', err)
      pushUpdate({ phase: 'error', error: (err as Error).message })
    })
  }
}

void app.whenReady().then(async () => {
  migrateLegacyUserData()
  services = setupServices()
  installLocalResHandler(services.config)
  // app:// 渲染层静态文件服务（打包版 / dev 显式开启时替代 loadFile 的 file://）
  installAppProtocolHandler(path.join(here, '../renderer'))
  // ShareHub 常驻分享服务（plans/09）：单例创建 + 自动启动 + 旧状态文件清理 + powerMonitor
  shareHubHost = createShareHubHost(services.config, {
    userDataDir: app.getPath('userData'),
    isDev,
  })
  await shareHubHost.init()
  seedDefaultProviders()
  migrateLegacyVisionConfig()
  await registerIpc()
  // H3 日志：启动清理过期文件 + 记录启动事件
  const removedLogs = logger.clean()
  if (removedLogs > 0) logger.info('app', `已清理 ${removedLogs} 个过期日志文件`)
  logger.info('app', `应用启动 v${app.getVersion()}（${app.isPackaged ? 'packaged' : 'dev'}）`)
  // H6 NeDB 防膨胀：每日首次启动全量压缩一次；超阈(>10MB)文件无论何时启动都压缩
  const today = now().slice(0, 10)
  if (services.config.get('app.lastCompactAt') !== today) {
    services.config.set('app.lastCompactAt', today)
    void compactDatabase('daily')
  } else {
    void compactDatabase('startup')
  }
  // 应用内自绘标题栏与工具栏，去掉系统默认菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null)
  createTray()
  createWindow()
  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
