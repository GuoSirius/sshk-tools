import { reactive } from 'vue'

/**
 * E-T2 上传进度事件消费（upload:progress）：全局单例会话状态。
 * upload.ts 发起上传前 beginUploadSession(n)，结束 endUploadSession()；
 * 进度事件由 main → preload 全局推送，本模块按文件名聚合为汇总百分比。
 * UploadProgressToast 负责渲染；不记密钥、只记文件名与状态。
 */
export interface UploadItemState { name: string; percent: number; status: string; error?: string }

export const uploadSession = reactive({
  active: false,
  total: 0,
  items: [] as UploadItemState[],
  /** 汇总 0-100 */
  percent: 0,
  succeeded: 0,
  failed: 0,
  errors: [] as string[],
})

let subscribed = false
/** EdmStudioPage 挂载时调用一次；幂等 */
export function subscribeUploadProgress(): void {
  // 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
  // eslint-disable-next-line no-restricted-syntax
  if (subscribed || typeof window === 'undefined' || !window.api?.upload?.onProgress) return
  subscribed = true
  // 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
  // eslint-disable-next-line no-restricted-syntax
  window.api.upload.onProgress((p: UploadItemState) => {
    const session = uploadSession
    if (!session.active) return
    // 同名文件取最后一个未完结项（内联图片批量可能重名）；没有则新建
    let item = [...session.items].reverse().find((i) => i.name === p.name && i.status !== 'success' && i.status !== 'failed')
    if (!item) {
      item = { name: p.name, percent: 0, status: 'uploading' }
      session.items.push(item)
    }
    item.percent = p.percent
    item.status = p.status
    item.error = p.error
    if (p.status === 'failed' && p.error) session.errors.push(`${p.name}：${p.error}`)
    recompute()
  })
}

export function beginUploadSession(total: number): void {
  uploadSession.active = true
  uploadSession.total = total
  uploadSession.items = []
  uploadSession.percent = 0
  uploadSession.succeeded = 0
  uploadSession.failed = 0
  uploadSession.errors = []
}

let hideTimer: ReturnType<typeof setTimeout> | null = null
/** 上传结束：成功立即算好汇总，3s 后自动隐藏（让用户看到 100%） */
export function endUploadSession(): void {
  recompute()
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    uploadSession.active = false
    hideTimer = null
  }, 3000)
}

function recompute(): void {
  const session = uploadSession
  if (session.items.length === 0) return
  const sum = session.items.reduce((acc, i) => acc + (i.status === 'success' ? 100 : i.percent), 0)
  session.percent = session.total > 0 ? Math.min(100, Math.round(sum / session.total)) : 0
  session.succeeded = session.items.filter((i) => i.status === 'success').length
  session.failed = session.items.filter((i) => i.status === 'failed').length
}
