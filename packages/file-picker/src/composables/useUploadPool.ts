import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FilePickerConflict, FilePickerItem, FilePickerLibrary, FilePickerMode, FilePickerNaming, FilePickerSource, FilePickerTarget } from '../types'
import { isKindFileName } from '@sshk/shared'
import { fingerprintKey, hashFile, resolveUploadName } from '../upload-dedupe'
import { formatSize } from '../format'

/**
 * 统一选择池 + 上传任务队列（P6-3 自 FilePickerDialog 拆出，搬代码不改行为）：
 * - 选择池：跨 tab / 目录 / 源 / 桶累积，url 为唯一键；上传项与已有项共用一份「已选」；
 * - 上传队列：大小/扩展名拦截 → 指纹去重 → 入队上传；进度爬升动画 + byte 级真实进度双轨；
 * - 危险移除一律二次确认（禁遮罩/禁 ESC），只清展示与选择池，不删除存储文件。
 */
export interface UploadPoolProps {
  mode: FilePickerMode
  library: FilePickerLibrary
  /** 是否允许一次确认多个；false 时等价 maxCount=1（新选替换旧选） */
  multiple: boolean
  /** 最大可选数量；0 / 缺省 = 不限制；=1 时单选替换 */
  maxCount: number
  /** 本次打开弹框期间累计上传文件数上限（0 / 缺省 = 不限制） */
  maxUploads: number
  /** 单文件字节上限（组件侧快速拦截；0 / 缺省 = 不限制） */
  maxSize: number
  /** 上传存储命名：hash=内容寻址名（默认）；original=保留原文件名 */
  naming: FilePickerNaming
  /** original 命名时同名不同内容的处理：hash=追加 -hash8（默认）；overwrite=直接覆盖 */
  conflict: FilePickerConflict
}

export interface UploadPoolDeps {
  /** 当前作用域串（sourceId|bucket|dir），构造条目/任务时固化 */
  currentScope: ComputedRef<string>
  /** 当前激活来源（无来源时 handleFiles 直接返回） */
  activeSource: ComputedRef<FilePickerSource | null>
  /** 当前目录 target（任务快照用） */
  target: Ref<FilePickerTarget>
  /** 生效扩展名白名单（null=未设置；props 派生，由壳统一计算传入） */
  effectiveExts: ComputedRef<string[] | null>
  /** 扩展名白名单判断（与 effectiveExts 同源） */
  extAllowed(name?: string): boolean
  /** 生效最大可选数（props 派生）：容量与超额提示用 */
  effectiveMax: ComputedRef<number>
  /** 类别中文名（「图片/文档/代码/文件」）：拦截提示文案 */
  kindLabel: ComputedRef<string>
  /** 文件名搜索关键词（任务卡片随关键词过滤） */
  keyword: Ref<string>
  /** 一批上传成功后的回调（重挂目录级联，清懒加载缓存） */
  onBatchUploaded(): void
}

/** 本次上传的文件（未确认前可删除）；列表页也会合并展示 */
export interface PoolItem extends FilePickerItem {
  key?: string
  origin: 'upload' | 'existing'
  /** 归属作用域：sourceId|bucket|目录，跨源/桶/目录的同名文件互不串扰 */
  scope: string
}

/** 上传任务队列（含进行中/成功/失败），用于总体与单项进度、失败重试/删除 */
export interface UploadTask {
  id: number
  file: File
  name: string
  status: 'uploading' | 'success' | 'failed'
  /** 0–100；有真实进度走 onProgress，无 byte 级上报时由 UI 爬升动画推进到 90，成功置 100，失败停在当时值 */
  percent: number
  /** 是否收到过真实 byte 级进度：收到后停止 UI 假爬升，避免两套进度打架 */
  realProgress?: boolean
  error?: string
  url?: string
  /** 本地预览 objectURL（缩略图），卸载/删除时 revoke；文件模式仅用于图片类文件的预览 */
  previewUrl?: string
  /** 缩略图加载失败（CSP 拦截/损坏文件/不支持格式）时改用占位，不显示浏览器裂图 */
  previewFailed?: boolean
  /** 完成时间戳：成功后短暂保留「完成」卡片让用户看到进度结果，到点降级为普通缩略图 */
  doneAt?: number
  /** 开始传输时间戳：无 byte 级上报时按经过时间估算爬升，使各项进度独立 */
  startedAt?: number
  /** 用户已删除进行中的项：后台传输无法中断，但完成后不得再把它加回上传列表/选择池 */
  cancelled?: boolean
  size: number
  /** 去重指纹（目标位置 + 源文件名 + 内容 hash / 文件名+大小）；重试沿用同一指纹 */
  fingerprint: string
  /** 实际存储名（按 naming/conflict 策略解析）；UI 显示原名 name，上传用此名，保证重试幂等 */
  uploadName: string
  scope: string
  source: FilePickerSource
  target: FilePickerTarget
}

export interface UploadPool {
  /** 本次上传已完成的文件（未确认前可删除） */
  uploaded: Ref<PoolItem[]>
  uploadTasks: Ref<UploadTask[]>
  /** 本次打开累计任务总数（总体进度分母） */
  uploadTotal: ComputedRef<number>
  uploadInProgressCount: ComputedRef<number>
  uploadSucceeded: ComputedRef<number>
  uploadFailed: ComputedRef<number>
  /** 总体进度 = 各项「传输完成度」均值（成功按 100%、失败按失败瞬间值） */
  overallPercent: ComputedRef<number>
  uploadInProgress: ComputedRef<boolean>
  /** 上传中/失败 + 刚完成仍在展示窗口内的任务：以卡片并入网格，受文件名搜索过滤 */
  activeUploadTasks: ComputedRef<UploadTask[]>
  /** 统一选择池：跨 tab / 目录 / 源 / 桶累积；scope 只记录来源用于清单展示 */
  pool: Ref<Record<string, PoolItem>>
  poolList: ComputedRef<PoolItem[]>
  poolCount: ComputedRef<number>
  uploadPicked: ComputedRef<number>
  existingPicked: ComputedRef<number>
  isSelected(item: PoolItem): boolean
  addToPool(item: PoolItem): boolean
  removeFromPool(item: PoolItem): void
  togglePool(item: PoolItem): void
  /** 按作用域 key 移除（用于跨源清单，item 可能来自已切换的旧源） */
  removePoolKey(k: string): void
  clearPool(): void
  /** 选中的文件统一入口（点击选择与拖拽投放共用）：拦截 → 去重 → 入队上传 */
  handleFiles(files: File[]): Promise<void>
  /** 重试单个失败任务（沿用原文件与来源/目录） */
  retryUpload(task: UploadTask): Promise<void>
  /** 删除单个上传项：二次确认；只清展示与选择池，不删除已上传到存储的文件 */
  removeUploadTask(task: UploadTask): Promise<void>
  /** 清除已结束（成功/失败）的上传任务，只保留上传中的；二次确认 */
  clearFinishedTasks(): Promise<void>
  /** 删除「本次上传」缩略图（右上角垃圾桶）：二次确认 + 同步清 uploadTasks */
  removeUploaded(item: PoolItem): Promise<void>
  /** 只删除「本次上传且已选」的项，未选中的上传文件保留；二次确认 + 同步清 uploadTasks */
  removeSelectedUploaded(): Promise<void>
  /** 打开新会话：清空上传缓存与选择池（revoke 预览 objectURL） */
  resetSession(): void
  /** 卸载清理：停定时器 + revoke 预览 objectURL */
  dispose(): void
}

export function useUploadPool(props: UploadPoolProps, deps: UploadPoolDeps): UploadPool {
  const uploaded = ref<PoolItem[]>([])
  const uploadTasks = ref<UploadTask[]>([])
  let uploadSeq = 0

  /** 本次打开累计任务总数（总体进度分母） */
  const uploadTotal = computed(() => uploadTasks.value.length)
  const uploadInProgressCount = computed(() => uploadTasks.value.filter((t) => t.status === 'uploading').length)
  const uploadSucceeded = computed(() => uploadTasks.value.filter((t) => t.status === 'success').length)
  const uploadFailed = computed(() => uploadTasks.value.filter((t) => t.status === 'failed').length)
  /**
   * 总体进度 = 各项「传输完成度」的均值，口径明确化（2026-11-20 用户反馈）：
   * - 成功项按 100%；失败项按失败瞬间的 percent（不回退到 0，反映已传多少）；进行中按其 percent。
   * - 分母只算未清除的任务；失败项计入分母但不会虚高（失败瞬间多少就是多少）。
   * 单项真实进度由 onProgress 上报；无 byte 级上报时由爬升动画推进到 90。
   */
  const overallPercent = computed(() => {
    const all = uploadTasks.value
    if (all.length === 0) return 0
    const sum = all.reduce((acc, t) => acc + t.percent, 0)
    return Math.min(100, Math.round(sum / all.length))
  })
  /** 有活动上传任务时显示总体进度条 */
  const uploadInProgress = computed(() => uploadInProgressCount.value > 0)

  /** 成功项完成后在卡片区保留这么久，让用户看清「上传中→100% 完成」的过程（Provider 太快时会一闪而过） */
  const DONE_KEEP_MS = 2500
  /** 时钟 tick：驱动「完成展示窗口」到期后重渲染（仅窗口内有任务时定时器才运行） */
  const nowTick = ref(0)
  let doneWindowTimer: ReturnType<typeof setInterval> | null = null
  function ensureDoneWindowTimer(): void {
    if (doneWindowTimer) return
    doneWindowTimer = setInterval(() => {
      nowTick.value = Date.now()
      if (!uploadTasks.value.some((t) => t.status === 'success' && t.doneAt && Date.now() - t.doneAt < DONE_KEEP_MS)) {
        clearInterval(doneWindowTimer!)
        doneWindowTimer = null
      }
    }, 300)
  }
  function stopDoneWindowTimer(): void {
    if (!doneWindowTimer) return
    clearInterval(doneWindowTimer)
    doneWindowTimer = null
  }
  /** 上传中/失败 + 刚完成仍在展示窗口内的任务：以卡片并入网格，受文件名搜索过滤 */
  const activeUploadTasks = computed(() => {
    void nowTick.value // 依赖时钟，窗口到期后重算
    const inWindow = (t: UploadTask): boolean =>
      t.status !== 'success' || Boolean(t.doneAt && Date.now() - t.doneAt < DONE_KEEP_MS)
    return uploadTasks.value.filter(
      (t) => inWindow(t) && (!deps.keyword.value || t.name.toLowerCase().includes(deps.keyword.value.toLowerCase())),
    )
  })

  /** 统一选择池键：url 唯一标识一个文件。不同源/桶的对象 URL 本身就不同；
   *  上传选中后切列表（同 url）仍保持选中，切目录/源亦然，且计数不重复。 */
  const itemKey = (i: { url: string }): string => i.url

  /** 统一选择池：跨 tab / 目录 / 源 / 桶累积；scope 只记录来源用于清单展示 */
  const pool = ref<Record<string, PoolItem>>({})
  const poolList = computed(() => Object.values(pool.value))
  const poolCount = computed(() => poolList.value.length)
  const uploadPicked = computed(() => poolList.value.filter((i) => i.origin === 'upload').length)
  const existingPicked = computed(() => poolList.value.filter((i) => i.origin === 'existing').length)
  const isSelected = (item: PoolItem): boolean => Boolean(pool.value[itemKey(item)])
  /** 剩余可选数量：不限时为 Infinity */
  const capacityLeft = computed(() => (deps.effectiveMax.value > 0 ? deps.effectiveMax.value - poolCount.value : Number.POSITIVE_INFINITY))
  function addToPool(item: PoolItem): boolean {
    if (!item.url) return false
    if (pool.value[itemKey(item)]) {
      pool.value[itemKey(item)] = item
      return true
    }
    if (capacityLeft.value <= 0) {
      ElMessage.warning(`最多可选 ${deps.effectiveMax.value} 个`)
      return false
    }
    pool.value[itemKey(item)] = item
    return true
  }
  function removeFromPool(item: PoolItem): void {
    const k = itemKey(item)
    if (!pool.value[k]) return
    const next = { ...pool.value }
    delete next[k]
    pool.value = next
  }
  function togglePool(item: PoolItem): void {
    if (isSelected(item)) removeFromPool(item)
    else addToPool(item)
  }
  /** 按作用域 key 移除（用于跨源清单，item 可能来自已切换的旧源） */
  function removePoolKey(k: string): void {
    const next = { ...pool.value }
    delete next[k]
    pool.value = next
  }
  function clearPool(): void {
    pool.value = {}
  }

  /**
   * 进度爬升定时器：仅给「无 byte 级上报」的任务做兜底动画，收到真实进度的项跳过（2026-11-20）。
   * 每项按自身大小估算爬升速度（大文件慢、小文件快），不再所有项同步 +N 导致进度完全一致。
   */
  let progressTimer: ReturnType<typeof setInterval> | null = null
  function estimateUploadMs(size: number): number {
    // 经验带宽 ~6MB/s，保底 4s / 封顶 12min；只是动画节奏，不代表真实剩余时间
    return Math.min(720_000, Math.max(4000, (size / (6 * 1024 * 1024)) * 1000))
  }
  function ensureProgressTimer(): void {
    if (progressTimer) return
    progressTimer = setInterval(() => {
      const now = Date.now()
      for (const t of uploadTasks.value) {
        if (t.status !== 'uploading' || t.realProgress || t.percent >= 90) continue
        const elapsed = now - (t.startedAt ?? now)
        const step = Math.max(1, Math.round((elapsed / estimateUploadMs(t.size)) * 90))
        if (step > t.percent) t.percent = Math.min(90, step)
      }
    }, 220)
  }
  function stopProgressTimer(): void {
    if (!progressTimer) return
    clearInterval(progressTimer)
    progressTimer = null
  }

  /** 执行一次上传任务：更新单项状态/进度，成功后并入 uploaded 与选择池；失败留给 UI 重试/删除 */
  async function runUpload(task: UploadTask): Promise<boolean> {
    task.status = 'uploading'
    task.percent = 0
    task.error = undefined
    task.doneAt = undefined
    task.realProgress = false
    task.startedAt = Date.now()
    ensureProgressTimer()
    try {
      // 用策略解析出的存储名上传；重试沿用同一 uploadName 天然幂等。
      // File.name 只读，包一层引用原内容即可（不重复拷贝数据）。UI 仍显示用户选的原名 task.name。
      const uploadFile = new File([task.file], task.uploadName, {
        type: task.file.type,
        lastModified: task.file.lastModified,
      })
      const url = await props.library.upload(uploadFile, task.source, task.target, (p) => {
        if (typeof p.percent === 'number' && p.percent > 0 && p.percent < 100) {
          task.realProgress = true
          task.percent = Math.max(task.percent, Math.min(99, p.percent))
        } else if (p.status === 'success') {
          task.percent = 100
        }
      })
      // 用户已删除上传中的项：底层传输已发出无法中断，但不再回填 UI/选择池（否则删完又被加回「已选」）
      if (task.cancelled) return false
      task.url = url
      task.percent = 100
      task.status = 'success'
      task.doneAt = Date.now()
      ensureDoneWindowTimer()
      // 入库项用存储名：与 Provider 列表刷新回来的名字一致，避免刷新前后显示不一致
      const item: PoolItem = { url, key: task.uploadName, name: task.uploadName, origin: 'upload', scope: task.scope, size: task.size }
      uploaded.value.push(item)
      addToPool(item) // 上传即默认选中，可取消
      return true
    } catch (err) {
      task.status = 'failed'
      task.error = (err as Error).message || String(err)
      return false
    }
  }

  /** 选中的文件统一入口（点击选择与拖拽投放共用）：大小拦截 → 指纹去重 → 入队上传 */
  async function handleFiles(files: File[]): Promise<void> {
    const source = deps.activeSource.value
    if (!source || files.length === 0) return
    const scope = deps.currentScope.value

    // 组件侧快速拦截：单文件超 maxSize 直接拒绝（真正的校验在 Upload Service 侧，这里给即时反馈）
    if (props.maxSize > 0) {
      const oversized = files.filter((f) => f.size > props.maxSize!)
      if (oversized.length > 0) {
        ElMessage.error(`以下文件超过大小限制（${formatSize(props.maxSize)}）：${oversized.slice(0, 3).map((f) => f.name).join('、')}${oversized.length > 3 ? ' 等' : ''}`)
        files = files.filter((f) => f.size <= props.maxSize!)
      }
      if (files.length === 0) return
    }

    // 扩展名拦截：allowedExts 非空时替代 kind 类别白名单（自定义口径优先）；否则 image/document/code 按类别白名单
    if (deps.effectiveExts.value) {
      const mismatched = files.filter((f) => !deps.extAllowed(f.name))
      if (mismatched.length > 0) {
        ElMessage.error(`仅允许 ${deps.effectiveExts.value.join('、')} 格式，已跳过：${mismatched.slice(0, 3).map((f) => f.name).join('、')}${mismatched.length > 3 ? ' 等' : ''}`)
        files = files.filter((f) => deps.extAllowed(f.name))
      }
      if (files.length === 0) return
    } else if (props.mode !== 'all') {
      const mismatched = files.filter((f) => !isKindFileName(props.mode, f.name))
      if (mismatched.length > 0) {
        ElMessage.error(`以下文件不属于${deps.kindLabel.value}类，已跳过：${mismatched.slice(0, 3).map((f) => f.name).join('、')}${mismatched.length > 3 ? ' 等' : ''}`)
        files = files.filter((f) => isKindFileName(props.mode, f.name))
      }
      if (files.length === 0) return
    }

    // 上传前去重：目标位置 + 源文件名（带后缀）+ 内容 hash。三者全同才算重复；
    // 同一内容改不同名字视为不同文件，都允许上传。已在传/已成功的不重复上传，失败的可重选。
    const existing = new Set(
      uploadTasks.value.filter((t) => t.status !== 'failed').map((t) => t.fingerprint),
    )
    let fresh: { file: File; fingerprint: string; uploadName: string }[] = []
    let skipped = 0
    for (const file of files) {
      const hash = await hashFile(file)
      const fp = fingerprintKey({ scope, name: file.name, size: file.size, hash })
      if (existing.has(fp)) {
        skipped += 1
        continue
      }
      existing.add(fp) // 同一批内也去重
      fresh.push({ file, fingerprint: fp, uploadName: resolveUploadName(file.name, hash, props.naming, props.conflict) })
    }
    if (skipped > 0) ElMessage.info(`已跳过 ${skipped} 个重复文件（同位置已上传或上传中）`)
    if (fresh.length === 0) return

    // 上传数量拦截：本次打开期间累计额度（进行中+成功，不含失败）；与 maxCount 独立，超出部分不发起上传
    if (props.maxUploads > 0) {
      const used = uploadTasks.value.filter((t) => t.status !== 'failed').length
      const left = props.maxUploads - used
      if (left <= 0) {
        ElMessage.warning(`本次打开最多可上传 ${props.maxUploads} 个文件，额度已用完`)
        return
      }
      if (fresh.length > left) {
        ElMessage.warning(`本次打开最多可上传 ${props.maxUploads} 个文件，剩余额度 ${left} 个，超出部分已跳过`)
        fresh = fresh.slice(0, left)
      }
    }

    // 只启动本次新增的任务：绝不能对既有的 uploading 任务重新 runUpload（会把它们的进度清零并重传，
    // 造成「新加进来的进度覆盖之前项」）。既有任务由它们各自的 Promise 继续跑，互不干扰。
    const newTasks: UploadTask[] = []
    for (const { file, fingerprint, uploadName } of fresh) {
      // 必须建为响应式对象：runUpload 持有的是本局部引用，若传原始对象，runUpload 里改 status/percent
      // 不会触发 uploadTasks 的 computed 依赖（已 success 却仍显示「上传中 1 / 3%」，2026-11-20 实证）。
      // reactive 对象 push 进 ref 数组不会被二次代理，局部引用与数组元素共享同一代理，改动可触发刷新。
      const task = reactive<UploadTask>({
        id: ++uploadSeq, file, name: file.name, uploadName, status: 'uploading', percent: 0,
        size: file.size, previewUrl: URL.createObjectURL(file), fingerprint,
        scope, source, target: { ...deps.target.value },
      })
      uploadTasks.value.push(task)
      newTasks.push(task)
    }
    const results = await Promise.all(newTasks.map((t) => runUpload(t)))
    // 仅当没有任何在途任务时才停表；否则可能有另一批 handleFiles 仍在跑
    if (!uploadInProgress.value) stopProgressTimer()
    // 上传中被用户主动移除的项既不算成功也不算失败，避免误报「上传失败」
    const counted = results.filter((_, i) => !newTasks[i]!.cancelled)
    const ok = counted.filter(Boolean).length
    const failed = counted.length - ok
    if (ok > 0) {
      // 上传成功后重挂级联：清掉懒加载缓存，下次展开即可看到新目录
      deps.onBatchUploaded()
      ElMessage.success(`${ok} 个文件已上传并选中，切到列表页可继续挑选，最后一并确认`)
    }
    if (failed > 0) ElMessage.warning(`${failed} 个文件上传失败，可在上传列表中重试或删除`)
  }

  /** 重试单个失败任务（沿用原文件与来源/目录） */
  async function retryUpload(task: UploadTask): Promise<void> {
    const ok = await runUpload(task)
    if (!uploadInProgress.value) stopProgressTimer()
    if (task.cancelled) return // 重试途中被用户移除，不再提示
    if (ok) ElMessage.success(`「${task.name}」已重新上传并选中`)
    else ElMessage.error(`「${task.name}」重试失败：${task.error}`)
  }

  /**
   * 删除单个上传项：先二次确认（禁遮罩/禁 ESC）。
   * 只清展示与选择池，不删除已上传到存储的文件；上传中的标记 cancelled，完成回调不再回填。
   */
  async function removeUploadTask(task: UploadTask): Promise<void> {
    const detail = task.status === 'uploading'
      ? '该文件正在上传。移除后它就不再出现在上传列表、完成后也不会加入「已选」；但底层传输已发出无法中断，文件仍会保存到目标存储。'
      : task.status === 'success'
        ? '这只是把上传项从列表和「已选」中移除，不会删除已上传到存储的文件。'
        : '失败项将从上传列表移除。'
    try {
      await ElMessageBox.confirm(
        `确定移除「${task.name}」？${detail}`,
        '移除上传项',
        { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch {
      return
    }
    if (task.status === 'uploading') task.cancelled = true
    if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
    uploadTasks.value = uploadTasks.value.filter((t) => t.id !== task.id)
    if (task.status === 'success' && task.url) {
      uploaded.value = uploaded.value.filter((i) => itemKey(i) !== task.url)
      removePoolKey(task.url!)
    }
    if (!uploadInProgress.value) stopProgressTimer()
  }

  /**
   * 清除已结束（成功/失败）的上传任务，只保留上传中的。
   * 危险操作二次确认（禁遮罩/禁 ESC），并按项目铁律同步清理成功项的选择池与 objectURL。
   */
  async function clearFinishedTasks(): Promise<void> {
    const finished = uploadTasks.value.filter((t) => t.status !== 'uploading')
    if (finished.length === 0) return
    try {
      await ElMessageBox.confirm(
        `将清除 ${finished.length} 个已结束的上传项（成功 ${finished.filter((t) => t.status === 'success').length} · 失败 ${finished.filter((t) => t.status === 'failed').length}），已上传成功的文件会一并从「已选」中移除。上传中的项不受影响。`,
        '清除已结束的上传项',
        { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch {
      return
    }
    const finishedIds = new Set(finished.map((t) => t.id))
    for (const t of finished) {
      if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
      if (t.status === 'success' && t.url) {
        uploaded.value = uploaded.value.filter((i) => itemKey(i) !== t.url)
        removePoolKey(t.url)
      }
    }
    uploadTasks.value = uploadTasks.value.filter((t) => !finishedIds.has(t.id))
  }

  /**
   * 从 uploadTasks 同步移出给定的成功项（按 url 匹配，url 与 itemKey 同口径）。
   * uploadTasks 才是总体统计与「清除已结束」的计数源：只删 uploaded 而不动这里，
   * 会导致删了 2 项后「清除已结束」仍显示 3 个（2026-11-20 用户实证）。
   */
  function purgeUploadTasksByUrls(urls: Set<string>): void {
    if (urls.size === 0) return
    const matched = uploadTasks.value.filter((t) => t.status === 'success' && t.url && urls.has(t.url))
    if (matched.length === 0) return
    for (const t of matched) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
    const ids = new Set(matched.map((t) => t.id))
    uploadTasks.value = uploadTasks.value.filter((t) => !ids.has(t.id))
    if (!uploadInProgress.value) stopProgressTimer()
  }

  /**
   * 删除「本次上传」缩略图（右上角垃圾桶）：二次确认（禁遮罩/禁 ESC），且必须同步清 uploadTasks。
   * 同样只清展示与选择池，不删除存储中的文件。
   */
  async function removeUploaded(item: PoolItem): Promise<void> {
    try {
      await ElMessageBox.confirm(
        `确定移除「${item.name || item.key}」？这只是把上传项从列表和「已选」中移除，不会删除已上传到存储的文件。`,
        '移除上传项',
        { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch {
      return
    }
    const k = itemKey(item)
    uploaded.value = uploaded.value.filter((i) => itemKey(i) !== k)
    removePoolKey(k)
    purgeUploadTasksByUrls(new Set([k]))
  }

  /** 只删除「本次上传且已选」的项，未选中的上传文件保留；二次确认 + 同步清 uploadTasks */
  async function removeSelectedUploaded(): Promise<void> {
    const removed = uploaded.value.filter(isSelected)
    if (removed.length === 0) return
    try {
      await ElMessageBox.confirm(
        `确定移除选中的 ${removed.length} 个上传项？这只是从列表和「已选」中移除，不会删除已上传到存储的文件。`,
        '移除上传项',
        { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch {
      return
    }
    for (const i of removed) removePoolKey(itemKey(i))
    const keys = new Set(removed.map(itemKey))
    uploaded.value = uploaded.value.filter((i) => !keys.has(itemKey(i)))
    purgeUploadTasksByUrls(keys)
    ElMessage.success(`已删除 ${removed.length} 个未确认文件`)
  }

  /** 打开新会话：清空上传缓存与选择池（revoke 预览 objectURL） */
  function resetSession(): void {
    uploaded.value = []
    for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
    uploadTasks.value = []
    stopProgressTimer()
    stopDoneWindowTimer()
    pool.value = {}
  }

  /** 卸载清理：停定时器 + revoke 预览 objectURL */
  function dispose(): void {
    stopProgressTimer()
    stopDoneWindowTimer()
    for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
  }

  return {
    uploaded, uploadTasks,
    uploadTotal, uploadInProgressCount, uploadSucceeded, uploadFailed, overallPercent, uploadInProgress,
    activeUploadTasks,
    pool, poolList, poolCount, uploadPicked, existingPicked,
    isSelected, addToPool, removeFromPool, togglePool, removePoolKey, clearPool,
    handleFiles, retryUpload, removeUploadTask, clearFinishedTasks, removeUploaded, removeSelectedUploaded,
    resetSession, dispose,
  }
}
