// 源码为 ESM/TS，electron-vite 构建为 out/preload/index.cjs（CommonJS）。
// sandbox: true 下 preload 只能由 require 加载，因此产物固定 CJS 且只做白名单桥接。
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, isIpcResult } from '@sshk/shared'
import { toPlain } from './plain'

/**
 * 所有 IPC 入参统一在边界脱壳：Vue 的 ref/reactive Proxy 无法被结构化克隆。
 * 放在唯一出口，渲染层与各工具包（含后期外部工具）都无需自己 toRaw。
 * 注册类监听（ipcRenderer.on）不经过这里，回调函数保持原样。
 *
 * H1 统一 IPC 失败契约：主进程 handleOk 包装的结果（__ipc 标记）在这里统一解包——
 * ok 直接取 data（渲染层零感知）；!ok 抛 Error(message)，渲染层既有 try/catch 不变。
 * 未标记的历史返回值原样透传，兼容渐进迁移。
 */
// 返回值类型由各方法自身的标注与 renderer/env.d.ts 约束，这里只统一处理入参。
const invoke = async (channel: string, ...args: unknown[]): Promise<any> => {
  const result = await ipcRenderer.invoke(channel, ...args.map(toPlain))
  if (isIpcResult(result)) {
    if (result.ok) return result.data
    throw new Error(result.message)
  }
  return result
}

const api = {
  config: {
    get: (key: string): Promise<unknown> => invoke(IPC_CHANNELS.configGet, key),
    set: (key: string, value: unknown): Promise<boolean> =>
      invoke(IPC_CHANNELS.configSet, key, value),
    onChanged: (callback: (payload: { namespace: string; key: string }) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.configChanged, (_event, payload) => callback(payload))
    },
  },
  theme: {
    set: (mode: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.configSet, 'app.themeMode', mode),
    onSystemChanged: (callback: () => void): void => {
      ipcRenderer.on(IPC_CHANNELS.themeSystemChanged, () => callback())
    },
  },
  app: {
    version: (): Promise<string> => invoke(IPC_CHANNELS.appVersion),
    /** 关于页运行环境（版本/commit/Electron/Chrome/Node） */
    runtime: (): Promise<{ version: string; commit: string; electron: string; chrome: string; node: string }> =>
      invoke(IPC_CHANNELS.appRuntime),
    openDataDir: (): Promise<void> => invoke(IPC_CHANNELS.appOpenDataDir),
    /** force=true 走 reloadIgnoringCache（等价 Ctrl+F5） */
    reload: (force?: boolean): Promise<boolean> =>
      invoke(IPC_CHANNELS.appReload, Boolean(force)),
    toggleDevTools: (key?: string): Promise<boolean> => invoke(IPC_CHANNELS.appToggleDevTools, key),
    /** 只校验访问密钥、不打开 DevTools；按操作独立缓存（项9：开发者模式/开发者工具各自输各自的） */
    verifyDevtoolsKey: (key: string, operation?: 'devtools' | 'developerMode'): Promise<boolean> =>
      invoke(IPC_CHANNELS.appVerifyDevtoolsKey, key, operation),
    /** 主进程在窗口关闭前回调：渲染层据此弹出主题色确认框 */
    onRequestClose: (callback: () => void): void => {
      ipcRenderer.on(IPC_CHANNELS.appRequestClose, () => callback())
    },
    /** 渲染层确认关闭后调用：主进程置 quitting 并真正退出 */
    confirmClose: (): Promise<boolean> => invoke(IPC_CHANNELS.appConfirmClose),
  },
  update: {
    check: (): Promise<{ dev?: boolean; updateAvailable?: boolean; version?: string | null; error?: string }> =>
      invoke(IPC_CHANNELS.updateCheck),
    download: (): Promise<boolean> => invoke(IPC_CHANNELS.updateDownload),
    quitAndInstall: (): Promise<{ dev?: boolean } | void> => invoke(IPC_CHANNELS.updateQuitAndInstall),
    /** 主进程主动推送 autoUpdater 状态（检查/发现/下载进度/完成/失败），渲染层据此驱动 UI */
    onState: (callback: (payload: unknown) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.updateState, (_event, payload) => callback(payload))
    },
  },
  llm: {
    /** 密钥在主进程注入，渲染层只传 provider 元信息 */
    chat: (
      provider: unknown,
      messages: unknown,
      options?: { onDelta?: boolean; model?: string },
    ): Promise<{ content: string; model: string }> =>
      invoke(IPC_CHANNELS.llmChat, provider, messages, options),
    /** 流式回调经事件通道分片推送 */
    onDelta: (callback: (delta: string) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.llmChat, (_event, payload: { delta?: string }) => {
        if (typeof payload?.delta === 'string') callback(payload.delta)
      })
    },
    /** 保存 Provider 前也能用刚填的 key 探测；不传则读主进程 safeStorage */
    listModels: (provider: unknown, apiKey?: string): Promise<string[]> =>
      invoke(IPC_CHANNELS.llmListModels, provider, apiKey),
    healthCheck: (provider: unknown, apiKey?: string): Promise<{ ok: boolean; message: string; latencyMs?: number }> =>
      invoke(IPC_CHANNELS.llmHealthCheck, provider, apiKey),
    setApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.llmSetApiKey, providerId, apiKey),
    /** 编辑时按需查看已存密钥（用户主动点击） */
    getApiKey: (providerId: string): Promise<string> => invoke(IPC_CHANNELS.llmGetApiKey, providerId),
    /** 应用级 Provider 只读清单；所有工具共用，返回值绝不含密钥明文 */
    providers: (): Promise<unknown[]> => invoke(IPC_CHANNELS.llmProviders),
    /** 按 Provider id 真实查询 /models，密钥由主进程注入 */
    providerModels: (providerId: string, apiKey?: string): Promise<string[]> =>
      invoke(IPC_CHANNELS.llmProviderModels, providerId, apiKey),
  },
  /** R26 应用级上传：全局 profile / 密钥只在 main 解析，渲染层只传文件内容与工具级覆盖项 */
  upload: {
    single: (req: unknown): Promise<{ url: string; key?: string; name: string }> =>
      invoke(IPC_CHANNELS.uploadSingle, req),
    batch: (reqs: unknown[]): Promise<{ url: string; key?: string; name: string }[]> =>
      invoke(IPC_CHANNELS.uploadBatch, reqs),
    onProgress: (callback: (payload: unknown) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.uploadProgress, (_event, payload) => callback(payload))
    },
    getConfig: (): Promise<unknown> => invoke(IPC_CHANNELS.uploadManagerGet),
    setConfig: (cfg: unknown): Promise<unknown> => invoke(IPC_CHANNELS.uploadManagerSet, cfg),
    profiles: (type?: 'remote' | 'cloud'): Promise<unknown[]> =>
      invoke(IPC_CHANNELS.uploadProfiles, type),
    setSecret: (profileId: string, value: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.uploadSecretSet, profileId, value),
    secretState: (): Promise<Record<string, boolean>> =>
      invoke(IPC_CHANNELS.uploadSecretState),
    /** 用户主动点「查看」才按 id 取回明文，不随列表默认下发 */
    getSecret: (profileId: string): Promise<string> =>
      invoke(IPC_CHANNELS.uploadSecretGet, profileId),
    /** 单个 profile 连通性自检；可带表单里尚未保存的临时密钥。返回结构化结果，不 reject */
    test: (req: unknown): Promise<{ ok: boolean; message: string }> =>
      invoke(IPC_CHANNELS.uploadTest, req),
    /** 图库/文件库：按来源列出已有文件（kind=image/document/code 按白名单、all 全部；缺省 image），返回分页（nextCursor 非空可续拉） */
    listImages: (req: unknown): Promise<{ items: { url: string; key: string; name: string; size?: number; modified?: number }[]; nextCursor?: string | null }> =>
      invoke(IPC_CHANNELS.uploadListImages, req),
    /** 富文本图片库：按来源列出真实目录（含空目录），返回相对路径数组 */
    listDirectories: (req: unknown): Promise<string[]> =>
      invoke(IPC_CHANNELS.uploadListDirectories, req),
  },
  os: {
    pickFile: (opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean; defaultPath?: string }): Promise<string[]> =>
      invoke(IPC_CHANNELS.osPickFile, opts),
    pickDir: (opts?: { defaultPath?: string }): Promise<string> => invoke(IPC_CHANNELS.osPickDir, opts),
    /** 图片预览：本地图片转 data URI（限 10MB） */
    readDataUri: (file: string): Promise<string> => invoke(IPC_CHANNELS.osReadDataUri, file),
    /** 文本写盘：路径来自 pickSave */
    writeText: (path: string, content: string): Promise<boolean> => invoke(IPC_CHANNELS.osWriteText, path, content),
    /** 二进制写盘（base64 → 文件）：下载 PNG 等场景；路径来自 pickSave */
    writeBinary: (path: string, base64: string): Promise<boolean> => invoke(IPC_CHANNELS.osWriteBinary, path, base64),
    /** 保存对话框（导出备份等）；defaultPath 作为默认目录/起始路径，fileName 为默认文件名 */
    pickSave: (opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }): Promise<string> =>
      invoke(IPC_CHANNELS.osPickSave, opts),
    clipboardWrite: (text: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.osClipboardWrite, text),
    shellOpen: (target: string): Promise<boolean> => invoke(IPC_CHANNELS.osShellOpen, target),
  },
  badge: {
    parseDatasource: (file: string): Promise<unknown> => invoke(IPC_CHANNELS.badgeParseDatasource, file),
    readHtml: (file: string): Promise<{ html: string; hash: string }> =>
      invoke(IPC_CHANNELS.badgeReadHtml, file),
    markBadges: (payload: unknown): Promise<string> => invoke(IPC_CHANNELS.badgeMarkBadges, payload),
    generate: (payload: unknown): Promise<{ posterId: string; badgedRel: string; html: string; matchCounts: Record<string, number> }> =>
      invoke(IPC_CHANNELS.badgeGenerate, payload),
    /** N5 源更新检测：对比 poster.sourceHash 与源邮件当前指纹 */
    sourceState: (payload?: { posterIds?: string[] }): Promise<{ rows: { posterId: string; stale: boolean; sourceRel: string | null; mailId: string | null }[] }> =>
      invoke(IPC_CHANNELS.badgeSourceState, payload),
    savePosterPng: (payload: { posterId: string; base64: string }): Promise<string> =>
      invoke(IPC_CHANNELS.badgeSavePosterPng, payload),
    listPosters: (): Promise<unknown[]> => invoke(IPC_CHANNELS.badgeListPosters),
    exportFiles: (payload: { posterIds: string[]; outPath: string }): Promise<{ outPath: string; posters: number }> =>
      invoke(IPC_CHANNELS.badgeExportFiles, payload),
    savePosterMeta: (payload: { posterId: string; name?: string; configSnapshot?: { badgeAttr: string; clicksField: string; badgePositionText?: string; badgePositionImage?: string; posterWidth?: number; scale?: number } }): Promise<boolean> =>
      invoke(IPC_CHANNELS.badgeSavePosterMeta, payload),
    deletePoster: (posterId: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.badgeDeletePoster, posterId),
    downloadPng: (payload: { posterId: string; outPath: string }): Promise<{ outPath: string }> =>
      invoke(IPC_CHANNELS.badgeDownloadPng, payload),
    templateDownload: (fmt: 'xlsx' | 'csv' | 'json'): Promise<{ base64: string; fileName: string }> =>
      invoke(IPC_CHANNELS.badgeTemplateDownload, fmt),
    parseImage: (payload: {
      file: string
      provider: 'cloud' | 'paddleocr' | 'manual'
      providerId?: string
      model?: string
      paddleCommand?: string
      paddleArgs?: string
      ocrLayout?: Record<string, unknown>
    }): Promise<{ rows: { url: string; clicks: number; totalClicks: number; metrics?: Record<string, number> }[]; warnings: string[]; csv: string; raw: string }> =>
      invoke(IPC_CHANNELS.badgeParseImage, payload),
    setVisionKey: (key: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.badgeSetVisionKey, key),
    visionState: (): Promise<{ hasKey: boolean }> =>
      invoke(IPC_CHANNELS.badgeVisionState),
  },
  logs: {
    /** 渲染层日志上报（单向 send，不等待返回；经主进程脱敏落盘） */
    logFront: (payload: { level: 'debug' | 'info' | 'warn' | 'error'; scope: string; msg: string; detail?: unknown }): void => {
      ipcRenderer.send(IPC_CHANNELS.logFrontend, payload)
    },
    getDir: (): Promise<{ dir: string; sizeBytes: number; files: { name: string; sizeBytes: number }[] }> =>
      invoke(IPC_CHANNELS.logDirGet),
    clean: (): Promise<{ removed: number }> => invoke(IPC_CHANNELS.logClean),
  },
  diagnostics: {
    /** N1 采集诊断数据（只含布尔/名称/计数，可直接预览） */
    collect: (): Promise<import('@sshk/shared').DiagnosisData> => invoke(IPC_CHANNELS.diagCollect),
    /** N1 导出诊断 zip（report.md + 近 3 天日志），路径必须来自 pickSave */
    save: (outPath: string): Promise<{ file: string; logs: number }> => invoke(IPC_CHANNELS.diagExport, outPath),
  },
  usage: {
    /** D-Q1 用量统计（分组汇总 + 最近 200 条明细）；since 为北京时间 ISO 前缀或 null=全部 */
    stats: (since?: string | null): Promise<import('@sshk/shared').UsageStatsPayload> =>
      invoke(IPC_CHANNELS.usageStats, since ?? null),
    /** 清空用量明细；keepDays=0 全清，否则只删早于 N 天的记录 */
    clear: (keepDays?: number): Promise<{ removed: number }> => invoke(IPC_CHANNELS.usageClear, keepDays ?? 0),
  },
  tools: {
    /** 主进程裁决后的工具目录；返回值不含任何密钥明文 */
    list: (): Promise<unknown> => invoke(IPC_CHANNELS.toolsList),
    setEnabled: (id: string, enabled: boolean): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsSetEnabled, id, enabled),
    setGrant: (id: string, grant: string): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsSetGrant, id, grant),
    setDependencies: (id: string, ids: string[]): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsSetDependencies, id, ids),
    setOverrides: (id: string, overrides: Record<string, string>): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsSetOverrides, id, overrides),
    setDistribution: (ids: string[] | null): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsSetDistribution, ids),
    cleanupOrphans: (): Promise<unknown> =>
      invoke(IPC_CHANNELS.toolsCleanupOrphans),
    /** N2 工具健康度：聚合目录裁决 + 插件状态 + 日志 error 检索（无敏感信息） */
    health: (): Promise<import('@sshk/shared').ToolHealthPayload> => invoke(IPC_CHANNELS.toolsHealth),
  },
  /** U2 验证引导：会话存取 + main 侧自动判定 */
  verify: {
    load: (date?: string): Promise<import('@sshk/shared').VerifySession | null> =>
      invoke(IPC_CHANNELS.verifySessionLoad, date),
    save: (session: import('@sshk/shared').VerifySession): Promise<string> =>
      invoke(IPC_CHANNELS.verifySessionSave, session),
    list: (): Promise<string[]> => invoke(IPC_CHANNELS.verifySessionList),
    autoCheck: (req: { kind: string; spec: string }): Promise<{ state: string; detail: string }> =>
      invoke(IPC_CHANNELS.verifyAutoCheck, req),
  },
  presets: {
    /** 导出配置预设；includeSecrets=true 携带明文密钥（需用户显式开启），路径必须来自 pickSave */
    export: (outPath: string, includeSecrets = false): Promise<{ file: string; providers: number; uploadProfiles: number; secrets: number }> =>
      invoke(IPC_CHANNELS.presetExport, { outPath, includeSecrets }),
    /** N3 导入配置预设（按 id 合并），路径必须来自 pickFile */
    import: (filePath: string): Promise<{ providersMerged: number; uploadProfilesMerged: number }> =>
      invoke(IPC_CHANNELS.presetImport, filePath),
  },
  snapshots: {
    /** N4 回滚快照：列表（时间倒序） */
    list: (): Promise<import('@sshk/repository').OutputSnapshotEntry[]> =>
      invoke(IPC_CHANNELS.snapshotList),
    /** 恢复快照到原路径（覆盖当前产物） */
    restore: (id: string): Promise<string> => invoke(IPC_CHANNELS.snapshotRestore, id),
    /** 清空全部快照 */
    clear: (): Promise<{ removed: number }> => invoke(IPC_CHANNELS.snapshotClear),
  },
  backup: {
    export: (zipPath: string, passphrase?: string): Promise<unknown> =>
      invoke(IPC_CHANNELS.backupExport, zipPath, passphrase),
    import: (zipPath: string, passphrase?: string): Promise<unknown> =>
      invoke(IPC_CHANNELS.backupImport, zipPath, passphrase),
  },
  runtime: {
    preview: (zipPath: string): Promise<unknown> => invoke(IPC_CHANNELS.runtimePreview, zipPath),
    install: (zipPath: string, explicitlyTrusted?: boolean): Promise<unknown> =>
      invoke(IPC_CHANNELS.runtimeInstall, zipPath, explicitlyTrusted),
    list: (): Promise<unknown[]> => invoke(IPC_CHANNELS.runtimeList),
    uninstall: (id: string): Promise<boolean> => invoke(IPC_CHANNELS.runtimeUninstall, id),
    readRenderer: (packageId: string): Promise<string> => invoke(IPC_CHANNELS.runtimeReadRenderer, packageId),
    keysList: (): Promise<unknown[]> => invoke(IPC_CHANNELS.runtimeKeysList),
    keysImport: (label: string, pem: string): Promise<unknown> => invoke(IPC_CHANNELS.runtimeKeysImport, label, pem),
    keysRevoke: (keyId: string): Promise<boolean> => invoke(IPC_CHANNELS.runtimeKeysRevoke, keyId),
  },
  accessKey: {
    /** 仅写入 safeStorage；明文不会回传渲染层 */
    set: (key: string): Promise<unknown> => invoke(IPC_CHANNELS.accessKeySet, key),
  },
  /** 开发者工具：仅源码开发环境可用；打包版 state().available=false，UI 会禁用入口 */
  dev: {
    state: (): Promise<{ available: boolean; repoRoot: string | null; reason: string }> =>
      invoke(IPC_CHANNELS.devState),
    manifestGet: (id: string): Promise<string> => invoke(IPC_CHANNELS.devManifestGet, id),
    manifestSet: (id: string, raw: string): Promise<{ ok: boolean; output: string; catalog?: unknown }> =>
      invoke(IPC_CHANNELS.devManifestSet, id, raw),
    verify: (): Promise<{ ok: boolean; output: string }> => invoke(IPC_CHANNELS.devVerify),
    build: (): Promise<{ ok: boolean; output: string }> => invoke(IPC_CHANNELS.devBuild),
    buildExternal: (id: string): Promise<{ ok: boolean; output: string }> =>
      invoke(IPC_CHANNELS.devBuildExternal, id),
    pack: (id: string, sign?: boolean): Promise<{ ok: boolean; output: string }> =>
      invoke(IPC_CHANNELS.devPack, id, Boolean(sign)),
    /** 仅 dev：按向导表单生成整套工具骨架（目录已存在会拒绝） */
    create: (req: unknown): Promise<{ ok: boolean; output: string; catalog?: unknown }> =>
      invoke(IPC_CHANNELS.devToolCreate, req),
    /** U1-1 L1 提示层：扫描 tools/ 发现清单外的新工具（打包版恒空） */
    toolScan: (): Promise<{ newTools: { id: string; name: string }[] }> =>
      invoke(IPC_CHANNELS.devToolScan),
  },
  /**
   * 通用通道调用：供工具（含运行时外部包）调用各自 main 注册的专属通道。
   * 通道是否允许由主进程在注册时裁决（外部包受 manifest 的 plugin.channels 约束），
   * 渲染层走此处统一出口，入参同样经 toPlain 脱壳。
   */
  ipc: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => invoke(channel, ...args),
  },
  edm: {
    /** action 白名单单通道：brands / tpl / frg / mail / share */
    api: (action: string, data?: Record<string, unknown>): Promise<unknown> =>
      invoke(IPC_CHANNELS.edmApi, { action, data }),
  },
  /** X6 文件系统：已配置上传通道的远端/云浏览管理 + 统一传输队列（密钥只在 main） */
  fs: {
    profiles: (): Promise<import('@sshk/shared').FsProfilesPayload> => invoke(IPC_CHANNELS.fsProfiles),
    list: (req: { profileId: string; path: string; cursor?: string | null }): Promise<import('@sshk/shared').FsListPage> =>
      invoke(IPC_CHANNELS.fsList, req),
    stat: (req: { profileId: string; path: string }): Promise<import('@sshk/shared').FsStatResult> =>
      invoke(IPC_CHANNELS.fsStat, req),
    mkdir: (req: { profileId: string; path: string }): Promise<boolean> => invoke(IPC_CHANNELS.fsMkdir, req),
    rm: (req: import('@sshk/shared').FsRmRequest): Promise<{ taskIds: string[] }> => invoke(IPC_CHANNELS.fsRm, req),
    cp: (req: import('@sshk/shared').FsCpRequest): Promise<{ taskIds: string[] }> => invoke(IPC_CHANNELS.fsCp, req),
    mv: (req: import('@sshk/shared').FsMvRequest): Promise<boolean> => invoke(IPC_CHANNELS.fsMv, req),
    /** 跨通道复制：目录在 main 侧递归展开为文件任务，走传输队列 */
    crossCopy: (req: import('@sshk/shared').FsCrossCopyRequest): Promise<import('@sshk/shared').FsCrossCopyResult> =>
      invoke(IPC_CHANNELS.fsCrossCopy, req),
    /** 递归搜索：path 前缀内按名称子串匹配（'' = 整个通道） */
    search: (req: import('@sshk/shared').FsSearchRequest): Promise<import('@sshk/shared').FsSearchResult> =>
      invoke(IPC_CHANNELS.fsSearch, req),
    /** 目录容量统计（文件总字节与个数，可能截断） */
    usage: (req: { profileId: string; path: string }): Promise<import('@sshk/shared').FsUsageResult> =>
      invoke(IPC_CHANNELS.fsUsage, req),
    read: (req: { profileId: string; path: string; maxBytes?: number }): Promise<import('@sshk/shared').FsReadResult> =>
      invoke(IPC_CHANNELS.fsRead, req),
    write: (req: import('@sshk/shared').FsWriteRequest): Promise<boolean> => invoke(IPC_CHANNELS.fsWrite, req),
    transferStart: (inputs: import('@sshk/shared').FsTransferInput[]): Promise<{ taskIds: string[] }> =>
      invoke(IPC_CHANNELS.fsTransferStart, inputs),
    transferList: (): Promise<import('@sshk/shared').FsTransferTask[]> => invoke(IPC_CHANNELS.fsTransferList),
    transferCancel: (ids: string[]): Promise<boolean> => invoke(IPC_CHANNELS.fsTransferCancel, ids),
    transferRetry: (ids: string[], overwrite?: boolean): Promise<boolean> =>
      invoke(IPC_CHANNELS.fsTransferRetry, ids, overwrite),
    transferClear: (): Promise<{ removed: number }> => invoke(IPC_CHANNELS.fsTransferClear),
    /** 主进程推送传输任务全量形态（进度/状态节流） */
    onTransferEvent: (callback: (task: import('@sshk/shared').FsTransferTask) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.fsTransferEvent, (_event, task) => callback(task))
    },
    /** 本地文件/目录选择（文件夹上传入口）；type=file|dir|any */
    pickUpload: (opts?: { type?: 'file' | 'dir' | 'any' }): Promise<string[]> =>
      invoke(IPC_CHANNELS.fsPickUpload, opts),
    /** 递归展平本地待上传路径（保留相对目录结构） */
    flattenLocal: (paths: string[]): Promise<import('@sshk/shared').FsLocalFile[]> =>
      invoke(IPC_CHANNELS.fsFlattenLocal, paths),
    /** 拖拽进窗口的 File → 本地绝对路径（webUtils.getPathForFile，非文件拖拽返回 ''） */
    pathForFile: (file: File): string => {
      try { return webUtils.getPathForFile(file) } catch { return '' }
    },
    /** 当前通道的下载落点目录（不存在会自动创建） */
    downloadDir: (profileId: string): Promise<string> => invoke(IPC_CHANNELS.fsDownloadDir, profileId),
    setDownloadDir: (dir: string): Promise<string> => invoke(IPC_CHANNELS.fsSetDownloadDir, dir),
  },
  /** ShareHub 常驻分享服务（plans/09）：工具侧路由管理。toolId 由调用方传入做归属鉴权 */
  shareHub: {
    create: (input: import('@sshk/shared').ShareRouteInput): Promise<import('@sshk/shared').ShareRouteTicket> =>
      invoke(IPC_CHANNELS.shareHubCreate, input),
    list: (toolId?: string): Promise<import('@sshk/shared').ShareRouteInfo[]> =>
      invoke(IPC_CHANNELS.shareHubList, toolId),
    revoke: (id: string, toolId?: string): Promise<boolean> =>
      invoke(IPC_CHANNELS.shareHubRevoke, id, toolId),
    renew: (id: string, ttlHours: number, toolId?: string): Promise<import('@sshk/shared').ShareRouteTicket> =>
      invoke(IPC_CHANNELS.shareHubRenew, id, ttlHours, toolId),
    status: (): Promise<import('@sshk/shared').HubStatus> => invoke(IPC_CHANNELS.shareHubStatus),
  },
  /** 生命周期控制：仅宿主「分享服务」tab 可用 */
  shareHubControl: {
    start: (): Promise<{ port: number }> => invoke(IPC_CHANNELS.shareHubControl, 'start'),
    restart: (): Promise<{ port: number }> => invoke(IPC_CHANNELS.shareHubControl, 'restart'),
    stop: (): Promise<{ port: number }> => invoke(IPC_CHANNELS.shareHubControl, 'stop'),
    clear: (): Promise<{ port: number }> => invoke(IPC_CHANNELS.shareHubControl, 'clear'),
  },
}

// 暴露到 sshkApiBridge 而非 api：exposeInMainWorld 的属性是只读的，
// 渲染层无法覆盖 window.api；由渲染层 installPlainApi() 把它包装成 window.api。
contextBridge.exposeInMainWorld('sshkApiBridge', api)
