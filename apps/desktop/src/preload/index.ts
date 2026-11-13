// 源码为 ESM/TS，electron-vite 构建为 out/preload/index.cjs（CommonJS）。
// sandbox: true 下 preload 只能由 require 加载，因此产物固定 CJS 且只做白名单桥接。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@sshk/shared'

const api = {
  config: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.configGet, key),
    set: (key: string, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.configSet, key, value),
    onChanged: (callback: (payload: { namespace: string; key: string }) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.configChanged, (_event, payload) => callback(payload))
    },
  },
  theme: {
    set: (mode: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.configSet, 'app.themeMode', mode),
    onSystemChanged: (callback: () => void): void => {
      ipcRenderer.on(IPC_CHANNELS.themeSystemChanged, () => callback())
    },
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
    openDataDir: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appOpenDataDir),
  },
  update: {
    check: (): Promise<{ dev?: boolean; updateAvailable?: boolean; version?: string | null }> =>
      ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.updateQuitAndInstall),
  },
  llm: {
    /** 密钥在主进程注入，渲染层只传 provider 元信息 */
    chat: (
      provider: unknown,
      messages: unknown,
      options?: { onDelta?: boolean },
    ): Promise<{ content: string; model: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.llmChat, provider, messages, options),
    /** 流式回调经事件通道分片推送 */
    onDelta: (callback: (delta: string) => void): void => {
      ipcRenderer.on(IPC_CHANNELS.llmChat, (_event, payload: { delta?: string }) => {
        if (typeof payload?.delta === 'string') callback(payload.delta)
      })
    },
    listModels: (provider: unknown): Promise<string[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.llmListModels, provider),
    healthCheck: (provider: unknown): Promise<{ ok: boolean; message: string; latencyMs?: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.llmHealthCheck, provider),
    setApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.llmSetApiKey, providerId, apiKey),
  },
  os: {
    pickFile: (opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.osPickFile, opts),
    pickDir: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.osPickDir),
    clipboardWrite: (text: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.osClipboardWrite, text),
    shellOpen: (target: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.osShellOpen, target),
  },
  badge: {
    parseDatasource: (file: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.badgeParseDatasource, file),
    readHtml: (file: string): Promise<{ html: string; hash: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.badgeReadHtml, file),
    markBadges: (payload: unknown): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.badgeMarkBadges, payload),
    generate: (payload: unknown): Promise<{ posterId: string; badgedRel: string; html: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.badgeGenerate, payload),
    savePosterPng: (payload: { posterId: string; base64: string }): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.badgeSavePosterPng, payload),
    listPosters: (): Promise<unknown[]> => ipcRenderer.invoke(IPC_CHANNELS.badgeListPosters),
    deletePoster: (posterId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.badgeDeletePoster, posterId),
  },
  tools: {
    /** 主进程裁决后的工具目录；返回值不含任何密钥明文 */
    list: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.toolsList),
    setEnabled: (id: string, enabled: boolean): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolsSetEnabled, id, enabled),
    setGrant: (id: string, grant: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolsSetGrant, id, grant),
    setOverrides: (id: string, overrides: Record<string, string>): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolsSetOverrides, id, overrides),
    setDistribution: (ids: string[] | null): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolsSetDistribution, ids),
    cleanupOrphans: (): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolsCleanupOrphans),
  },
  accessKey: {
    /** 仅写入 safeStorage；明文不会回传渲染层 */
    set: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.accessKeySet, key),
  },
  edm: {
    /** action 白名单单通道：brands / tpl / frg / mail / share */
    api: (action: string, data?: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.edmApi, { action, data }),
  },
}

contextBridge.exposeInMainWorld('api', api)
