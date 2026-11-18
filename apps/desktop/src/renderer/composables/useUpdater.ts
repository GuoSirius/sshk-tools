import { ref, type Ref } from 'vue'

/**
 * 自动更新状态（主进程经 IPC 推送）。
 * 主进程是唯一真相源：检查 / 发现 / 下载进度 / 完成 / 失败 都从这里读，
 * 渲染层不再各写一份 toast 或轮询。
 */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev' | 'disabled'
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
  // 启动兜底：订阅前主进程可能已推过 disabled/dev（当时窗口未建，推送落空），拉一次当前状态对齐
  void window.api.update.getState().then((s) => {
    if (s && typeof s.phase === 'string' && s.phase !== 'idle') state.value = s as UpdateState
  }).catch(() => { /* IPC 不可用时维持 idle 初始态 */ })
}

/** 全局共享同一份更新状态：顶栏指示器、更新横幅、设置页卡片都从这里读 */
export function useUpdater(): { state: Ref<UpdateState> } {
  ensureRegistered()
  return { state }
}
