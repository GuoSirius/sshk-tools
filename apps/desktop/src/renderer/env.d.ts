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

interface Window {
  api: {
    config: {
      get(key: string): Promise<unknown>
      set(key: string, value: unknown): Promise<boolean>
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
  }
}
