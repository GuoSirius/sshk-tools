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
    }
    update: {
      check(): Promise<{ dev?: boolean; updateAvailable?: boolean; version?: string | null }>
      quitAndInstall(): Promise<void>
    }
    llm: {
      chat(
        provider: LlmProvider,
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
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
  }
}
