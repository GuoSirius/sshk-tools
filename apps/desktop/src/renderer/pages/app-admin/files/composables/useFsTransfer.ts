import { fsApi, osApi, uploadApi } from './fsHost'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { type FsChannelInfo, type FsEntry } from '@sshk/shared'
import { normalizeUploadConfig } from '@sshk/upload-core/types'
import { friendlyError } from './useFsListing'

/**
 * 传输域（P4-4 自 FileExplorerPage 拆出）：上传（选盘/EDM 产物/拖拽 + 重名预检入队）、
 * 下载（另存为/目录递归展开）、外链复制、下载目录、传输上限设置弹框、传输完成自动刷新。
 * 行为契约（与原页面逐字一致）：
 * - 传输队列面板已 P4-7 全局化：本 composable 只经 App.vue provide 的控制器 inject 唤起与读进行中计数；
 *   注入键 'sshk:transfer-panel' 与 apps/desktop/src/renderer/composables/useTransferPanel.ts 成对维护；
 *   缺省兜底 = 空实现（组件单测/孤立挂载不崩），面板不可用时静默降级。
 * - 拖拽上传 window 级 capture 监听：dragenter 与 dragover 都必须 preventDefault（HTML5 DnD 规范，缺一不可）；
 *   管理员模式 Windows UIPI 拦截拖放是系统安全边界，页面只做提示条引导。
 * - 上传完成后延迟刷新一次列表（完成后事件里也会刷）。
 */
export interface FsTransferDeps {
  profileId: () => string
  path: () => string
  outputRoot: () => string
  channels: () => FsChannelInfo[]
  list: (resetCursor?: boolean) => Promise<void>
}

type UploadAction = 'overwrite' | 'skip' | 'rename'

export function useFsTransfer(deps: FsTransferDeps) {
  // ── 传输队列（plans/10 悬浮面板；P4-7 全局化：面板挂 App.vue 根层，本页只留唤起入口与进行中计数）──
  // 工具页禁止反向 import apps（check-boundaries 铁律），经 App.vue provide 的控制器 inject 消费。
  interface TransferPanelControl { show: () => void; runningCount: import('vue').ComputedRef<number> }
  const transferPanelCtrl = inject<TransferPanelControl>(
    'sshk:transfer-panel',
    { show: () => { /* App 层未挂载全局面板（兜底不触发） */ }, runningCount: computed(() => 0) },
  )
  const runningCount = transferPanelCtrl.runningCount
  function openTransferPanel(): void {
    transferPanelCtrl.show()
  }

  // ── 上传（文件 / 文件夹 / EDM 产物） ──
  /** 展平 + 入队统一容错：flattenLocal 抛错（如旧版反斜杠问题）必须有可见提示，不许静默 */
  async function flattenAndEnqueue(paths: string[], label: string): Promise<void> {
    try {
      const files = await fsApi.flattenLocal(paths)
      await enqueueUploads(files)
    } catch (err) {
      ElMessage.error(`${label}失败：${friendlyError(err)}`)
    }
  }
  async function uploadFiles(): Promise<void> {
    const paths = await fsApi.pickUpload({ type: 'file' })
    if (!paths.length || !deps.profileId()) return
    await flattenAndEnqueue(paths, '上传')
  }
  async function uploadDirs(): Promise<void> {
    const paths = await fsApi.pickUpload({ type: 'dir' })
    if (!paths.length || !deps.profileId()) return
    await flattenAndEnqueue(paths, '上传')
  }
  async function uploadFromOutput(): Promise<void> {
    if (!deps.outputRoot()) { ElMessage.info('未找到 EDM 产物目录'); return }
    const paths = await osApi.pickFile({ multi: true, defaultPath: deps.outputRoot() })
    if (!paths.length || !deps.profileId()) return
    await flattenAndEnqueue(paths, '上传')
  }

  // ── 上传重名预检（用户 2026-11-19）──
  /** 时间戳（同批共用同一值）：YYYYMMDDHHmmss */
  function uploadStamp(): string {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }
  /** 扩展名前插入时间戳（下划线分隔）：a/b/favicon.ico → a/b/favicon_20261119084512.ico；无扩展名直接尾部追加 */
  function stampRelPath(relPath: string, stamp: string): string {
    const dot = relPath.lastIndexOf('.')
    const slash = relPath.lastIndexOf('/')
    if (dot > slash && dot > 0) return `${relPath.slice(0, dot)}_${stamp}${relPath.slice(dot)}`
    return `${relPath}_${stamp}`
  }
  /** 扩展名前插入序号（同批重命名去重兜底）：favicon_20261119084512.ico → favicon_20261119084512_2.ico */
  function seqRelPath(relPath: string, n: number): string {
    const dot = relPath.lastIndexOf('.')
    const slash = relPath.lastIndexOf('/')
    const stem = dot > slash && dot > 0 ? relPath.slice(0, dot) : relPath
    const ext = stem === relPath ? '' : relPath.slice(dot!)
    return `${stem}_${n}${ext}`
  }

  /** 重名确认弹框状态：三选一（取消 / 保留重命名 / 全部覆盖）；文件名限高滚动，单次多选也不撑爆弹框 */
  const dupDialogOpen = ref(false)
  const dupList = ref<string[]>([])
  let dupResolve: ((action: UploadAction) => void) | null = null
  function askDupAction(names: string[]): Promise<UploadAction> {
    dupList.value = names
    dupDialogOpen.value = true
    return new Promise((resolve) => { dupResolve = resolve })
  }
  /** 三按钮统一收口：关闭/取消 = skip（忽略重名，其余照传）；关闭时先 resolve 再置空，避免悬挂 */
  function resolveDupAction(action: UploadAction): void {
    dupDialogOpen.value = false
    dupResolve?.(action)
    dupResolve = null
  }

  /** 同通道同目标目录的重名检测与处置：①本批内映射到同一目标路径（保留首个，后续计重名）；
   *  ②与目标目录已有条目重名（仅直传该目录的文件；带子目录结构的深层冲突仍由引擎运行时确认）。
   *  命中时弹框三选一：取消（忽略重名文件，其余照传）/ 保留（自动重命名 原名_YYYYMMDDHHmmss+原后缀，同批同一时间戳）/ 全部覆盖。 */
  async function resolveUploadDuplicates(
    files: { name: string; localPath: string; relPath: string; size: number }[],
  ): Promise<{ files: typeof files; overwritePaths: Set<string> }> {
    // ① 本批内重复：同一 relPath 第二次及以后出现计入重名（首个正常上传）
    const seen = new Set<string>()
    const dupKeys = new Set<string>()
    for (const f of files) {
      const key = f.relPath.toLowerCase()
      if (seen.has(key)) dupKeys.add(key)
      else seen.add(key)
    }
    // ② 与目标目录已有条目重名（含后缀）
    const direct = files.filter((f) => !f.relPath.includes('/'))
    if (direct.length) {
      try {
        const page = await fsApi.list({ profileId: deps.profileId(), path: deps.path() || '/' })
        const remoteNames = new Set(page.entries.map((e) => e.name.toLowerCase()))
        for (const f of direct) {
          if (remoteNames.has(f.name.toLowerCase())) dupKeys.add(f.relPath.toLowerCase())
        }
      } catch { /* 目标目录列取失败：不阻断上传，退化为引擎运行时冲突确认 */ }
    }
    if (!dupKeys.size) return { files, overwritePaths: new Set() }

    const dupNames = files.filter((f) => dupKeys.has(f.relPath.toLowerCase())).map((f) => f.relPath)
    const action = await askDupAction(dupNames)
    if (action === 'skip') return { files: [], overwritePaths: new Set() }

    if (action === 'rename') {
      const stamp = uploadStamp()
      // 已占用名 = 本批全部目标名（重命名结果不得与本批任何文件/已改出的名字相撞）
      const used = new Set(files.map((f) => f.relPath.toLowerCase()))
      for (const f of files) {
        if (!dupKeys.has(f.relPath.toLowerCase())) continue
        let rel = stampRelPath(f.relPath, stamp)
        let n = 2
        while (used.has(rel.toLowerCase())) rel = seqRelPath(rel, n++)
        used.add(rel.toLowerCase())
        f.relPath = rel
        f.name = rel.split('/').pop() || rel
      }
      return { files, overwritePaths: new Set() }
    }
    // 覆盖：仅对检出的重名项预授权（入队即覆盖，不再逐个挂起确认）；深层结构冲突仍走运行时确认
    return { files, overwritePaths: new Set(dupNames.map((p) => p.toLowerCase())) }
  }

  /** 本地展平结果 → 传输队列上传任务（relPath 保留目录结构；入队前做重名预检） */
  async function enqueueUploads(files: { name: string; localPath: string; relPath: string; size: number }[]): Promise<void> {
    if (!files.length) { ElMessage.warning('没有可上传的文件（目录为空或文件无效）'); return }
    if (!deps.profileId()) { ElMessage.warning('请先选择上传通道'); return }
    const resolved = await resolveUploadDuplicates(files)
    files = resolved.files
    if (!files.length) { ElMessage.info('重名文件已全部忽略，没有需要上传的文件'); return }
    const inputs = files.map((f) => ({
      kind: 'upload' as const,
      profileId: deps.profileId(),
      name: f.name,
      // 根路径（'/'）不能再拼 '/'，否则得到 //1560.mp4（2026-11-20 用户反馈双斜杠）
      remotePath: deps.path() && deps.path() !== '/' ? `${deps.path()}/${f.relPath}` : `/${f.relPath}`,
      localPath: f.localPath,
      size: f.size,
      overwrite: resolved.overwritePaths.has(f.relPath.toLowerCase()) ? true : undefined,
    }))
    const { taskIds } = await fsApi.transferStart(inputs)
    if (taskIds.length) {
      openTransferPanel()
      ElMessage.success(`已加入传输队列：${taskIds.length} 个文件`)
      // 上传完成后列表要能看到新文件：延迟刷新一次（完成后事件里也会刷）
      setTimeout(() => { if (runningCount.value === 0) void deps.list(false) }, 2500)
    } else {
      ElMessage.warning('没有可上传的文件（通道不可用或文件无效）')
    }
  }

  // ── 拖拽上传（window 级 capture 监听 + 全窗口 preventDefault）──
  // 关键（2026-11-17 三修）：HTML5 DnD 规范要求 dragenter **和** dragover 都 preventDefault，
  // 缺一不可——此前只有 dragover preventDefault，dragenter 放过 → Chromium 判定「不接受放置」，
  // 鼠标显示圆圈加横杠的禁放光标，drop 事件根本不触发。同时必须设 dropEffect='copy' 才是复制光标。
  // 管理员模式（2026-11-18 用户实测）：Windows UIPI 拦截「普通权限资源管理器 → 提权进程」的拖放消息，
  // 拖拽事件根本不进应用——这是系统安全边界，代码无法绕过；页面用提示条引导改用「上传文件」按钮。
  const elevated = ref(false)
  /** 管理员拖放提示：用户可关闭，关闭后记忆不再打扰（localStorage） */
  const adminTipDismissed = ref(localStorage.getItem('sshk.fs.adminTipDismissed') === '1')
  function dismissAdminTip(): void {
    adminTipDismissed.value = true
    localStorage.setItem('sshk.fs.adminTipDismissed', '1')
  }
  const dragOver = ref(false)
  let dragDepth = 0
  /** 拖拽上传隔离（plans/10 §3）：事件目标位于传输面板内时忽略，避免拖面板误触发上传遮罩/入队 */
  function inTransferPanel(e: Event): boolean {
    const el = e.target as HTMLElement | null
    return Boolean(el?.closest?.('.fs-tpanel'))
  }
  function isFileDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types
    return Boolean(types && Array.from(types).includes('Files'))
  }
  function onWindowDragEnter(e: DragEvent): void {
    // 任何拖入都 preventDefault（保证 drop 会触发）；只有文件拖拽才显示上传遮罩
    e.preventDefault()
    if (inTransferPanel(e)) return
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    if (!isFileDrag(e)) return
    dragDepth++
    dragOver.value = true
  }
  function onWindowDragOver(e: DragEvent): void {
    e.preventDefault()
    if (inTransferPanel(e)) return
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    if (isFileDrag(e)) dragOver.value = true
  }
  function onWindowDragLeave(e: DragEvent): void {
    if (inTransferPanel(e)) return
    if (!isFileDrag(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dragOver.value = false
  }
  async function onWindowDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    if (inTransferPanel(e)) return
    dragDepth = 0
    dragOver.value = false
    const dt = e.dataTransfer
    // 文件拖到窗口任意位置（顶栏/侧栏/空白）都接受——工具页本身占满主体，严格限制 target 只会漏拖。
    // files 优先；个别 Chromium 场景 files 为空但 items 里带 kind='file'，兜底用 getAsFile()。
    let files = [...(dt?.files ?? [])]
    if (!files.length && dt?.items?.length) {
      for (const it of dt.items) {
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
    }
    // 全链路诊断（用户验收项4：drop 后无任何动静——以前 flattenLocal/transferStart 抛错会静默吞掉）
    console.info(`[fs-drop] drop 收到：files=${files.length} items=${dt?.items?.length ?? 0} types=${dt ? Array.from(dt.types).join(',') : '-'}`)
    try {
      if (!files.length) {
        ElMessage.warning('未从系统拖拽事件中拿到文件（拖的是网页元素/纯文本，或拖放消息被系统拦截）；文件请从资源管理器拖入，或用工具栏「上传文件」')
        return
      }
      // webUtils.getPathForFile 为主，File.path 兜底（个别 Electron 版本 contextBridge 传 File 后 webUtils 取不到）
      const paths: string[] = []
      const nameFor: string[] = []
      for (const f of files) {
        let p = ''
        try { p = fsApi.pathForFile(f) } catch { p = '' }
        if (!p) {
          const legacy = (f as File & { path?: string }).path
          if (typeof legacy === 'string' && legacy) p = legacy
        }
        if (p) { paths.push(p); nameFor.push(f.name) }
        else console.warn(`[fs-drop] 取不到本地路径：name=${f.name} size=${f.size}`)
      }
      if (!paths.length) { ElMessage.warning('未能获取拖拽文件的本地路径（可能来自压缩包或虚拟文件），请改用「上传文件」按钮选择'); return }
      if (!deps.profileId()) { ElMessage.warning('请先在上方选择上传通道，再拖入文件'); return }
      const flat = await fsApi.flattenLocal(paths)
      console.info(`[fs-drop] flattenLocal：输入 ${paths.length} 项 → 展开 ${flat.length} 个文件`)
      await enqueueUploads(flat)
    } catch (err) {
      console.error('[fs-drop] 拖拽上传链路异常：', err)
      ElMessage.error(`拖拽上传失败：${(err as Error).message ?? err}`)
    }
  }

  // ── 下载 ──
  /** 行内复制外链：baseUrl + 编码后的文件路径（与 EDM 上传回填同一拼接规则）；
   *  仅远程/云通道可用（本地通道改用 ShareHub「分享链接」）。未配 baseUrl 给出引导。 */
  async function rowLink(entry: FsEntry): Promise<void> {
    const cfg = normalizeUploadConfig(await uploadApi.getConfig())
    const p = [...cfg.remote.profiles, ...cfg.cloud.profiles].find((x) => x.id === deps.profileId())
    const base = p?.baseUrl?.trim().replace(/\/+$/, '')
    if (!base) { ElMessage.warning('当前通道未配置 baseUrl（外链域名前缀），无法生成链接；请到「通道配置」填写后再试'); return }
    const url = `${base}/${entry.path.split('/').map(encodeURIComponent).join('/')}`
    await osApi.clipboardWrite(url)
    ElMessage.success(`链接已复制：${url}`)
  }

  /** 下载（oss-browser / 1panel 式）：单文件走系统「另存为」对话框（自带替换确认）；
   *  多文件选目标目录（默认通道下载落点），同名冲突仍由传输队列逐个确认 */
  async function downloadEntries(list0: FsEntry[]): Promise<void> {
    const targets = list0.filter((e) => e.kind === 'file' || e.kind === 'dir')
    if (!targets.length || !deps.profileId()) return
    // 目录递归展开为文件（保留相对结构），下载上限从配置读取（默认 0 = 不限制）
    let cap = 0
    try { cap = (await fsApi.transferCaps()).downloadCap } catch { /* 失败用默认 */ }
    const files: { entry: FsEntry; relDir: string }[] = []
    let truncated = false
    const full = (): boolean => cap > 0 && files.length >= cap // cap=0 不限
    const expand = async (entry: FsEntry, rel: string): Promise<void> => {
      if (full()) { truncated = true; return }
      if (entry.kind === 'file') { files.push({ entry, relDir: rel }); return }
      const collect = async (dirPath: string, dirRel: string): Promise<void> => {
        let cursor: string | null = null
        do {
          const page = await fsApi.list({ profileId: deps.profileId(), path: dirPath, cursor })
          for (const child of page.entries) {
            if (full()) { truncated = true; return }
            if (child.kind === 'file') files.push({ entry: child, relDir: dirRel })
            else await collect(child.path, dirRel ? `${dirRel}/${child.name}` : child.name)
            if (truncated) return
          }
          cursor = page.nextCursor ?? null
        } while (cursor)
      }
      await collect(entry.path, rel)
    }
    for (const t of targets) {
      await expand(t, t.kind === 'dir' ? t.name : '')
      if (truncated) break
    }
    if (!files.length) { ElMessage.warning('所选目录中没有可下载的文件'); return }
    const base = await fsApi.downloadDir(deps.profileId())
    const single = files.length === 1 && targets.length === 1 && targets[0]!.kind === 'file'
    let destDir = base
    let singleDestPath = ''
    if (single) {
      const picked = await osApi.pickSave({ fileName: files[0]!.entry.name, defaultPath: base })
      if (!picked) return
      singleDestPath = picked
    } else {
      const dir = await osApi.pickDir({ defaultPath: base })
      if (!dir) return
      destDir = dir
    }
    const cleanDest = destDir.replace(/[\\/]+$/, '')
    const inputs = files.map(({ entry, relDir }) => ({
      kind: 'download' as const,
      profileId: deps.profileId(),
      name: entry.name,
      remotePath: entry.path,
      destPath: single ? singleDestPath : (relDir ? `${cleanDest}/${relDir}/${entry.name}` : `${cleanDest}/${entry.name}`),
      ...(single ? { overwrite: true } : {}),
      size: entry.size ?? 0,
    }))
    const { taskIds } = await fsApi.transferStart(inputs)
    if (taskIds.length) openTransferPanel()
    ElMessage.success(`已入队下载 ${files.length} 个文件${truncated ? `（已达 ${cap} 个上限，结果可能不全）` : ''}`)
  }

  // ── 上限设置（上传 / 下载分开可配；0=不限；搜索扫描页数默认 500、0=不限；在线预览 MB 默认 100、0=不限）──
  const transferCapsOpen = ref(false)
  // 默认（用户 2026-11-18 定版）：上传 10000、下载 0 不限制
  const transferCapsForm = ref({ uploadCap: 10000, downloadCap: 0, searchMaxPages: 500, mediaLimitMb: 100, previewDirectLink: true })
  const transferCapsSaving = ref(false)
  /** 上限保存后同步媒体上限/直链开关（页面装配时绑 useFsMedia.applyCaps） */
  let applyCapsHook: (caps: { mediaLimitMb: number; previewDirectLink: boolean }) => void = () => { /* 装配前空实现 */ }
  function bindApplyCaps(fn: (caps: { mediaLimitMb: number; previewDirectLink: boolean }) => void): void { applyCapsHook = fn }
  async function openTransferCaps(): Promise<void> {
    try { transferCapsForm.value = await fsApi.transferCaps() } catch { /* 读取失败按缺省值 */ }
    transferCapsOpen.value = true
  }
  async function submitTransferCaps(): Promise<void> {
    transferCapsSaving.value = true
    try {
      const r = await fsApi.setTransferCaps({
        uploadCap: transferCapsForm.value.uploadCap,
        downloadCap: transferCapsForm.value.downloadCap,
        searchMaxPages: transferCapsForm.value.searchMaxPages,
        mediaLimitMb: transferCapsForm.value.mediaLimitMb,
        previewDirectLink: transferCapsForm.value.previewDirectLink,
      })
      transferCapsForm.value = r
      applyCapsHook(r)
      ElMessage.success('上限设置已更新')
      transferCapsOpen.value = false
    } catch (err) { ElMessage.error(friendlyError(err)) }
    finally { transferCapsSaving.value = false }
  }

  async function openDownloadDir(): Promise<void> {
    if (!deps.profileId()) return
    const dir = await fsApi.downloadDir(deps.profileId())
    await osApi.shellOpen(dir)
  }
  async function changeDownloadDir(): Promise<void> {
    const dir = await osApi.pickDir()
    if (!dir) return
    await fsApi.setDownloadDir(dir)
    ElMessage.success('下载目录已更新')
  }

  // ── 传输事件订阅 + 完成自动刷新 ──
  let refreshTimer: number | undefined
  function scheduleRefresh(): void {
    if (refreshTimer !== undefined) return
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined
      if (runningCount.value === 0) void deps.list(false)
    }, 1200)
  }
  // 传输完成自动刷新订阅退订（任务数据本体已归全局面板单例 useTransferPanel，本页只关心完成后的列表刷新）
  let offTransferEvent: (() => void) | null = null
  onMounted(() => {
    offTransferEvent = fsApi.onTransferEvent((task) => {
      if (task.status === 'success' && (task.kind === 'upload' || task.kind === 'delete' || task.kind === 'copy' || task.kind === 'cross')) scheduleRefresh()
    })
    // 管理员模式提示：Windows UIPI 会拦截「低权限资源管理器 → 高权限应用」的拖放（系统级，代码无法绕过）
    void osApi.isElevated().then((v) => { elevated.value = v })
    // 拖拽上传：window 级监听（见 onWindowDrop 注释）；capture 相位保证先于任何子元素拿到事件
    window.addEventListener('dragenter', onWindowDragEnter, { capture: true })
    window.addEventListener('dragover', onWindowDragOver, { capture: true })
    window.addEventListener('dragleave', onWindowDragLeave, { capture: true })
    window.addEventListener('drop', onWindowDrop, { capture: true })
  })
  onBeforeUnmount(() => {
    offTransferEvent?.()
    offTransferEvent = null
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    window.removeEventListener('dragenter', onWindowDragEnter, { capture: true } as EventListenerOptions)
    window.removeEventListener('dragover', onWindowDragOver, { capture: true } as EventListenerOptions)
    window.removeEventListener('dragleave', onWindowDragLeave, { capture: true } as EventListenerOptions)
    window.removeEventListener('drop', onWindowDrop, { capture: true } as EventListenerOptions)
  })

  return {
    // 传输面板控制（P4-7 全局化 inject）
    runningCount, openTransferPanel,
    // 上传
    uploadFiles, uploadDirs, uploadFromOutput, enqueueUploads,
    dupDialogOpen, dupList, resolveDupAction,
    // 拖拽 + 管理员提示
    elevated, adminTipDismissed, dismissAdminTip, dragOver,
    // 下载 / 外链 / 下载目录
    downloadEntries, rowLink, openDownloadDir, changeDownloadDir,
    // 上限设置
    transferCapsOpen, transferCapsForm, transferCapsSaving, openTransferCaps, submitTransferCaps, bindApplyCaps,
  }
}

export type FsTransferApi = ReturnType<typeof useFsTransfer>
