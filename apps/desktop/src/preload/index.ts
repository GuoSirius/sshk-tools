// 源码为 ESM/TS，electron-vite 构建为 out/preload/index.cjs（CommonJS）。
// sandbox: true 下 preload 只能由 require 加载，因此产物固定 CJS 且只做白名单桥接。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@sshk/shared'
import { toPlain } from './plain'

/**
 * 所有 IPC 入参统一在边界脱壳：Vue 的 ref/reactive Proxy 无法被结构化克隆。
 * 放在唯一出口，渲染层与各工具包（含后期外部工具）都无需自己 toRaw。
 * 注册类监听（ipcRenderer.on）不经过这里，回调函数保持原样。
 */
// 返回值类型由各方法自身的标注与 renderer/env.d.ts 约束，这里只统一处理入参。
const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args.map(toPlain))

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
  os: {
    pickFile: (opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]> =>
      invoke(IPC_CHANNELS.osPickFile, opts),
    pickDir: (): Promise<string> => invoke(IPC_CHANNELS.osPickDir),
    /** 图片预览：本地图片转 data URI（限 10MB） */
    readDataUri: (file: string): Promise<string> => invoke(IPC_CHANNELS.osReadDataUri, file),
    /** 文本写盘：路径来自 pickSave */
    writeText: (path: string, content: string): Promise<boolean> => invoke(IPC_CHANNELS.osWriteText, path, content),
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
  edm: {
    /** action 白名单单通道：brands / tpl / frg / mail / share */
    api: (action: string, data?: Record<string, unknown>): Promise<unknown> =>
      invoke(IPC_CHANNELS.edmApi, { action, data }),
  },
}

// 暴露到 sshkApiBridge 而非 api：exposeInMainWorld 的属性是只读的，
// 渲染层无法覆盖 window.api；由渲染层 installPlainApi() 把它包装成 window.api。
contextBridge.exposeInMainWorld('sshkApiBridge', api)
