/// <reference path="../types/vite-glob.d.ts" />

declare module 'virtual:uno.css'
/** CSS 副作用导入：TS 6 起会校验 side-effect import，本地声明即可，不依赖 vite/client 类型包 */
declare module '*.css'
declare module '*.scss'
declare module '*.svg' {
  const url: string
  export default url
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface LlmProvider {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  model: string
  enabled: boolean
}

/** 主进程推送的 autoUpdater 全生命周期状态 */
interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev'
  version?: string
  percent?: number
  error?: string
}

interface PosterRecord {
  _id: string
  name: string
  source: { type: 'mail' | 'upload'; mailId?: string; htmlPath: string }
  datasources: { file: string; kind: string; ocrReviewed?: boolean }[]
  configSnapshot: { badgeAttr: string; clicksField: string; posterWidth: number; scale: number; badgePositionText?: string; badgePositionImage?: string }
  outputs: { badged?: string; poster?: string }
  statsSnapshot?: Record<string, unknown>[]
  status: string
  lastGeneratedAt?: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

interface Window {
  api: {
    config: {
      get(key: string): Promise<unknown>
      set(key: string, value: unknown): Promise<boolean>
      onChanged(callback: (payload: { namespace: string; key: string }) => void): void
    }
    theme: {
      set(mode: string): Promise<boolean>
      onSystemChanged(callback: () => void): void
    }
    app: {
      version(): Promise<string>
      openDataDir(): Promise<void>
      reload(force?: boolean): Promise<boolean>
      toggleDevTools(key?: string): Promise<boolean>
      /** 主进程在窗口关闭前回调：渲染层据此弹出主题色确认框 */
      onRequestClose(callback: () => void): void
      /** 渲染层确认关闭后调用：主进程置 quitting 并真正退出 */
      confirmClose(): Promise<boolean>
    }
    update: {
      check(): Promise<{ dev?: boolean; updateAvailable?: boolean; version?: string | null; error?: string }>
      download(): Promise<boolean>
      quitAndInstall(): Promise<void>
      onState(callback: (payload: UpdateState) => void): void
    }
    llm: {
      chat(
        provider: LlmProvider,
        messages: {
          role: 'system' | 'user' | 'assistant'
          content: string | Array<
            { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
          >
        }[],
        options?: { onDelta?: boolean },
      ): Promise<{ content: string; model: string }>
      onDelta(callback: (delta: string) => void): void
      /** apiKey 可选：保存 Provider 前用刚填的 key 探测；不传则读主进程 safeStorage */
      listModels(provider: LlmProvider, apiKey?: string): Promise<string[]>
      healthCheck(provider: LlmProvider, apiKey?: string): Promise<{ ok: boolean; message: string; latencyMs?: number }>
      setApiKey(providerId: string, apiKey: string): Promise<boolean>
      /** 编辑时按需查看已存密钥（用户主动点击） */
      getApiKey(providerId: string): Promise<string>
      /** 应用级 Provider 只读清单（不含密钥）；所有工具共用一份配置 */
      providers(): Promise<import('@sshk/shared').LlmProviderInfo[]>
      /** 按 Provider id 查 /models；不落盘密钥 */
      providerModels(providerId: string, apiKey?: string): Promise<string[]>
    }
    os: {
      pickFile(opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]>
      pickDir(): Promise<string>
      pickSave(opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }): Promise<string>
      readDataUri(file: string): Promise<string>
      writeText(path: string, content: string): Promise<boolean>
      clipboardWrite(text: string): Promise<boolean>
      shellOpen(target: string): Promise<boolean>
    }
    badge: {
      parseDatasource(file: string): Promise<{ kind: string; rows: { url: string; clicks: number; totalClicks: number }[]; warnings: string[] }>
      readHtml(file: string): Promise<{ html: string; hash: string }>
      markBadges(payload: unknown): Promise<string>
      generate(payload: unknown): Promise<{ posterId: string; badgedRel: string; html: string; matchCounts: Record<string, number> }>
      savePosterPng(payload: { posterId: string; base64: string }): Promise<string>
      listPosters(): Promise<PosterRecord[]>
      savePosterMeta(payload: { posterId: string; name?: string; configSnapshot?: { badgeAttr: string; clicksField: string; badgePositionText?: string; badgePositionImage?: string } }): Promise<boolean>
      deletePoster(posterId: string): Promise<boolean>
      exportFiles(payload: { posterIds: string[]; outPath: string }): Promise<{ outPath: string; posters: number }>
      parseImage(payload: {
        file: string
        provider: 'cloud' | 'paddleocr' | 'manual'
        providerId?: string
        model?: string
        paddleCommand?: string
        paddleArgs?: string
        ocrLayout?: import('@sshk/badge-studio').OcrLayoutConfig
      }): Promise<{
        rows: { url: string; clicks: number; totalClicks: number; metrics?: Record<string, number> }[]
        warnings: string[]
        csv: string
        raw: string
      }>
      setVisionKey(key: string): Promise<boolean>
      visionState(): Promise<{ hasKey: boolean }>
    }
    tools: {
      list(): Promise<import('@sshk/shared').ToolCatalogPayload>
      setEnabled(id: string, enabled: boolean): Promise<import('@sshk/shared').ToolCatalogPayload>
      setGrant(id: string, grant: string): Promise<import('@sshk/shared').ToolCatalogPayload>
      setDependencies(id: string, ids: string[]): Promise<import('@sshk/shared').ToolCatalogPayload>
      setOverrides(id: string, overrides: Record<string, string>): Promise<import('@sshk/shared').ToolCatalogPayload>
      setDistribution(ids: string[] | null): Promise<import('@sshk/shared').ToolCatalogPayload>
      cleanupOrphans(): Promise<import('@sshk/shared').ToolCatalogPayload>
    }
    backup: {
      export(zipPath: string, passphrase?: string): Promise<{ counts: Record<string, number>; file: string }>
      import(zipPath: string, passphrase?: string): Promise<{ counts: Record<string, number>; secretsRestored: number; secretsMessage: string }>
    }
    runtime: {
      preview(zipPath: string): Promise<import('@sshk/shared').InstallPreview>
      install(zipPath: string, explicitlyTrusted?: boolean): Promise<{ record: import('@sshk/shared').InstalledPackageRecord; warnings: string[] }>
      list(): Promise<import('@sshk/shared').InstalledPackageRecord[]>
      uninstall(id: string): Promise<boolean>
      readRenderer(packageId: string): Promise<string>
      keysList(): Promise<{ keyId: string; label: string; importedAt: string }[]>
      keysImport(label: string, pem: string): Promise<{ keyId: string; label: string }>
      keysRevoke(keyId: string): Promise<boolean>
    }
    accessKey: {
      set(key: string): Promise<import('@sshk/shared').ToolCatalogPayload>
    }
    /** 开发者工具：仅源码开发环境可用；state().available=false 时 UI 禁用入口 */
    dev: {
      state(): Promise<{ available: boolean; repoRoot: string | null; reason: string }>
      manifestGet(id: string): Promise<string>
      manifestSet(id: string, raw: string): Promise<{ ok: boolean; output: string }>
      verify(): Promise<{ ok: boolean; output: string }>
      build(): Promise<{ ok: boolean; output: string }>
      buildExternal(id: string): Promise<{ ok: boolean; output: string }>
      pack(id: string, sign?: boolean): Promise<{ ok: boolean; output: string }>
    }
    /** 通用通道调用：工具（含运行时外部包）调用各自 main 注册的专属通道 */
    ipc: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
    }
    edm: {
      api(action: string, data?: Record<string, unknown>): Promise<unknown>
    }
  }
}
