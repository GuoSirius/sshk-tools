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

interface PosterRecord {
  _id: string
  name: string
  source: { type: 'mail' | 'upload'; mailId?: string; htmlPath: string }
  datasources: { file: string; kind: string; ocrReviewed?: boolean }[]
  configSnapshot: { badgeAttr: string; clicksField: string; posterWidth: number; scale: number }
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
    }
    update: {
      check(): Promise<{ dev?: boolean; updateAvailable?: boolean; version?: string | null }>
      quitAndInstall(): Promise<void>
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
      pickSave(opts?: { fileName?: string; extensions?: string[] }): Promise<string>
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
      deletePoster(posterId: string): Promise<boolean>
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
      install(zipPath: string, explicitlyTrusted?: boolean): Promise<{ record: import('@sshk/shared').InstalledPackageRecord; warnings: string[] }>
      list(): Promise<import('@sshk/shared').InstalledPackageRecord[]>
      uninstall(id: string): Promise<boolean>
    }
    accessKey: {
      set(key: string): Promise<import('@sshk/shared').ToolCatalogPayload>
    }
    edm: {
      api(action: string, data?: Record<string, unknown>): Promise<unknown>
    }
  }
}
