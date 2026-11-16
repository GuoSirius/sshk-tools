// 源码为 ESM/TS，electron-vite 构建为 out/preload/index.cjs（CommonJS）。
// sandbox: true 下 preload 只能由 require 加载，因此产物固定 CJS 且只做白名单桥接。
import { contextBridge, ipcRenderer } from 'electron'
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
    openDataDir: (): Promise<void> => invoke(IPC_CHANNELS.appOpenDataDir),
    /** force=true 走 reloadIgnoringCache（等价 Ctrl+F5） */
    reload: (force?: boolean): Promise<boolean> =>
      invoke(IPC_CHANNELS.appReload, Boolean(force)),
    toggleDevTools: (key?: string): Promise<boolean> => invoke(IPC_CHANNELS.appToggleDevTools, key),
    /** 只校验访问密钥、不打开 DevTools；开发者模式等敏感开关复用同套口令 */
    verifyDevtoolsKey: (key: string): Promise<boolean> => invoke(IPC_CHANNELS.appVerifyDevtoolsKey, key),
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
    quitAndInstall: (): Promise<void> => invoke(IPC_CHANNELS.updateQuitAndInstall),
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
      options?: { onDelta?: boolean },
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
    getConfig: (): Promise<unknown> => invoke(IPC_CHANNELS.uploadConfigGet),
    setConfig: (cfg: unknown): Promise<unknown> => invoke(IPC_CHANNELS.uploadConfigSet, cfg),
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
  },
  os: {
    pickFile: (opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]> =>
      invoke(IPC_CHANNELS.osPickFile, opts),
    pickDir: (): Promise<string> => invoke(IPC_CHANNELS.osPickDir),
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
    shareStart: (payload: { posterId: string; ttlHours?: number }): Promise<{ url: string; expiresAt: number }> =>
      invoke(IPC_CHANNELS.badgeShareStart, payload),
    shareStop: (): Promise<boolean> => invoke(IPC_CHANNELS.badgeShareStop),
    shareStatus: (): Promise<{ running: boolean; expiresAt: number }> =>
      invoke(IPC_CHANNELS.badgeShareStatus),
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
}

// 暴露到 sshkApiBridge 而非 api：exposeInMainWorld 的属性是只读的，
// 渲染层无法覆盖 window.api；由渲染层 installPlainApi() 把它包装成 window.api。
contextBridge.exposeInMainWorld('sshkApiBridge', api)
