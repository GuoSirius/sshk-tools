/// <reference types="vite/client" />

declare module 'virtual:uno.css'
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
      toggleDevTools(): Promise<boolean>
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
      listModels(provider: LlmProvider): Promise<string[]>
      healthCheck(provider: LlmProvider): Promise<{ ok: boolean; message: string; latencyMs?: number }>
      setApiKey(providerId: string, apiKey: string): Promise<boolean>
    }
    os: {
      pickFile(opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]>
      pickDir(): Promise<string>
      clipboardWrite(text: string): Promise<boolean>
      shellOpen(target: string): Promise<boolean>
    }
    badge: {
      parseDatasource(file: string): Promise<{ kind: string; rows: { url: string; clicks: number; totalClicks: number }[]; warnings: string[] }>
      readHtml(file: string): Promise<{ html: string; hash: string }>
      markBadges(payload: unknown): Promise<string>
      generate(payload: unknown): Promise<{ posterId: string; badgedRel: string; html: string }>
      savePosterPng(payload: { posterId: string; base64: string }): Promise<string>
      listPosters(): Promise<PosterRecord[]>
      deletePoster(posterId: string): Promise<boolean>
      parseImage(payload: {
        file: string
        provider: 'cloud' | 'paddleocr' | 'manual'
        baseURL?: string
        model?: string
        paddleCommand?: string
        paddleArgs?: string
      }): Promise<{
        rows: { url: string; clicks: number; totalClicks: number }[]
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
    accessKey: {
      set(key: string): Promise<import('@sshk/shared').ToolCatalogPayload>
    }
    edm: {
      api(action: string, data?: Record<string, unknown>): Promise<unknown>
    }
  }
}
