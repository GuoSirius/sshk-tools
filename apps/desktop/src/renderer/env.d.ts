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
  /** 默认模型名 */
  model: string
  /** 回退模型名：默认模型失败后自动回退再试，可留空 */
  fallbackModel?: string
  /** 每个模型失败后的额外重试次数（0-5），默认 0 */
  maxRetries?: number
  enabled: boolean
}

/** 主进程推送的 autoUpdater 全生命周期状态 */
interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev' | 'disabled'
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
  /** 生成后的标记核对数据（2026-11-18 起数组形态落库，badge main 写入、workspace 回显读取） */
  markCounts?: Array<{ url: string; count: number }>
  status: string
  lastGeneratedAt?: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

/**
 * window.api 类型真相源 = preload/src/preload/index.ts 的 api 对象（P0-5 · O5）。
 * 此前手工维护一份 300 行镜像声明，preload 每加一个通道都要同步两处（曾漏）；
 * 改为 typeof 推导后单一真相源，preload 增删通道渲染层类型零改动自动跟随。
 */
type SshkApi = import('../preload/index').SshkApi

interface Window {
  /** P0-5（O5）：类型真相源 = preload 的 api 对象（typeof 推导），本文件不再手工镜像 300 行 */
  api: SshkApi
}
