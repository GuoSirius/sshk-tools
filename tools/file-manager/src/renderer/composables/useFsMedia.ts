import { fsApi } from './fsHost'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  FS_IMAGE_PREVIEW_LIMIT,
  FS_MEDIA_PLAY_LIMIT,
  FS_PDF_PREVIEW_LIMIT,
  FS_TEXT_EDIT_LIMIT,
  fsFormatSize,
  isFsImageName,
  isFsMediaName,
  isFsTextName,
  isFsVideoName,
  type FsEntry,
} from '@sshk/shared'
import { friendlyError } from './useFsListing'

/**
 * 打开/预览/编辑/播放（P4-4 自 FileExplorerPage 拆出）：
 * 图片/PDF 预览、文本编辑（冲突检测 §四）、音视频播放（直链优先 → 失败回退边下边播）、
 * 在线播放上限与「预览优先直链」开关（与上限设置弹框同一开关，初始从 transferCaps 拉取）。
 * 行为契约（与原页面逐字一致）：
 * - 直链决策（用户 2026-11-19 定版）：本地分享直链走本机 ShareHub 服务、零外网流量、恒优先；
 *   开关只管控云/远程域名直链。
 * - localres：边下边播唯一协议 localres://（渲染层无 file://）。
 * - 媒体进度订阅只更新当前正在播放的 mediaKey，避免多播放器串台。
 */
export interface FsMediaDeps {
  profileId: () => string
  /** 在线播放上限内/失败引导下载（页面装配时绑 useFsTransfer.downloadEntries） */
  downloadEntries: (entries: FsEntry[]) => Promise<void>
  /** 直链解析（本地=分享 ticket；远程/云=baseUrl+签名模板） */
  mediaDirectUrl: (entry: FsEntry) => Promise<string>
  channelType: () => string | undefined
  /** 编辑保存成功后追加式刷新列表（size/mtime 更新；原行为 void list(false)） */
  refreshList: () => void
}

/** 音视频播放器：source=direct 走直链（服务端 Range，无下载进度）；=stream 走主进程边下边播。
 *  dlUploaded/dlTotal/dlDone 仅 stream 模式有意义，来自主进程 fs:media:event。 */
export function useFsMedia(deps: FsMediaDeps) {
  const preview = ref({ open: false, name: '', src: '', pdfUrl: '', scale: 1 })
  /** 关闭预览：PDF 的 Blob URL 释放内存（图片走 data URI 无需释放） */
  function onPreviewClose(): void {
    if (preview.value.pdfUrl) { URL.revokeObjectURL(preview.value.pdfUrl); preview.value.pdfUrl = '' }
    preview.value.src = ''
    preview.value.scale = 1
  }
  const editor = ref({
    open: false, path: '', name: '', content: '', readonly: false, saving: false,
    etag: '', modified: 0, size: 0, conflict: false,
  })
  const player = ref({
    open: false, name: '', src: '', video: false, loading: false,
    source: 'stream' as 'direct' | 'stream',
    entry: null as FsEntry | null,
    mediaKey: '',
    dlUploaded: 0, dlTotal: 0, dlDone: false,
  })
  /** 订阅媒体下载进度：只更新当前正在播放的 mediaKey，避免多播放器串台 */
  let unsubMediaEvent: (() => void) | null = null
  function initMediaProgress(): void {
    if (unsubMediaEvent) return
    unsubMediaEvent = fsApi.onMediaEvent((e) => {
      if (!player.value.open || e.key !== player.value.mediaKey) return
      player.value.dlUploaded = e.uploaded
      player.value.dlTotal = e.total
      player.value.dlDone = e.done
    })
  }
  const dlPercent = computed(() => {
    if (!player.value.dlTotal) return 0
    return Math.min(100, Math.round((player.value.dlUploaded / player.value.dlTotal) * 100))
  })

  /** 音视频在线预览上限（字节，可配 app.fs.mediaLimitMb；Infinity=不限）——页面加载时拉一次 */
  const mediaLimitBytes = ref<number>(FS_MEDIA_PLAY_LIMIT)
  /** 预览优先用直链（默认开）：从 transferCaps 读取，与上限设置弹框同一开关 */
  const previewDirectLink = ref(true)
  async function loadMediaLimit(): Promise<void> {
    try {
      const caps = await fsApi.transferCaps()
      applyCaps(caps)
    } catch { /* 失败用共享常量缺省 */ }
  }
  /** 上限设置保存后同步（useFsTransfer.submitTransferCaps 回写同一状态） */
  function applyCaps(caps: { mediaLimitMb: number; previewDirectLink: boolean }): void {
    mediaLimitBytes.value = caps.mediaLimitMb === 0 ? Number.POSITIVE_INFINITY : caps.mediaLimitMb * 1024 * 1024
    previewDirectLink.value = caps.previewDirectLink !== false
  }
  const mediaLimitText = computed(() => mediaLimitBytes.value === Number.POSITIVE_INFINITY ? '不限' : fsFormatSize(mediaLimitBytes.value))

  /** 音视频播放（2026-11-19 重构）：
   *  直链优先（开关默认开）：有域名/分享直链则 <video src=直链>，服务端 Range、零下载；
   *  直链播放失败（签名过期/403/编码问题）→ onMediaError 自动回退到「主进程边下边播」；
   *  无直链或开关关 → 直接边下边播：readMedia 立即返回 localres URL，后台边下边写，进度可查。 */
  function openPlayer(entry: FsEntry): void {
    player.value = {
      open: true, name: entry.name, src: '', video: isFsVideoName(entry.name), loading: true,
      source: 'stream', entry, mediaKey: '', dlUploaded: 0, dlTotal: 0, dlDone: false,
    }
    // 直链决策（用户 2026-11-19 定版）：本地分享直链走本机 ShareHub 服务、零外网流量，
    // 不受「预览优先用直链」开关牵连、恒优先；开关只管控云/远程域名直链（流量/隐私针对外部域名）
    void deps.mediaDirectUrl(entry).then((url) => {
      // 弹框可能已被关闭 / 用户切了别的条目
      if (!player.value.open || player.value.entry !== entry) return
      const directOk = Boolean(url) && (previewDirectLink.value || deps.channelType() === 'local')
      if (directOk) startDirectPlay(url as string)
      else startStreamPlay(entry)
    }).catch(() => { if (player.value.open && player.value.entry === entry) startStreamPlay(entry) })
  }

  /** 直链播放：不动本地下载上限（不落盘）；失败由 onMediaError 回退 */
  function startDirectPlay(url: string): void {
    player.value.source = 'direct'
    player.value.src = url
    player.value.loading = false
  }

  /** 边下边播：超限仍走「下载后本地播放」确认；否则 readMedia 立即拿 URL，进度走事件 */
  function startStreamPlay(entry: FsEntry): void {
    if ((entry.size ?? 0) > mediaLimitBytes.value) {
      player.value.open = false
      confirmDownload(entry, `文件 ${fsFormatSize(entry.size)} 超过在线播放上限（${mediaLimitText.value}）`, '文件过大')
      return
    }
    player.value.source = 'stream'
    player.value.src = '' // 清掉可能残留的坏直链 src，避免 <video> 对旧源重复 error 误报
    player.value.loading = true
    player.value.dlUploaded = 0
    player.value.dlTotal = entry.size ?? 0
    player.value.dlDone = false
    void fsApi.readMedia({ profileId: deps.profileId(), path: entry.path })
      .then((r) => {
        if (!player.value.open || player.value.entry !== entry) return
        player.value.mediaKey = r.mediaKey
        player.value.dlTotal = r.size || player.value.dlTotal
        player.value.src = r.fileUrl
      })
      .catch((err) => {
        player.value.open = false
        const msg = (err as Error).message ?? ''
        if (/过大|超过/.test(msg)) confirmDownload(entry, msg, '文件过大')
        else ElMessage.warning(friendlyError(err))
      })
      .finally(() => { if (player.value.entry === entry) player.value.loading = false })
  }

  /** 媒体加载失败：直链失败 → 自动回退边下边播；边下边播失败 → 引导下载。
   *  MediaError code 便于定位：1=中断 2=网络（localres 403/503 等） 3=解码 4=源不支持（多为 CSP/URL 无效） */
  function onMediaError(e?: Event): void {
    const code = (e?.target as HTMLVideoElement | null)?.error?.code
    console.warn('[fs-player] media error code =', code, 'src =', player.value.src)
    const entry = player.value.entry
    if (player.value.source === 'direct' && entry) {
      startStreamPlay(entry) // 签名过期/403 等：静默回退，不打扰用户
      return
    }
    player.value.loading = false
    ElMessage.warning(`视频加载失败（code=${code ?? '?'}，可能是不支持的编码格式或下载中断），请下载后本地播放`)
  }

  /** 引导下载确认框（打开/预览失败、文件过大等场景统一入口，用户决定是否下载） */
  function confirmDownload(entry: FsEntry, message: string, title: string): void {
    ElMessageBox.confirm(`${message}。是否下载到本地？`, title, {
      type: 'warning', confirmButtonText: '下载', cancelButtonText: '取消',
      closeOnClickModal: false, closeOnPressEscape: false,
    }).then(() => { void deps.downloadEntries([entry]) }).catch(() => { /* 取消 */ })
  }

  /** PDF 在线预览：base64 → Blob URL，交给 Chromium 内置 PDF viewer（上限 FS_PDF_PREVIEW_LIMIT） */
  async function openPdf(entry: FsEntry): Promise<void> {
    if (!deps.profileId()) return
    try {
      const r = await fsApi.read({ profileId: deps.profileId(), path: entry.path, maxBytes: FS_PDF_PREVIEW_LIMIT })
      const bytes = Uint8Array.from(atob(r.contentBase64), (c) => c.charCodeAt(0))
      onPreviewClose()
      preview.value = { open: true, name: entry.name, src: '', pdfUrl: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), scale: 1 }
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (/过大|超过/.test(msg)) confirmDownload(entry, msg, '文件过大')
      else ElMessage.warning(friendlyError(err))
    }
  }

  async function openFile(entry: FsEntry): Promise<void> {
    if (!deps.profileId()) return
    if (/\.pdf$/i.test(entry.name)) { void openPdf(entry); return }
    if (isFsImageName(entry.name)) {
      try {
        const r = await fsApi.read({ profileId: deps.profileId(), path: entry.path, maxBytes: FS_IMAGE_PREVIEW_LIMIT })
        preview.value = { open: true, name: entry.name, src: dataUriOf(entry.name, r.contentBase64), pdfUrl: '', scale: 1 }
      } catch (err) {
        ElMessage.warning(friendlyError(err))
      }
      return
    }
    if (isFsTextName(entry.name)) {
      try {
        const r = await fsApi.read({ profileId: deps.profileId(), path: entry.path, maxBytes: FS_TEXT_EDIT_LIMIT })
        editor.value = {
          open: true, path: entry.path, name: entry.name,
          content: new TextDecoder().decode(Uint8Array.from(atob(r.contentBase64), (c) => c.charCodeAt(0))),
          etag: r.etag ?? '', modified: r.modified ?? 0, size: r.size,
          readonly: false, saving: false, conflict: false,
        }
      } catch (err) {
        const msg = (err as Error).message ?? ''
        // 仅「超阈值」引导下载；其余错误（网络/权限等）原样提示
        if (/过大|超过/.test(msg)) confirmDownload(entry, msg, '文件过大')
        else ElMessage.warning(friendlyError(err))
      }
      return
    }
    if (isFsMediaName(entry.name)) {
      openPlayer(entry)
      return
    }
    // 二进制 / 未知扩展：能打开的直接打开做不到，先告知用户再由其决定是否下载
    confirmDownload(entry, '该文件类型暂不支持在线预览，需要下载到本地查看', '无法在线预览')
  }

  function dataUriOf(name: string, base64: string): string {
    const mime = isFsImageName(name)
      ? (/\.svg$/i.test(name) ? 'image/svg+xml' : `image/${(/\.jpe?g$/i.test(name) ? 'jpeg' : (/\.ico$/i.test(name) ? 'x-icon' : (/\.bmp$/i.test(name) ? 'bmp' : (/\.gif$/i.test(name) ? 'gif' : (/\.webp$/i.test(name) ? 'webp' : 'png')))))}`)
      : 'application/octet-stream'
    return `data:${mime};base64,${base64}`
  }

  // ── 编辑保存（冲突检测 §四） ──
  async function saveEditor(): Promise<void> {
    const ed = editor.value
    if (ed.readonly || ed.saving || !deps.profileId()) return
    ed.saving = true
    ed.conflict = false
    const bytes = new TextEncoder().encode(ed.content)
    let b = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      b += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
    }
    const contentBase64 = btoa(b)
    try {
      await fsApi.write({ profileId: deps.profileId(), path: ed.path, contentBase64, expect: { etag: ed.etag, size: ed.size, modified: ed.modified } })
      ElMessage.success('已保存到远端')
      ed.open = false
      deps.refreshList()
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('已变化')) {
        ed.conflict = true
        ElMessageBox.confirm('远端文件在你编辑期间已被修改。覆盖远端内容，还是放弃本次修改？', '保存冲突', {
          confirmButtonText: '覆盖远端', cancelButtonText: '放弃修改', type: 'warning',
          closeOnClickModal: false, closeOnPressEscape: false,
        }).then(async () => {
          try {
            await fsApi.write({ profileId: deps.profileId(), path: ed.path, contentBase64, force: true })
            ElMessage.success('已覆盖保存')
            ed.open = false
            deps.refreshList()
          } catch (err2) { ElMessage.error(friendlyError(err2)) }
        }).catch(() => { /* 放弃 */ })
      } else {
        ElMessage.error(friendlyError(err))
      }
    } finally {
      ed.saving = false
    }
  }

  onMounted(() => { initMediaProgress() })
  onBeforeUnmount(() => {
    unsubMediaEvent?.()
    unsubMediaEvent = null
  })

  return {
    preview, onPreviewClose,
    editor, saveEditor,
    player, dlPercent, onMediaError,
    mediaLimitBytes, previewDirectLink, mediaLimitText, loadMediaLimit, applyCaps,
    openFile, openPlayer, openPdf, confirmDownload,
  }
}

export type FsMediaApi = ReturnType<typeof useFsMedia>
