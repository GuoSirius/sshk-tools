// 源码为 ESM/TS，electron-vite 构建为 out/preload/index.cjs（CommonJS）。
// sandbox: true 下 preload 只能由 require 加载，因此产物固定 CJS 且只做白名单桥接。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@sshk/shared'

const api = {
  config: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.configGet, key),
    set: (key: string, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.configSet, key, value),
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
}

contextBridge.exposeInMainWorld('api', api)
