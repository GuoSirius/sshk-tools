import { ref, type Ref } from 'vue'

/**
 * 自动更新状态（主进程经 IPC 推送）。
 * 主进程是唯一真相源：检查 / 发现 / 下载进度 / 完成 / 失败 都从这里读，
 * 渲染层不再各写一份 toast 或轮询。
 */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev'
  version?: string
  percent?: number
  error?: string
}

const state: Ref<UpdateState> = ref<UpdateState>({ phase: 'idle' })
let registered = false

function ensureRegistered(): void {
  if (registered) return
  registered = true
  window.api.update.onState((payload: UpdateState) => {
    if (payload && typeof payload === 'object') state.value = payload
  })
}

/** 全局共享同一份更新状态：顶栏指示器、更新横幅、设置页卡片都从这里读 */
export function useUpdater(): { state: Ref<UpdateState> } {
  ensureRegistered()
  return { state }
}
