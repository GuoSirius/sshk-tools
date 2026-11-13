import './env-load'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, Tray, Menu } from 'electron'
// electron-updater 是 CJS 模块：ESM 主进程必须默认导入再解构（具名导入运行时报错）
import electronUpdaterPkg from 'electron-updater'
const { autoUpdater } = electronUpdaterPkg
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
} from '@sshk/shared'
import { chat, healthCheck, listModels, type LlmProvider } from '@sshk/llm-gateway'
import { setupServices, type AppServices } from './services'
import { exportBackup } from '@sshk/backup'
import { importBackup } from '@sshk/backup'
import { installPackage, listInstalled, loadRuntimeManifests, readRenderer, uninstallPackage } from './runtime-installer'
import { defaultConfigPath } from '@sshk/repository'
import { loadToolPlugins, killUtilityTools } from './plugins'
import { MANIFESTS } from './discovery'

const here = path.dirname(fileURLToPath(import.meta.url))
const rendererHtml = path.join(here, '../renderer/index.html')
const preloadScript = path.join(here, '../preload/index.cjs')
const iconFile = path.join(here, '../../build/icon.png')
const trayIconFile = path.join(here, '../../build/tray.png')

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let services: AppServices | null = null
/** 插件加载结果：单个插件失败不影响宿主与其它工具 */
let pluginStatus: Record<string, ToolPluginStatus> = {}

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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) mainWindow?.webContents.openDevTools()
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // 关闭二次确认（防误触退出）：dev 不拦截；确认后置 quitting 放行 before-quit 链路
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
    // 退出前回收所有 utilityProcess 沙箱（外部包 main 子进程）
    killUtilityTools()
  })
  mainWindow.on('close', (event) => {
    if (quitting || isDev) return
    event.preventDefault()
    void dialog.showMessageBox(mainWindow!, {
      type: 'question',
      message: '确定退出应用吗？',
      detail: '退出后将关闭所有工具页面与后台任务。',
      buttons: ['退出', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        quitting = true
        app.quit()
      }
    })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(rendererHtml)
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

/** 构建期内置清单 + 运行时已安装包清单，统一参与目录裁决 */
function allManifests(): ToolDescriptor[] {
  const runtime = loadRuntimeManifests({ userDataDir: app.getPath('userData'), importedKeys: [] })
  for (const problem of runtime.problems) console.warn('[sshk] 运行时工具包：', problem)
  return [...MANIFESTS, ...runtime.manifests]
}

function assertKnownTool(id: string): void {
  if (!allManifests().some((tool) => tool.id === id)) throw new Error(`未知工具: ${id}`)
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

async function registerIpc(): Promise<void> {
  const cfg = services!.config

  // ── 配置 ──
  ipcMain.handle(IPC_CHANNELS.configGet, (_event, key: string) => cfg.get(key) ?? null)
  ipcMain.handle(IPC_CHANNELS.configSet, (_event, key: string, value: unknown) => {
    cfg.set(key, value)
    return true
  })
  cfg.onChanged((namespace, key) => {
    if (namespace === 'app' && key === 'themeMode') {
      const mode = cfg.get('app.themeMode')
      nativeTheme.themeSource = mode === 'system' ? 'system' : mode === 'light' ? 'light' : 'dark'
    }
    mainWindow?.webContents.send(IPC_CHANNELS.configChanged, { namespace, key })
  })
  const themeMode = cfg.get('app.themeMode')
  nativeTheme.themeSource = themeMode === 'system' ? 'system' : themeMode === 'light' ? 'light' : 'dark'

  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.appOpenDataDir, () => shell.openPath(app.getPath('userData')))
  ipcMain.handle(IPC_CHANNELS.appReload, (_event, force?: boolean) => {
    const wc = mainWindow?.webContents
    if (!wc) return false
    if (force) wc.reloadIgnoringCache()
    else wc.reload()
    return true
  })
  // 开发环境随意开关；打包版必须持密钥（默认 sshk-tools@888，哈希存配置可更换）
  ipcMain.handle(IPC_CHANNELS.appToggleDevTools, (_event, key?: string) => {
    if (isDev) {
      mainWindow?.webContents.toggleDevTools()
      return true
    }
    const hash = createHash('sha256').update(String(key ?? ''), 'utf8').digest('hex')
    if (hash !== String(cfg.get('app.devtoolsKeyHash') ?? '')) {
      throw new Error('访问密钥不正确')
    }
    mainWindow?.webContents.toggleDevTools()
    return true
  })

  // ── 工具目录（启用 / 权限 / 依赖 / 分发 / 元数据覆盖） ──
  ipcMain.handle(IPC_CHANNELS.toolsList, () => buildCatalog())
  ipcMain.handle(IPC_CHANNELS.toolsSetEnabled, (_event, id: string, enabled: boolean) => {
    assertKnownTool(id)
    cfg.set(`tools.${id}.enabled`, Boolean(enabled))
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.toolsSetGrant, (_event, id: string, grant: string) => {
    assertKnownTool(id)
    if (grant && grant !== ACCESS_GRANT) throw new Error(`未知权限要求: ${grant}`)
    cfg.set(`tools.${id}.requiredGrant`, grant || '')
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.toolsSetDependencies, (_event, id: string, raw: unknown) => {
    assertKnownTool(id)
    if (!Array.isArray(raw)) throw new Error('依赖必须是工具 id 数组')
    const ids = Array.from(new Set(raw.filter((dep): dep is string =>
      typeof dep === 'string' && dep !== id && MANIFESTS.some((t) => t.id === dep))))
    cfg.set(`tools.${id}.dependsOn`, ids)
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.toolsSetOverrides, (_event, id: string, raw: unknown) => {
    assertKnownTool(id)
    const all = readRecord<ToolOverrides>('app.toolOverrides')
    all[id] = pickOverrides(raw)
    cfg.set('app.toolOverrides', all)
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.toolsSetDistribution, (_event, raw: unknown) => {
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string' && allManifests().some((t) => t.id === id))
      : null
    cfg.set('app.distribution.includeTools', ids)
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.toolsCleanupOrphans, () => {
    for (const id of buildCatalog().orphans) cfg.remove(`tools.${id}`)
    return buildCatalog()
  })
  ipcMain.handle(IPC_CHANNELS.accessKeySet, (_event, key: string) => {
    services!.setAccessKey(String(key ?? ''))
    return buildCatalog()
  })

  // ── 备份：settings + NeDB + 产物 → zip；导入含快照回滚 ──
  ipcMain.handle(IPC_CHANNELS.backupExport, async (_event, zipPath: string, passphrase?: string) => {
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
  ipcMain.handle(IPC_CHANNELS.backupImport, async (_event, zipPath: string, passphrase?: string) => {
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
  const runtimeDeps = () => ({ userDataDir: app.getPath('userData'), importedKeys: (cfg.get('app.runtime.publicKeys') ?? []) as never[] })
  ipcMain.handle(IPC_CHANNELS.runtimeInstall, (_event, zipPath: string, explicitlyTrusted?: boolean) => {
    const path = String(zipPath ?? '')
    if (!/\.sshktool$/i.test(path)) throw new Error('仅支持 .sshktool 包')
    const result = installPackage(path, runtimeDeps(), { explicitlyTrusted })
    return { record: result.record, warnings: result.warnings }
  })
  ipcMain.handle(IPC_CHANNELS.runtimeList, () => listInstalled(runtimeDeps()))
  ipcMain.handle(IPC_CHANNELS.runtimeUninstall, (_event, id: string) => uninstallPackage(String(id ?? ''), runtimeDeps()))
  ipcMain.handle(IPC_CHANNELS.runtimeReadRenderer, (_event, id: string) => readRenderer(String(id ?? ''), runtimeDeps()))
  // ── 运行时公钥管理：导入（PEM 校验 + 指纹 keyId）/ 列表 / 撤销 ──
  const keyFingerprint = (pem: string) => createHash('sha256').update(pem.trim()).digest('hex').slice(0, 12)
  ipcMain.handle(IPC_CHANNELS.runtimeKeysList, () => cfg.get('app.runtime.publicKeys') ?? [])
  ipcMain.handle(IPC_CHANNELS.runtimeKeysImport, (_event, label: string, pem: string) => {
    const clean = String(pem ?? '').trim()
    if (!clean.startsWith('-----BEGIN')) throw new Error('不是有效的 PEM 公钥')
    try { createPublicKey(clean) } catch { throw new Error('PEM 公钥解析失败，请检查内容') }
    const entry = { keyId: 'pk_' + keyFingerprint(clean), label: String(label || '未命名发布者'), pem: clean, importedAt: now() }
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    if (keys.some((k) => k.keyId === entry.keyId)) throw new Error('该公钥已导入')
    cfg.set('app.runtime.publicKeys', [...keys, entry])
    return entry
  })
  ipcMain.handle(IPC_CHANNELS.runtimeKeysRevoke, (_event, keyId: string) => {
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    cfg.set('app.runtime.publicKeys', keys.filter((k) => k.keyId !== String(keyId ?? '')))
    return true
  })

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.themeSystemChanged)
  })

  // ── 更新 ──
  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    if (isDev) return { dev: true }
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version ?? null
    return { updateAvailable: Boolean(version && version !== app.getVersion()), version }
  })
  ipcMain.handle(IPC_CHANNELS.updateQuitAndInstall, () => {
    autoUpdater.quitAndInstall()
  })

  // ── LLM（宿主能力：工具可依赖，应用不依赖工具） ──
  ipcMain.handle(IPC_CHANNELS.llmChat, (_event, provider: LlmProvider, messages: unknown, options?: { onDelta?: boolean }) => {
    const p = readProvider(_event, provider)
    const apiKey = services!.getApiKey(p._id)
    if (options?.onDelta && mainWindow) {
      return chat({
        provider: p,
        apiKey,
        messages: messages as never,
        onDelta: (delta) => mainWindow?.webContents.send(IPC_CHANNELS.llmChat, { delta }),
      })
    }
    return chat({ provider: p, apiKey, messages: messages as never })
  })
  // 渲染层可临时带 apiKey 做「保存前探测」；不传则读 safeStorage 中已存的密钥。
  // 临时 key 只在这一次 IPC 里使用，不落盘、不进配置。
  ipcMain.handle(IPC_CHANNELS.llmListModels, (_event, provider: LlmProvider, apiKey?: string) =>
    listModels(
      readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : services!.getApiKey(provider?._id ?? ''),
    ))
  ipcMain.handle(IPC_CHANNELS.llmHealthCheck, (_event, provider: LlmProvider, apiKey?: string) =>
    healthCheck(
      readProvider(_event, provider),
      typeof apiKey === 'string' && apiKey ? apiKey : services!.getApiKey(provider?._id ?? ''),
    ))
  ipcMain.handle(IPC_CHANNELS.llmSetApiKey, (_event, providerId: string, apiKey: string) => {
    services!.setApiKey(providerId, String(apiKey ?? ''))
    return true
  })
  // 编辑时按需查看已存密钥：用户主动点击才下发，绝不随列表默认下发
  ipcMain.handle(IPC_CHANNELS.llmGetApiKey, async (_event, providerId: string) => {
    await services!.ensureSecrets()
    return services!.getApiKey(String(providerId ?? ''))
  })
  // 应用级 Provider 共享：所有工具列同一份清单、按 id 复用密钥，禁止各自重复配置
  ipcMain.handle(IPC_CHANNELS.llmProviders, () => services!.host.listProviders())
  ipcMain.handle(IPC_CHANNELS.llmProviderModels, (_event, providerId: string, apiKey?: string) =>
    services!.host.listModelsByProvider(
      String(providerId ?? ''),
      typeof apiKey === 'string' && apiKey ? apiKey : undefined,
    ))

  // ── OS 能力（宿主提供） ──
  ipcMain.handle(IPC_CHANNELS.osPickFile, async (_event, opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts?.filters,
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC_CHANNELS.osPickSave, async (_event, opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }) => {
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
  ipcMain.handle(IPC_CHANNELS.osReadDataUri, (_event, file: string) => {
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
  ipcMain.handle(IPC_CHANNELS.osWriteText, (_event, path: string, content: string) => {
    const target = String(path || '')
    if (!target) throw new Error('缺少写入路径')
    writeFileSync(target, String(content ?? ''), 'utf8')
    return true
  })
  ipcMain.handle(IPC_CHANNELS.osPickDir, async (_event) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })
  ipcMain.handle(IPC_CHANNELS.osClipboardWrite, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  ipcMain.handle(IPC_CHANNELS.osShellOpen, async (_event, target: string) => {
    const t = String(target ?? '')
    if (/^https?:\/\//i.test(t)) return void shell.openExternal(t)
    if (await shell.openPath(t)) throw new Error(`拒绝打开: ${t}`)
    return true
  })

  // ── 插件：按构建期发现的清单逐个加载，任一失败只影响它自己 ──
  pluginStatus = await loadToolPlugins({
    ipcMain,
    repository: services!.repository,
    outputRoot: services!.outputRoot,
    host: services!.host,
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

function setupAutoUpdate(): void {
  if (isDev) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
    console.warn('[sshk] 自动更新检查失败：', err)
  })
}

void app.whenReady().then(async () => {
  migrateLegacyUserData()
  services = setupServices()
  seedDefaultProviders()
  migrateLegacyVisionConfig()
  await registerIpc()
  // 应用内自绘标题栏与工具栏，去掉系统默认菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null)
  createTray()
  createWindow()
  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
