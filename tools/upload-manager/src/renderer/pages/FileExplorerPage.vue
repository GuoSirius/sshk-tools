<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  Back,
  Box,
  ChatDotRound,
  CollectionTag,
  Connection,
  CopyDocument,
  Delete,
  Document,
  Download,
  EditPen,
  Folder,
  FolderAdd,
  FolderOpened,
  Grid,
  InfoFilled,
  Link,
  Loading,
  Lock,
  MagicStick,
  Menu as MenuIcon,
  DocumentCopy,
  Picture,
  Plus,
  Rank,
  Refresh,
  Search,
  Setting,
  Star,
  StarFilled,
  TrendCharts,
  Upload,
  VideoCamera,
} from '@element-plus/icons-vue'
import {
  FS_IMAGE_PREVIEW_LIMIT,
  FS_MEDIA_PLAY_LIMIT,
  FS_PDF_PREVIEW_LIMIT,
  FS_TEXT_EDIT_LIMIT,
  fsFormatSize,
  fsModeToRwx,
  isFsImageName,
  isFsMediaName,
  isFsTextName,
  isFsVideoName,
  isFsZipName,
  normalizeUploadConfig,
  type FsChannelInfo,
  type FsEntry,
  type FsFavorite,
  type FsListPage,
  type FsTransferTask,
  type ShareRouteInfo,
} from '@sshk/shared'
import { CodeEditor } from '@sshk/code-editor'
import { ShareDialog, findShareTicketById, shareFileDirectUrl } from '@sshk/ui-kit'
import TransferPanel from '../components/TransferPanel.vue'

/**
 * X6 文件系统页（plans/08 §3）：进入上传管理工具默认展示。
 * 布局三段：通道切换条 / 路径区（面包屑 + 可编辑路径）+ 工具栏 / 文件列表（列表·网格双视图）
 * + 状态条 + 右下角传输队列悬浮面板（plans/10，可拖拽/可收起）。
 * 通道 = 上传管理（通道配置）的 remote/cloud profile；密钥只在 main（safeStorage），渲染层零接触。
 */

// ── 通道与目录状态 ──
const channels = ref<FsChannelInfo[]>([])
const outputRoot = ref('')
const profileId = ref('')
const path = ref('/') // 内部规范：根 = '/'，子路径 = /a/b/c
const pathInput = ref('')
const pathEditing = ref(false)
const entries = ref<FsEntry[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const pageError = ref('')

// ── 选择 / 剪贴板 / 视图 ──
const selection = ref(new Set<string>())
const shiftAnchor = ref(-1)
interface Clipboard { op: 'copy' | 'cut'; profileId: string; items: { path: string; kind: 'dir' | 'file' }[] }
const clipboard = ref<Clipboard | null>(null)
const viewMode = ref<'list' | 'grid'>((localStorage.getItem('sshk.fs.view') as 'list' | 'grid' | null) ?? 'list')
const sortKey = ref<'name' | 'size' | 'time'>('name')
const sortDir = ref<'asc' | 'desc'>('asc')
const filter = ref('')

// ── 弹框 ──
const mkdirOpen = ref(false)
const mkdirName = ref('')
const mkdirInputRef = ref<{ focus: () => void } | null>(null)
// 打开即聚焦（页面级兜底，与全局机制双保险）
watch(mkdirOpen, (v) => { if (v) void nextTick(() => mkdirInputRef.value?.focus()) })
const renameOpen = ref(false)
const renameTarget = ref<FsEntry | null>(null)
const renameName = ref('')
const renameInputRef = ref<{ focus: () => void; select: () => void } | null>(null)
const moveOpen = ref(false)
const moveMode = ref<'copy' | 'move'>('copy')
const moveDirInput = ref('')
/** 复制目标通道（跨通道互拷二期；move 模式不支持跨通道） */
const moveDestProfile = ref('')
const deleteOpen = ref(false)
const deleteTargets = ref<FsEntry[]>([])
const deleteInput = ref('')

// ── 预览 / 编辑 / 播放 ──
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
const player = ref({ open: false, name: '', src: '', video: false, loading: false })

// ── 递归搜索（二期）──
const searchActive = ref(false)
const searchLoading = ref(false)
const searchEntries = ref<FsEntry[]>([])
const searchTruncated = ref(false)
const searchScannedDirs = ref(0)
/** 当前搜索会话 id：切换目录/退出搜索/新搜索时置空，在途批次与结果一律丢弃 */
let activeSearchId = ''

// ── 容量统计（二期）──
/** 统计中的目录路径集合（支持多个目录并行统计，行内显示 loading） */
const usageLoadingPaths = ref(new Set<string>())
function isUsageLoading(p: string): boolean { return usageLoadingPaths.value.has(p) }
/** 已统计的目录容量（path → 结果），直接显示在列表「类型/大小」列 */
const usageResults = ref(new Map<string, { size: number; files: number; truncated: boolean }>())

// ── §十一：扩展列（创建时间/权限/用户组/备注）与列设置 ──
type ColKey = 'createdAt' | 'mode' | 'owner' | 'note'
/** 列显隐配置（localStorage 记忆）；默认显示备注，其余按 plans/08 §11.1 默认隐藏 */
const colsVisible = ref<Record<ColKey, boolean>>(initColsVisible())
function initColsVisible(): Record<ColKey, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem('sshk.fs.cols') ?? '') as Partial<Record<ColKey, boolean>>
    return {
      createdAt: raw.createdAt === true,
      mode: raw.mode === true,
      owner: raw.owner === true,
      note: raw.note !== false, // 缺省 true（向后兼容：无配置也显示备注列）
    }
  } catch {
    return { createdAt: false, mode: false, owner: false, note: true }
  }
}
watch(colsVisible, (v) => localStorage.setItem('sshk.fs.cols', JSON.stringify(v)), { deep: true })
/** 通道是否具备该列数据：本地 birthtime / mode / uid；SFTP mode / uid；FTP 与云一律「—」（列隐藏） */
const hasCreated = computed(() => activeChannel.value?.type === 'local')
const hasMode = computed(() => activeChannel.value?.type === 'local' || activeChannel.value?.protocol === 'sftp')
const hasOwner = computed(() => activeChannel.value?.type === 'local' || activeChannel.value?.protocol === 'sftp')
const colsOpen = ref(false)
/** 实际显示的列（用户开关 ∩ 通道具备数据）：无数据的列整列隐藏，不出「—」竖排 */
const colShown = computed(() => ({
  createdAt: colsVisible.value.createdAt && hasCreated.value,
  mode: colsVisible.value.mode && hasMode.value,
  owner: colsVisible.value.owner && hasOwner.value,
  note: colsVisible.value.note,
}))
/** 列表 grid 模板列（表头与数据行共用，§十一 动态列） */
const listGridCols = computed(() => {
  const cols = ['34px', 'minmax(0, 1fr)', '130px', '150px']
  if (colShown.value.createdAt) cols.push('150px')
  if (colShown.value.mode) cols.push('64px')
  if (colShown.value.owner) cols.push('110px')
  if (colShown.value.note) cols.push('150px')
  cols.push('max-content')
  return cols.join(' ')
})

// ── §十一：压缩/解压上限设置（持久到 app 配置，main 侧钳制合法区间）──
const zipLimitsOpen = ref(false)
const zipLimitsForm = ref({ fileCap: 3000, bytesCapMb: 500 })
const zipLimitsSaving = ref(false)
async function openZipLimits(): Promise<void> {
  try {
    const cur = await window.api.fs.zipLimits()
    zipLimitsForm.value = { fileCap: cur.fileCap, bytesCapMb: cur.bytesCapMb }
  } catch { /* 读取失败按缺省值打开 */ }
  zipLimitsOpen.value = true
}
async function submitZipLimits(): Promise<void> {
  zipLimitsSaving.value = true
  try {
    const r = await window.api.fs.setZipLimits({ fileCap: zipLimitsForm.value.fileCap, bytesCapMb: zipLimitsForm.value.bytesCapMb })
    zipLimitsForm.value = { fileCap: r.fileCap, bytesCapMb: r.bytesCapMb }
    ElMessage.success('压缩上限已更新')
    zipLimitsOpen.value = false
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally {
    zipLimitsSaving.value = false
  }
}

// ── 上限设置（上传 / 下载分开可配；0=不限；搜索扫描页数默认 500、0=不限；在线预览 MB 默认 100、0=不限）──
const transferCapsOpen = ref(false)
// 默认（用户 2026-11-18 定版）：上传 10000、下载 0 不限制
const transferCapsForm = ref({ uploadCap: 10000, downloadCap: 0, searchMaxPages: 500, mediaLimitMb: 100 })
const transferCapsSaving = ref(false)
async function openTransferCaps(): Promise<void> {
  try { transferCapsForm.value = await window.api.fs.transferCaps() } catch { /* 读取失败按缺省值 */ }
  transferCapsOpen.value = true
}
async function submitTransferCaps(): Promise<void> {
  transferCapsSaving.value = true
  try {
    const r = await window.api.fs.setTransferCaps({
      uploadCap: transferCapsForm.value.uploadCap,
      downloadCap: transferCapsForm.value.downloadCap,
      searchMaxPages: transferCapsForm.value.searchMaxPages,
      mediaLimitMb: transferCapsForm.value.mediaLimitMb,
    })
    transferCapsForm.value = r
    mediaLimitBytes.value = r.mediaLimitMb === 0 ? Number.POSITIVE_INFINITY : r.mediaLimitMb * 1024 * 1024
    ElMessage.success('上限设置已更新')
    transferCapsOpen.value = false
  } catch (err) { ElMessage.error(friendlyError(err)) }
  finally { transferCapsSaving.value = false }
}

/** 音视频在线预览上限（字节，可配 app.fs.mediaLimitMb；Infinity=不限）——页面加载时拉一次 */
const mediaLimitBytes = ref<number>(FS_MEDIA_PLAY_LIMIT)
async function loadMediaLimit(): Promise<void> {
  try {
    const caps = await window.api.fs.transferCaps()
    mediaLimitBytes.value = caps.mediaLimitMb === 0 ? Number.POSITIVE_INFINITY : caps.mediaLimitMb * 1024 * 1024
  } catch { /* 失败用共享常量缺省 */ }
}
const mediaLimitText = computed(() => mediaLimitBytes.value === Number.POSITIVE_INFINITY ? '不限' : fsFormatSize(mediaLimitBytes.value))

// ── §十一：目录备注（应用侧 fsAnnotations）──
const annotations = ref(new Map<string, string>())
async function loadAnnotations(): Promise<void> {
  if (!profileId.value) return
  try { annotations.value = new Map(Object.entries(await window.api.fs.annotationList(profileId.value))) }
  catch { annotations.value = new Map() }
}
const noteOpen = ref(false)
const noteTargets = ref<FsEntry[]>([])
const noteInput = ref('')
const noteSaving = ref(false)

// ── §十一：收藏夹（应用侧 fsFavorites）──
const favorites = ref<FsFavorite[]>([])
const favDrawerOpen = ref(false)
async function loadFavorites(): Promise<void> {
  try { favorites.value = await window.api.fs.favoriteList() } catch { favorites.value = [] }
}
function isFavorited(path: string): boolean { return favorites.value.some((f) => f.profileId === profileId.value && f.path === path) }
/** 收藏跳转：跨通道先切通道（watch 会清路径重列），再消费 pendingNavPath 进入目标目录 */
let pendingNavPath: string | null = null
function gotoFavorite(f: FsFavorite): void {
  pendingNavPath = f.path
  if (f.profileId !== profileId.value) profileId.value = f.profileId
  else { path.value = f.path; void list() }
  favDrawerOpen.value = false
}

// ── §十一：编辑权限 / 属性 / 转换格式 / 压缩解压 ──
const permOpen = ref(false)
const permTarget = ref<FsEntry | null>(null)
const permOctal = ref('0644')
const permSaving = ref(false)
const propsOpen = ref(false)
const propsLoading = ref(false)
const propsEntry = ref<FsEntry | null>(null)
const propsStat = ref<{ size?: number; modified?: number; isDir?: boolean } | null>(null)
const convertOpen = ref(false)
const convertTarget = ref<FsEntry | null>(null)
const convertForm = ref<{ from: 'auto' | 'utf-8' | 'gbk' | 'big5'; to: 'utf-8' | 'gbk'; newline: 'keep' | 'lf' | 'crlf' }>({ from: 'auto', to: 'utf-8', newline: 'keep' })
const convertSaving = ref(false)
const zipSaving = ref(false)

/** 选中态派生（§十一 动态启用：按所选数量/类型/通道实时判定，避免误操作） */
const selSingle = computed(() => (selectedEntries.value.length === 1 ? selectedEntries.value[0]! : null))
const selSingleFile = computed(() => (selSingle.value?.kind === 'file' ? selSingle.value : null))
const selSingleDir = computed(() => (selSingle.value?.kind === 'dir' ? selSingle.value : null))
/** 编辑权限可用：单选 + 本地/SFTP 通道 + 有当前权限值（无值 = 列表没给，无从改起） */
const canPerm = computed(() => selSingle.value != null && hasMode.value && Boolean(selSingle.value.mode))
const canZip = computed(() => hasWritable.value && activeChannel.value?.type === 'local' && selectedEntries.value.length > 0)
const canUnzip = computed(() => hasWritable.value && selSingleFile.value != null && isFsZipName(selSingleFile.value.name))
const canConvert = computed(() => selSingleFile.value != null && isFsTextName(selSingleFile.value.name))

// ── 传输队列（plans/10：悬浮面板替代旧抽屉，无遮罩、可拖拽、收起态仍显摘要）──
const transferPanelRef = ref<InstanceType<typeof TransferPanel> | null>(null)
const panelExpanded = ref(false)
const tasks = ref(new Map<string, FsTransferTask>())
const taskList = computed(() => [...tasks.value.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)))
const runningCount = computed(() => taskList.value.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'conflict').length)
function openTransferPanel(): void {
  transferPanelRef.value?.show()
}

const themeDark = ref(true)
void window.api.config.get('app.themeMode').then((v) => { themeDark.value = String(v ?? 'dark') !== 'light' })

// ── 派生 ──
const activeChannel = computed(() => channels.value.find((c) => c.id === profileId.value) ?? null)
const filteredEntries = computed(() => {
  // 递归搜索态：直接展示搜索结果（已按名称排序），不再叠加本地过滤/排序
  if (searchActive.value) return searchEntries.value
  const kw = filter.value.trim().toLowerCase()
  const list = kw ? entries.value.filter((e) => e.name.toLowerCase().includes(kw)) : entries.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    if (sortKey.value === 'size') return (((a.size ?? 0) - (b.size ?? 0)) || a.name.localeCompare(b.name)) * dir
    if (sortKey.value === 'time') return (((a.modified ?? 0) - (b.modified ?? 0)) || a.name.localeCompare(b.name)) * dir
    return a.name.localeCompare(b.name, 'zh-Hans-CN') * dir
  })
})
const selectedEntries = computed(() => filteredEntries.value.filter((e) => selection.value.has(e.path)))
const crumbs = computed(() => path.value === '/' ? [] : path.value.split('/').filter(Boolean))
const hasWritable = computed(() => activeChannel.value?.writable === true)

function fmtTime(ts: number | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── 数据加载 ──
async function loadChannels(): Promise<void> {
  try {
    const payload = await window.api.fs.profiles()
    channels.value = payload.channels
    outputRoot.value = payload.outputRoot
    const saved = localStorage.getItem('sshk.fs.profileId') ?? ''
    const ok = payload.channels.find((c) => c.id === saved) ?? payload.channels[0]
    profileId.value = ok?.id ?? ''
  } catch (err) {
    pageError.value = (err as Error).message
  }
}

async function list(resetCursor = true): Promise<void> {
  if (!profileId.value) return
  if (resetCursor) { cursor.value = null; entries.value = [] }
  activeSearchId = '' // 在途搜索会话作废（切换目录/刷新时丢弃晚到的流式批次）
  searchActive.value = false
  searchEntries.value = []
  searchTruncated.value = false
  loading.value = true
  pageError.value = ''
  selection.value = new Set()
  shiftAnchor.value = -1
  try {
    const page: FsListPage = await window.api.fs.list({ profileId: profileId.value, path: path.value })
    entries.value = page.entries
    cursor.value = page.nextCursor ?? null
    pathInput.value = path.value
    // 清掉已不在列表里的统计缓存（目录被删后同路径新目录不显示旧统计）
    const valid = new Set(page.entries.map((e) => e.path))
    usageResults.value = new Map([...usageResults.value].filter(([p]) => valid.has(p)))
    if (resetCursor) { void loadAnnotations(); void loadShareRoutes() } // 备注/分享状态跟随目录重载
  } catch (err) {
    entries.value = []
    cursor.value = null
    pageError.value = friendlyError(err)
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!cursor.value || loadingMore.value || !profileId.value) return
  loadingMore.value = true
  try {
    const page = await window.api.fs.list({ profileId: profileId.value, path: path.value, cursor: cursor.value })
    entries.value = [...entries.value, ...page.entries]
    cursor.value = page.nextCursor ?? null
  } catch (err) {
    ElMessage.error('加载更多失败：' + friendlyError(err))
  } finally {
    loadingMore.value = false
  }
}

function friendlyError(err: unknown): string {
  const msg = (err as Error).message ?? String(err)
  // 移动部分完成的主进程提示已含处置建议，原样展示，别被下面的通用权限文案覆盖
  if (/移动未完成/.test(msg)) return msg
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg)) return '连接失败：无法连通主机（检查地址/端口/网络）'
  if (/530|532|认证|Authentication|password|All authentication/i.test(msg)) return '认证失败：检查用户名与密码/密钥'
  if (/NoSuchBucket|The specified bucket|not exist/i.test(msg)) return '路径不存在：检查 Bucket 与目录'
  if (/no right to access|bucket acl|AccessDenied|403|permission|Forbidden|无权|权限/i.test(msg)) {
    return '权限不足：当前密钥无此操作权限，请到云控制台检查 Bucket ACL 与子账号授权'
  }
  if (/密钥|Secret/i.test(msg)) return '密钥未配置：请到「上传管理 · 通道配置」填写并保存'
  return msg
}

watch(profileId, () => {
  localStorage.setItem('sshk.fs.profileId', profileId.value)
  path.value = '/'
  usageResults.value = new Map()
  usageLoadingPaths.value = new Set()
  if (!profileId.value) return
  // 收藏夹跨通道跳转：watch 已把路径清空重列，这里消费 pendingNavPath 再进目标目录
  if (pendingNavPath !== null) {
    const target = pendingNavPath
    pendingNavPath = null
    path.value = target
  }
  void list()
})
watch(viewMode, (v) => localStorage.setItem('sshk.fs.view', v))
// 分享弹框关闭后刷新路由（创建/撤销/TTL 变更后同步名称列状态图标）
watch(() => shareDialog.value.open, (v) => { if (!v) void loadShareRoutes() })

// ── 导航 ──
function enterDir(entry: FsEntry): void {
  if (entry.kind !== 'dir') return
  path.value = entry.path
  void list()
}
function goUp(): void {
  if (path.value === '/') return
  const i = path.value.lastIndexOf('/')
  path.value = i <= 0 ? '/' : path.value.slice(0, i)
  void list()
}
function gotoCrumb(index: number): void {
  path.value = index < 0 ? '/' : `/${crumbs.value.slice(0, index + 1).join('/')}`
  void list()
}
function submitPathInput(): void {
  pathEditing.value = false
  // 内部规范 `/a/b/c`：输入兼容 a/b 与 /a/b/，统一补前导 /、去尾 /；根输入 '' 或 '/' 都是 '/'
  const raw = pathInput.value.trim().replace(/\\/g, '/')
  const segs = raw.split('/').map((s) => s.trim()).filter(Boolean)
  if (segs.some((p) => p === '.' || p === '..')) {
    ElMessage.warning('路径不允许包含 . / ..')
    pathInput.value = path.value
    return
  }
  path.value = `/${segs.join('/')}`
  void list()
}
function refresh(): void {
  void list()
}

// ── 递归搜索（二期）：回车触发，扫当前路径前缀（根 = 整个通道）──
// 流式：主进程每攒 20 条/完成一层就推一批，第一批到达即进入列表视图；不再等全量扫完白屏。
async function runSearch(): Promise<void> {
  const kw = filter.value.trim()
  if (!kw) { searchActive.value = false; searchEntries.value = []; return }
  if (!profileId.value) return
  const reqId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  activeSearchId = reqId
  searchLoading.value = true
  searchActive.value = true // 立刻进入搜索态，横幅显示「扫描中…」
  // 先把当前目录（已加载）的命中作为首批结果——保证「不回车能看到的，回车后也一定在」
  // （用户 2026-11-18：输入 tool 有 6 个，回车递归只剩 1 个，因云扫描上限截断漏掉当前目录）
  const localHits = entries.value.filter((e) => e.name.toLowerCase().includes(kw.toLowerCase()))
  searchEntries.value = localHits.slice()
  searchScannedDirs.value = 0
  searchTruncated.value = false
  selection.value = new Set()
  const off = window.api.fs.onSearchEvent((e) => {
    if (activeSearchId !== reqId || e.reqId !== reqId) return // 旧会话批次一律丢弃
    if (e.entries.length) {
      // 与当前目录首批命中按 path 去重后合并；边收边排序，与最终全量结果顺序一致避免跳动
      const seen = new Set(searchEntries.value.map((x) => x.path))
      const merged = [...searchEntries.value, ...e.entries.filter((x) => !seen.has(x.path))]
      searchEntries.value = merged.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
    searchScannedDirs.value = e.scannedDirs
    if (e.done) searchLoading.value = false
  })
  try {
    const r = await window.api.fs.search({ profileId: profileId.value, path: path.value, keyword: kw, reqId })
    if (activeSearchId !== reqId) return // 期间已退出或被新搜索取代
    // 最终全量结果与当前目录首批命中合并（递归截断时仍保留当前目录命中）
    const seen = new Set(r.entries.map((x) => x.path))
    searchEntries.value = [...r.entries, ...localHits.filter((x) => !seen.has(x.path))]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    searchTruncated.value = r.truncated
    if (!r.entries.length) ElMessage.info('递归搜索没有结果')
  } catch (err) {
    if (activeSearchId === reqId) ElMessage.error('递归搜索失败：' + friendlyError(err))
  } finally {
    off()
    if (activeSearchId === reqId) searchLoading.value = false
  }
}
function exitSearch(): void {
  activeSearchId = '' // 在途批次/结果全部作废
  searchActive.value = false
  searchLoading.value = false
  searchEntries.value = []
  searchTruncated.value = false
  searchScannedDirs.value = 0
  filter.value = ''
}

// ── 目录容量统计（二期）：结果直接写入列表「类型/大小」列 ──
async function showUsage(entry: FsEntry): Promise<void> {
  if (!profileId.value || usageLoadingPaths.value.has(entry.path)) return
  usageLoadingPaths.value = new Set(usageLoadingPaths.value).add(entry.path)
  try {
    const r = await window.api.fs.usage({ profileId: profileId.value, path: entry.path })
    usageResults.value = new Map(usageResults.value).set(entry.path, { size: r.size, files: r.files, truncated: r.truncated })
    ElMessage.success(`${entry.name || '根目录'}：${fsFormatSize(r.size)} · ${r.files} 个文件${r.truncated ? '（已达扫描上限）' : ''}，已显示在列表`)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally {
    const next = new Set(usageLoadingPaths.value)
    next.delete(entry.path)
    usageLoadingPaths.value = next
  }
}

/** 「类型/大小」列文案：文件=大小；目录=类型（统计过则附容量与文件数，统计中显示 loading 文案） */
function sizeCell(entry: FsEntry): string {
  if (entry.kind === 'file') return fsFormatSize(entry.size)
  if (isUsageLoading(entry.path)) return '目录 · 统计中…'
  const u = usageResults.value.get(entry.path)
  if (!u) return '目录'
  return `目录 · ${fsFormatSize(u.size)} / ${u.files} 文件${u.truncated ? ' ∗' : ''}`
}

/** 搜索结果态的子目录提示（云通道递归搜索可命中子目录文件，灰字标注所在目录便于分辨同名文件） */
function searchDirHint(entry: FsEntry): string {
  if (!searchActive.value || entry.kind !== 'file') return ''
  const dir = entry.path.slice(0, entry.path.lastIndexOf('/'))
  return dir ? `（${dir}）` : ''
}

// ── 选择 ──
function rowClick(entry: FsEntry, event: MouseEvent): void {
  const index = filteredEntries.value.findIndex((e) => e.path === entry.path)
  if (event.shiftKey && shiftAnchor.value >= 0) {
    const [a, b] = [Math.min(shiftAnchor.value, index), Math.max(shiftAnchor.value, index)]
    const next = new Set(selection.value)
    for (let i = a; i <= b; i++) next.add(filteredEntries.value[i]!.path)
    selection.value = next
    return
  }
  if (event.ctrlKey || event.metaKey) {
    const next = new Set(selection.value)
    if (next.has(entry.path)) next.delete(entry.path)
    else next.add(entry.path)
    selection.value = next
  } else {
    selection.value = new Set([entry.path])
  }
  shiftAnchor.value = index
}
function toggleCheck(entry: FsEntry): void {
  const next = new Set(selection.value)
  if (next.has(entry.path)) next.delete(entry.path)
  else next.add(entry.path)
  selection.value = next
  shiftAnchor.value = filteredEntries.value.findIndex((e) => e.path === entry.path)
}
function selectAll(): void {
  selection.value = selection.value.size === filteredEntries.value.length ? new Set() : new Set(filteredEntries.value.map((e) => e.path))
}
function rowOpen(entry: FsEntry): void {
  if (entry.kind === 'dir') enterDir(entry)
  else void openFile(entry)
}

// ── 打开：预览 / 编辑 / 下载 ──
function fileIcon(entry: FsEntry): typeof Document {
  if (entry.kind === 'dir') return Folder
  if (isFsImageName(entry.name)) return Picture
  if (isFsMediaName(entry.name)) return VideoCamera
  return Document
}

/** 音视频在线播放（二期）：主进程流式下载到临时文件返回 file:// URL。
 *  2026-11-19：base64 data URI 方式大文件（百 MB 级）无法解码播放且占数倍内存，废弃。 */
function openPlayer(entry: FsEntry): void {
  if ((entry.size ?? 0) > mediaLimitBytes.value) {
    confirmDownload(entry, `文件 ${fsFormatSize(entry.size)} 超过在线播放上限（${mediaLimitText.value}）`, '文件过大')
    return
  }
  player.value = { open: true, name: entry.name, src: '', video: isFsVideoName(entry.name), loading: true }
  void window.api.fs.readMedia({ profileId: profileId.value, path: entry.path })
    .then((r) => { player.value.src = r.fileUrl })
    .catch((err) => {
      player.value.open = false
      const msg = (err as Error).message ?? ''
      if (/过大|超过/.test(msg)) confirmDownload(entry, msg, '文件过大')
      else ElMessage.warning(friendlyError(err))
    })
    .finally(() => { player.value.loading = false })
}
/** 媒体加载失败（编码不支持/临时文件损坏等）：留在弹框给出引导 */
function onMediaError(): void {
  player.value.loading = false
  ElMessage.warning('视频加载失败（可能是不支持的编码格式），请下载后本地播放')
}

/** 引导下载确认框（打开/预览失败、文件过大等场景统一入口，用户决定是否下载） */
function confirmDownload(entry: FsEntry, message: string, title: string): void {
  ElMessageBox.confirm(`${message}。是否下载到本地？`, title, {
    type: 'warning', confirmButtonText: '下载', cancelButtonText: '取消',
    closeOnClickModal: false, closeOnPressEscape: false,
  }).then(() => { void downloadEntries([entry]) }).catch(() => { /* 取消 */ })
}

/** PDF 在线预览：base64 → Blob URL，交给 Chromium 内置 PDF viewer（上限 FS_PDF_PREVIEW_LIMIT） */
async function openPdf(entry: FsEntry): Promise<void> {
  if (!profileId.value) return
  try {
    const r = await window.api.fs.read({ profileId: profileId.value, path: entry.path, maxBytes: FS_PDF_PREVIEW_LIMIT })
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
  if (!profileId.value) return
  if (/\.pdf$/i.test(entry.name)) { void openPdf(entry); return }
  if (isFsImageName(entry.name)) {
    try {
      const r = await window.api.fs.read({ profileId: profileId.value, path: entry.path, maxBytes: FS_IMAGE_PREVIEW_LIMIT })
      preview.value = { open: true, name: entry.name, src: dataUriOf(entry.name, r.contentBase64), pdfUrl: '', scale: 1 }
    } catch (err) {
      ElMessage.warning(friendlyError(err))
    }
    return
  }
  if (isFsTextName(entry.name)) {
    try {
      const r = await window.api.fs.read({ profileId: profileId.value, path: entry.path, maxBytes: FS_TEXT_EDIT_LIMIT })
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

// ── 上传（文件 / 文件夹 / EDM 产物） ──
/** 展平 + 入队统一容错：flattenLocal 抛错（如旧版反斜杠问题）必须有可见提示，不许静默 */
async function flattenAndEnqueue(paths: string[], label: string): Promise<void> {
  try {
    const files = await window.api.fs.flattenLocal(paths)
    await enqueueUploads(files)
  } catch (err) {
    ElMessage.error(`${label}失败：${friendlyError(err)}`)
  }
}
async function uploadFiles(): Promise<void> {
  const paths = await window.api.fs.pickUpload({ type: 'file' })
  if (!paths.length || !profileId.value) return
  await flattenAndEnqueue(paths, '上传')
}
async function uploadDirs(): Promise<void> {
  const paths = await window.api.fs.pickUpload({ type: 'dir' })
  if (!paths.length || !profileId.value) return
  await flattenAndEnqueue(paths, '上传')
}
async function uploadFromOutput(): Promise<void> {
  if (!outputRoot.value) { ElMessage.info('未找到 EDM 产物目录'); return }
  const paths = await window.api.os.pickFile({ multi: true, defaultPath: outputRoot.value })
  if (!paths.length || !profileId.value) return
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

type UploadAction = 'overwrite' | 'skip' | 'rename'
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
      const page = await window.api.fs.list({ profileId: profileId.value, path: path.value || '/' })
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
  if (!profileId.value) { ElMessage.warning('请先选择上传通道'); return }
  const resolved = await resolveUploadDuplicates(files)
  files = resolved.files
  if (!files.length) { ElMessage.info('重名文件已全部忽略，没有需要上传的文件'); return }
  const inputs = files.map((f) => ({
    kind: 'upload' as const,
    profileId: profileId.value,
    name: f.name,
    remotePath: path.value ? `${path.value}/${f.relPath}` : f.relPath,
    localPath: f.localPath,
    size: f.size,
    overwrite: resolved.overwritePaths.has(f.relPath.toLowerCase()) ? true : undefined,
  }))
  const { taskIds } = await window.api.fs.transferStart(inputs)
  if (taskIds.length) {
    openTransferPanel()
    ElMessage.success(`已加入传输队列：${taskIds.length} 个文件`)
    // 上传完成后列表要能看到新文件：延迟刷新一次（完成后事件里也会刷）
    setTimeout(() => { if (runningCount.value === 0) void list(false) }, 2500)
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
      try { p = window.api.fs.pathForFile(f) } catch { p = '' }
      if (!p) {
        const legacy = (f as File & { path?: string }).path
        if (typeof legacy === 'string' && legacy) p = legacy
      }
      if (p) { paths.push(p); nameFor.push(f.name) }
      else console.warn(`[fs-drop] 取不到本地路径：name=${f.name} size=${f.size}`)
    }
    if (!paths.length) { ElMessage.warning('未能获取拖拽文件的本地路径（可能来自压缩包或虚拟文件），请改用「上传文件」按钮选择'); return }
    if (!profileId.value) { ElMessage.warning('请先在上方选择上传通道，再拖入文件'); return }
    const flat = await window.api.fs.flattenLocal(paths)
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
  const cfg = normalizeUploadConfig(await window.api.upload.getConfig())
  const p = [...cfg.remote.profiles, ...cfg.cloud.profiles].find((x) => x.id === profileId.value)
  const base = p?.baseUrl?.trim().replace(/\/+$/, '')
  if (!base) { ElMessage.warning('当前通道未配置 baseUrl（外链域名前缀），无法生成链接；请到「通道配置」填写后再试'); return }
  const url = `${base}/${entry.path.split('/').map(encodeURIComponent).join('/')}`
  await window.api.os.clipboardWrite(url)
  ElMessage.success(`链接已复制：${url}`)
}

// ── ShareHub 安全分享（plans/09 S15）：本地通道文件/目录统一走此入口（有 TTL、可撤销）──
// 仅本地通道可用（文件真实落在本地目录，ShareHub 才能 serve）；远程/云通道走上面的 baseUrl「链接」。
// 方案 C（用户 2026-11-19 定版）：每个条目各自生成独立分享（独立 TTL/撤销）；分享目录时
// ShareDialog 内可勾选「允许访问目录」，勾选后该目录即树 token，访客进入后子目录/文件复用父 token 路径浏览。
const shareDialog = ref({
  open: false, root: '', entry: '', label: '',
})
/** 本地通道的文件/目录都可分享（allowIndex 由 ShareDialog 内勾选，不再全局门控） */
function canShareEntry(): boolean {
  return activeChannel.value?.type === 'local'
}
function rowShare(entry: FsEntry): void {
  if (activeChannel.value?.type !== 'local') {
    ElMessage.warning('ShareHub 安全分享仅支持本地通道；远程/云通道请使用「链接」（裸外链）')
    return
  }
  void loadConfigForShare(entry)
}
async function loadConfigForShare(entry: FsEntry): Promise<void> {
  const cfg = normalizeUploadConfig(await window.api.upload.getConfig())
  const root = cfg.local.defaultDir?.trim()
  if (!root) { ElMessage.warning('本地通道未配置默认目录，请到「上传配置」填写'); return }
  Object.assign(shareDialog.value, {
    root,
    entry: entry.path,
    label: `${entry.kind === 'dir' ? '目录' : '文件'}：${entry.name}`,
    open: true,
  })
}

// ── 分享状态标记（用户 2026-11-19）：名称列内小图标区分「自己分享 / 随父级 / 未分享」──
// 数据源：本工具的有效分享路由（内核 list 自带 entry/allowIndex/expiresAt），无需读 localStorage 判定。
const shareRoutes = ref<ShareRouteInfo[]>([])
async function loadShareRoutes(): Promise<void> {
  try { shareRoutes.value = await window.api.shareHub.list('upload-manager') }
  catch { shareRoutes.value = [] }
}
/** 路径归一：FsEntry.path 带前导 /，route.entry 已去前导 /，统一去前导/尾斜杠后比较 */
function normSharePath(p: string): string {
  return String(p ?? '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
}
type ShareMark = 'none' | 'own' | 'inherited'
interface ShareMarkInfo { kind: ShareMark; route?: ShareRouteInfo; parent?: ShareRouteInfo }
/** 三态：自身有路由=own；否则祖先路由覆盖=inherited（取最长匹配=最近父级）；否则 none。
 *  allowIndex=false 的父目录路由：目录条目不可浏览→跳过（文件夹无链接，用户认可）；
 *  文件条目仍算 inherited——内核文件直达不受 allowIndex 限制（分享主要就是为分享文件）。 */
function shareMarkOf(entry: FsEntry): ShareMarkInfo {
  if (!shareRoutes.value.length || activeChannel.value?.type !== 'local') return { kind: 'none' }
  const rel = normSharePath(entry.path)
  const own = shareRoutes.value.find((r) => normSharePath(r.entry) === rel)
  if (own) return { kind: 'own', route: own }
  let best: ShareRouteInfo | undefined
  for (const r of shareRoutes.value) {
    // 目录条目 + 父未开目录浏览 → 该父路由不覆盖（子目录/孙目录不显示链接）
    if (r.allowIndex === false && entry.kind === 'dir') continue
    const dir = normSharePath(r.entry)
    if (dir && rel.startsWith(dir + '/')) {
      if (!best || dir.length > normSharePath(best.entry).length) best = r
    }
  }
  return best ? { kind: 'inherited', parent: best } : { kind: 'none' }
}
/** 悬浮说明文案（图标统一 Connection，靠文案区分三态来源） */
function shareMarkTip(entry: FsEntry): string {
  const m = shareMarkOf(entry)
  if (m.kind === 'own') {
    const r = m.route!
    const life = r.expiresAt <= 0 || r.expiresAt > 8e15 ? '永久' : `剩余 ${Math.max(0, Math.round((r.expiresAt - Date.now()) / 3600000))} 小时`
    return `自己的分享（${life}${r.allowIndex !== false && entry.kind === 'dir' ? '，目录树' : ''}）· 点击复制自己的链接`
  }
  if (m.kind === 'inherited') {
    return entry.kind === 'file'
      ? `无自己的分享，随父目录「${m.parent!.label}」的分享可直达下载 · 点击复制文件链接`
      : `无自己的分享，随父目录「${m.parent!.label}」的树链接可访问 · 点击复制父级链接`
  }
  return '未分享 · 点行操作「分享链接」创建'
}
/** 点击分享图标：own=自己的链接；inherited 文件=拼文件直达链接（父目录即使未开浏览也能下载）；inherited 目录=父级树链接。均按 route.id 反查 ticket。 */
async function copyShareLink(entry: FsEntry): Promise<void> {
  const m = shareMarkOf(entry)
  const route = m.kind === 'own' ? m.route : m.parent
  if (!route) return
  const ticket = findShareTicketById(route.id)
  const base = ticket?.urls?.[0]
  if (!base) { ElMessage.warning('分享凭证读取失败，请重新打开分享弹框刷新链接'); return }
  const url = m.kind === 'inherited' && entry.kind === 'file'
    ? shareFileDirectUrl(base, entry.path) // 文件直达：base(含 token) + 相对 root 路径
    : base
  await window.api.os.clipboardWrite(url)
  ElMessage.success(m.kind === 'own' ? '已复制自己的分享链接' : (entry.kind === 'file' ? '已复制文件直达链接' : '已复制父级分享链接'))
}

/** 下载（oss-browser / 1panel 式）：单文件走系统「另存为」对话框（自带替换确认）；
 *  多文件选目标目录（默认通道下载落点），同名冲突仍由传输队列逐个确认 */
async function downloadEntries(list0: FsEntry[]): Promise<void> {
  const targets = list0.filter((e) => e.kind === 'file' || e.kind === 'dir')
  if (!targets.length || !profileId.value) return
  // 目录递归展开为文件（保留相对结构），下载上限从配置读取（默认 0 = 不限制）
  let cap = 0
  try { cap = (await window.api.fs.transferCaps()).downloadCap } catch { /* 失败用默认 */ }
  const files: { entry: FsEntry; relDir: string }[] = []
  let truncated = false
  const full = (): boolean => cap > 0 && files.length >= cap // cap=0 不限
  const expand = async (entry: FsEntry, rel: string): Promise<void> => {
    if (full()) { truncated = true; return }
    if (entry.kind === 'file') { files.push({ entry, relDir: rel }); return }
    const collect = async (dirPath: string, dirRel: string): Promise<void> => {
      let cursor: string | null = null
      do {
        const page = await window.api.fs.list({ profileId: profileId.value, path: dirPath, cursor })
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
  const base = await window.api.fs.downloadDir(profileId.value)
  const single = files.length === 1 && targets.length === 1 && targets[0]!.kind === 'file'
  let destDir = base
  let singleDestPath = ''
  if (single) {
    const picked = await window.api.os.pickSave({ fileName: files[0]!.entry.name, defaultPath: base })
    if (!picked) return
    singleDestPath = picked
  } else {
    const dir = await window.api.os.pickDir({ defaultPath: base })
    if (!dir) return
    destDir = dir
  }
  const cleanDest = destDir.replace(/[\\/]+$/, '')
  const inputs = files.map(({ entry, relDir }) => ({
    kind: 'download' as const,
    profileId: profileId.value!,
    name: entry.name,
    remotePath: entry.path,
    destPath: single ? singleDestPath : (relDir ? `${cleanDest}/${relDir}/${entry.name}` : `${cleanDest}/${entry.name}`),
    ...(single ? { overwrite: true } : {}),
    size: entry.size ?? 0,
  }))
  const { taskIds } = await window.api.fs.transferStart(inputs)
  if (taskIds.length) openTransferPanel()
  ElMessage.success(`已入队下载 ${files.length} 个文件${truncated ? `（已达 ${cap} 个上限，结果可能不全）` : ''}`)
}

// ── 新建 / 重命名 / 删除 ──
async function submitMkdir(): Promise<void> {
  const name = mkdirName.value.trim()
  if (!name || /[\\/]/.test(name)) { ElMessage.warning('目录名不能为空且不含斜杠'); return }
  try {
    await window.api.fs.mkdir({ profileId: profileId.value, path: path.value === '/' ? `/${name}` : `${path.value}/${name}` })
    mkdirOpen.value = false
    mkdirName.value = ''
    ElMessage.success('目录已创建')
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}

function openRename(entry: FsEntry): void {
  renameTarget.value = entry
  renameName.value = entry.name
  renameOpen.value = true
  // 页面级兜底聚焦（用户 2026-11-19：全局机制对部分弹框时序不稳）；重命名全选便于直接输入新名
  void nextTick(() => { renameInputRef.value?.focus(); renameInputRef.value?.select() })
}
async function submitRename(): Promise<void> {
  const target = renameTarget.value
  const name = renameName.value.trim()
  if (!target || !name || /[\\/]/.test(name) || name === target.name) { renameOpen.value = false; return }
  const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
  try {
    await window.api.fs.mv({ profileId: profileId.value, sources: [{ path: target.path, kind: target.kind }], destDir: parent, renameTo: name })
    renameOpen.value = false
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}

function openDelete(list0: FsEntry[]): void {
  if (!list0.length) return
  const dirs = list0.filter((e) => e.kind === 'dir')
  deleteTargets.value = list0
  deleteInput.value = ''
  // 递归删大目录：输目录名确认（§六）
  if (dirs.length) {
    ElMessageBox.prompt(
      `将删除 ${list0.length} 项（含 ${dirs.length} 个目录及其全部内容），不可恢复。大目录会走传输队列分批删除。`,
      '删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消',
        inputPlaceholder: `输入 ${dirs.length === 1 ? dirs[0]!.name : 'YES'} 以确认`,
        closeOnClickModal: false, closeOnPressEscape: false, type: 'warning' },
    ).then(({ value }) => {
      const expected = dirs.length === 1 ? dirs[0]!.name : 'YES'
      if ((value ?? '').trim() !== expected) { ElMessage.warning('确认文字不匹配，已取消'); return }
      void doDelete(list0)
    }).catch(() => { /* 取消 */ })
  } else {
    deleteOpen.value = true
  }
}
async function confirmDelete(): Promise<void> {
  deleteOpen.value = false
  await doDelete(deleteTargets.value)
}
async function doDelete(list0: FsEntry[]): Promise<void> {
  if (!profileId.value) return
  try {
    const { taskIds } = await window.api.fs.rm({
      profileId: profileId.value,
      paths: list0.map((e) => ({ path: e.path, kind: e.kind })),
    })
    selection.value = new Set()
    if (taskIds.length) {
      openTransferPanel()
      ElMessage.info(`递归删除已入队：${taskIds.length} 个目录`)
    } else {
      ElMessage.success('已删除')
    }
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}

// ── 复制 / 剪切 / 粘贴 / 移动 ──
function clipCopy(op: 'copy' | 'cut'): void {
  if (!selectedEntries.value.length) return
  clipboard.value = { op, profileId: profileId.value, items: selectedEntries.value.map((e) => ({ path: e.path, kind: e.kind })) }
  ElMessage.success(op === 'copy' ? `已复制 ${clipboard.value.items.length} 项` : `已剪切 ${clipboard.value.items.length} 项`)
}
/** 上次成功选定/提交的目标目录（项18）：EP cascader 关闭弹框不清内部显示，手输框必须同步回显同一个值 */
const lastMoveDir = ref('')
function openMove(mode: 'copy' | 'move'): void {
  if (!selectedEntries.value.length) return
  moveMode.value = mode
  // 优先回填上次选中的目标目录（与 cascader 显示一致）；首次才用当前目录
  moveDirInput.value = lastMoveDir.value || path.value
  moveDestProfile.value = profileId.value
  moveOpen.value = true
}

/** 目标目录级联（移动/复制/解压共用）：逐级懒加载只列目录，点圈选中回填手输框。
 *  props 用工厂生成（各弹框目标通道来源不同）；通道切换靠模板 :key 重挂载刷新。
 *  坑（同 file-picker）：不写 leaf 字段——EP 对「已加载且无子」自动推断叶子，显式 leaf 会钉死非叶子。
 *  层级（用户 2026-11-19 定版）：首列 = 根目录「/」独立节点（点圈直接选根），展开子级列一级目录。 */
function dirLazyProps(getPid: () => string) {
  return {
    lazy: true,
    checkStrictly: true,
    emitPath: false,
    lazyLoad: async (node: { level: number; value?: string | number | null }, resolve: (nodes: unknown[]) => void) => {
      const pid = getPid()
      if (!pid) { resolve([]); return }
      // 根 label 置空 + 级联 separator="/" → 回显 /a/b/c（若根 label 为 '/' 会拼出 //a/b 双斜杠）；
      // 面板首列根节点的 "/" 由 CSS 伪元素补显示
      if (node.level === 0) { resolve([{ value: '/', label: '' }]); return } // 根目录独立首级
      const parent = String(node.value ?? '/')
      try {
        const page = await window.api.fs.list({ profileId: pid, path: parent })
        resolve(page.entries.filter((e) => e.kind === 'dir').map((e) => ({ value: e.path, label: e.name })))
      } catch { resolve([]) }
    },
  }
}
const moveDirProps = dirLazyProps(() => moveDestProfile.value || profileId.value)
const moveCascaderRef = ref<{ togglePopperVisible: (visible: boolean) => void } | null>(null)
/** 点单选圈：路径回填手输框并收起面板（checkStrictly 下 EP 不会自动收起） */
function onMoveDirPicked(v: unknown): void {
  moveDirInput.value = String(v ?? '')
  if (moveDirInput.value) lastMoveDir.value = moveDirInput.value
  moveCascaderRef.value?.togglePopperVisible(false)
}
/** 行内直达（§3.2 行操作列）：单选该条目后走「复制到/移动到」弹框 */
function rowCopy(entry: FsEntry): void {
  selection.value = new Set([entry.path])
  openMove('copy')
}
function rowMove(entry: FsEntry): void {
  selection.value = new Set([entry.path])
  openMove('move')
}
/** 目标目录输入 → 内部规范（`/a/b`；空串与 `/` = 根）。返回 null 表示非法 */
function normalizeDestInput(raw: string): string | null {
  const s = String(raw ?? '').trim().replace(/\\/g, '/')
  const segs = s.split('/').map((p) => p.trim()).filter(Boolean)
  if (segs.some((p) => p === '.' || p === '..')) return null
  return `/${segs.join('/')}`
}
/** 目标路径是否已存在（用于同目录复制/移动的重名检查） */
async function destExists(destPath: string): Promise<boolean> {
  try {
    const parent = destPath.lastIndexOf('/') <= 0 ? '/' : destPath.slice(0, destPath.lastIndexOf('/'))
    const page = await window.api.fs.list({ profileId: profileId.value, path: parent })
    return page.entries.some((e) => e.path === destPath)
  } catch { return false }
}
/** 同源同目录的重命名循环（用户 2026-11-18）：确认后仍重名就继续弹，取消才终止 */
async function askRenameForConflict(src: FsEntry, destDir: string): Promise<string | null> {
  while (true) {
    let value: string | null = null
    try {
      const r = await ElMessageBox.prompt(
        `「${src.name}」在目标目录中已存在（同源同目录不允许直接覆盖）。请输入新名称后确认；若仍重名会再次提示。`,
        '重命名以避免覆盖',
        {
          inputValue: src.name, confirmButtonText: '确认', cancelButtonText: '取消',
          inputPattern: /^[^\\/:]+$/, inputErrorMessage: '名称不能含斜杠',
          closeOnClickModal: false, closeOnPressEscape: false,
        },
      )
      value = r.value?.trim() ?? ''
    } catch { return null } // 用户取消 → 整个操作终止
    if (!value || value === src.name) continue
    const destPath = destDir === '/' ? `/${value}` : `${destDir}/${value}`
    if (!(await destExists(destPath))) return value
    ElMessage.warning('该名称已存在，请换一个')
  }
}

async function submitMove(): Promise<void> {
  const dest = normalizeDestInput(moveDirInput.value)
  if (dest === null) { ElMessage.warning('目标目录不合法（不允许 . / .. 或反斜杠）'); return }
  const sources = selectedEntries.value.map((e) => ({ path: e.path, kind: e.kind }))
  const cross = Boolean(moveDestProfile.value && moveDestProfile.value !== profileId.value)

  // 同源同目录复制/移动：目标与源同名会覆盖自身 → 弹重命名框循环直到不重名或取消
  let renameTo = ''
  if (!cross && sources.length === 1) {
    const src = sources[0]!
    const srcParent = src.path.lastIndexOf('/') <= 0 ? '/' : src.path.slice(0, src.path.lastIndexOf('/'))
    if (srcParent === dest) {
      const destPath = dest === '/' ? src.path : `${dest}${src.path.slice(srcParent.length)}`
      if (await destExists(destPath)) {
        const renamed = await askRenameForConflict(selectedEntries.value[0]!, dest)
        if (renamed === null) return // 用户取消：操作终止，保持弹框打开
        renameTo = renamed
      }
    }
  }

  moveOpen.value = false
  try {
    if (cross) {
      // 跨通道（项20）：复制/移动都走 crossCopy，move=true 时目标写成功即删源
      const r = await window.api.fs.crossCopy({
        srcProfileId: profileId.value, destProfileId: moveDestProfile.value,
        sources, destDir: dest, move: moveMode.value === 'move',
      })
      openTransferPanel()
      ElMessage.info(`跨通道${moveMode.value === 'move' ? '移动' : '复制'}已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
    } else if (moveMode.value === 'move') {
      await window.api.fs.mv({ profileId: profileId.value, sources, destDir: dest, renameTo: renameTo || undefined })
      ElMessage.success('已移动')
    } else {
      const { taskIds } = await window.api.fs.cp({ profileId: profileId.value, sources, destDir: dest, renameTo: renameTo || undefined })
      if (taskIds.length) { openTransferPanel(); ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
      else ElMessage.success(renameTo ? `已复制为 ${renameTo}` : '已复制')
    }
    selection.value = new Set()
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}
async function paste(): Promise<void> {
  await pasteInto(path.value)
}

/** §十一 行级粘贴：目录行的「粘贴」落点为该目录（复制/剪切语义与顶部粘贴一致） */
async function rowPaste(entry: FsEntry): Promise<void> {
  await pasteInto(entry.path)
}
/** 粘贴完成后询问是否清空剪贴板（用户 2026-11-18：避免用户不知是否完成而重复粘贴；保留=可能还要粘到别处） */
async function askClipboardAfterPaste(): Promise<void> {
  try {
    await ElMessageBox.confirm('粘贴指令已完成。是否清空剪贴板？', '粘贴完成', {
      type: 'info', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
      confirmButtonText: '清空剪贴板', cancelButtonText: '保留（还要粘到别处）',
    })
    clipboard.value = null
    ElMessage.success('剪贴板已清空')
  } catch { /* 保留剪贴板 */ }
}

async function pasteInto(destDir: string): Promise<void> {
  const clip = clipboard.value
  if (!clip || !profileId.value || !hasWritable.value) return
  // 跨通道粘贴（二期）：复制语义走 crossCopy；剪切跨通道降级为复制（源保留，避免半删风险）
  if (clip.profileId !== profileId.value) {
    if (!hasWritable.value) { ElMessage.warning('当前通道不支持写操作，无法作为粘贴目标'); return }
    try {
      const r = await window.api.fs.crossCopy({ srcProfileId: clip.profileId, destProfileId: profileId.value, sources: clip.items, destDir })
      if (clip.op === 'cut') ElMessage.info('跨通道剪切按复制执行（源文件保留）')
      openTransferPanel()
      ElMessage.info(`跨通道复制已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
      void list(false)
      await askClipboardAfterPaste()
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
    return
  }
  try {
    // 用户 2026-11-19：顶部粘贴与弹框/行级同流程——单源且「同源同目录」（复制后原地粘贴，
    // mv/cp 会因 dest===src 报错）或粘进自身子目录时，弹重命名循环；无冲突保持原行为。
    // 多源保持原行为（主进程逐项校验）。重命名取消=整个粘贴终止，剪贴板保留。
    let renameTo: string | undefined
    if (clip.items.length === 1) {
      const src = clip.items[0]!.path
      const name = src.split('/').pop() || src
      const srcParent = src.lastIndexOf('/') <= 0 ? '/' : src.slice(0, src.lastIndexOf('/'))
      const dest = destDir === '/' ? `/${name}` : `${destDir}/${name}`
      if (srcParent === destDir || dest.startsWith(`${src}/`)) {
        const renamed = await askRenameForConflict({ name } as FsEntry, destDir)
        if (renamed === null) return // 用户取消：终止粘贴，剪贴板保留
        renameTo = renamed
      }
    }
    if (clip.op === 'cut') {
      await window.api.fs.mv({ profileId: profileId.value, sources: clip.items, destDir, renameTo })
      clipboard.value = null
      ElMessage.success('已粘贴（移动）')
    } else {
      const { taskIds } = await window.api.fs.cp({ profileId: profileId.value, sources: clip.items, destDir, renameTo })
      if (taskIds.length) { openTransferPanel(); ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
      else ElMessage.success(renameTo ? `已粘贴为 ${renameTo}` : '已粘贴（复制）')
      await askClipboardAfterPaste()
    }
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}

/** 用户 2026-11-19：清空剪贴板（误触复制后取消，不必粘贴）；「清空」属主动放弃操作，二次确认 */
async function clearClipboard(): Promise<void> {
  const n = clipboard.value?.items.length ?? 0
  try {
    await ElMessageBox.confirm(`清空剪贴板中的 ${n} 项？清空后需重新复制才能粘贴。`, '清空剪贴板', {
      type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
      confirmButtonText: '清空', cancelButtonText: '保留',
    })
  } catch { return }
  clipboard.value = null
  ElMessage.success('剪贴板已清空')
}

// ── 新建文件 ──
/** 工具栏「更多▾」分发（§3.1 + §十一 分组化：全部按选中态实时判定，避免误操作） */
function moreCommand(cmd: unknown): void {
  switch (String(cmd)) {
    case 'refresh': refresh(); return
    case 'usage': if (selSingleDir.value) void showUsage(selSingleDir.value); return
    case 'copyto': openMove('copy'); return
    case 'newfile': void newFile(); return
    case 'downloaddir': void changeDownloadDir(); return
    case 'opendir': void openDownloadDir(); return
    case 'cols': colsOpen.value = true; return
    case 'ziplimits': void openZipLimits(); return
    case 'transfercaps': void openTransferCaps(); return
    case 'transferconfig': void openTransferConfig(); return
    case 'note': openNote(selectedEntries.value); return
    case 'favorite': void addFavorites(selectedEntries.value); return
    case 'favorites': void loadFavorites().then(() => { favDrawerOpen.value = true }); return
    case 'copypath': void copySelectedPaths(); return
    case 'zip': void doZip(); return
    case 'unzip': if (canUnzip.value) openUnzip(selSingleFile.value!); return
    case 'convert': openConvert(); return
    case 'perm': openPerm(); return
    case 'props': openProps(); return
  }
}

/** 行「更多 ▾」/ 网格右键 共用分发（§11.4 定版 + 行外显操作全集） */
function rowMoreCommand(cmd: string, entry: FsEntry): void {
  switch (cmd) {
    case 'open': rowOpen(entry); return
    case 'download': void downloadEntries([entry]); return
    case 'link': void rowLink(entry); return
    case 'paste': void rowPaste(entry); return
    case 'copy': rowCopy(entry); return
    case 'move': rowMove(entry); return
    case 'rename': openRename(entry); return
    case 'delete': openDelete([entry]); return
    case 'usage': if (entry.kind === 'dir') void showUsage(entry); return
    case 'note': openNote([entry]); return
    case 'favorite': if (isFavorited(entry.path)) void removeFavorite(entry); else void addFavorites([entry]); return
    case 'copypath': void window.api.os.clipboardWrite(entry.path).then(() => ElMessage.success('路径已复制')); return
    case 'zip': void doZip([entry]); return
    case 'unzip': openUnzip(entry); return
    case 'convert': selection.value = new Set([entry.path]); openConvert(); return
    case 'perm': selection.value = new Set([entry.path]); openPerm(); return
    case 'props': void openPropsFor(entry); return
    case 'share': selection.value = new Set([entry.path]); rowShare(entry); return
  }
}

// ── 网格视图右键菜单（用户 2026-11-18：卡片展示同所有行操作）──
const ctxMenu = ref<{ x: number; y: number; entry: FsEntry } | null>(null)
function openCtxMenu(entry: FsEntry, e: MouseEvent): void {
  // 简单钳制：避免菜单溢出视口右/下边缘
  ctxMenu.value = {
    x: Math.min(e.clientX, window.innerWidth - 200),
    y: Math.min(e.clientY, window.innerHeight - 360),
    entry,
  }
}
function ctxRun(cmd: string): void {
  const entry = ctxMenu.value?.entry
  ctxMenu.value = null
  if (entry) rowMoreCommand(cmd, entry)
}
/** 事件委托：原生菜单从 li 的 data-command 读取命令（不走 el-dropdown 的 command 分发） */
function ctxClick(e: MouseEvent): void {
  const item = (e.target as HTMLElement | null)?.closest?.('.fs-ctx-menu li')
  if (!item || item.classList.contains('is-disabled')) return
  const cmd = item.getAttribute('data-command')
  if (cmd) ctxRun(cmd)
}
function onWindowCtxMaybeClose(e: Event): void {
  // 右键另一个卡片时由其自身 handler 重新开菜单，不先关
  if (e.type === 'contextmenu' && (e.target as HTMLElement | null)?.closest?.('.fs-cell')) return
  ctxMenu.value = null
}

// ── §十一：设置备注（遵守确认后生效；多选批量同备注）──
function openNote(targets: FsEntry[]): void {
  if (!targets.length) return
  noteTargets.value = targets
  noteInput.value = targets.length === 1 ? (annotations.value.get(targets[0]!.path) ?? '') : ''
  noteOpen.value = true
}
async function submitNote(): Promise<void> {
  if (!profileId.value || noteSaving.value) return
  noteSaving.value = true
  try {
    for (const t of noteTargets.value) {
      await window.api.fs.annotationSet({ profileId: profileId.value, path: t.path, note: noteInput.value })
    }
    noteOpen.value = false
    ElMessage.success(noteInput.value.trim() ? `已设置备注（${noteTargets.value.length} 项）` : '已清除备注')
    await loadAnnotations()
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally { noteSaving.value = false }
}

// ── §十一：收藏夹 ──
async function addFavorites(targets: FsEntry[]): Promise<void> {
  if (!profileId.value || !targets.length) return
  try {
    let added = 0
    for (const t of targets.slice(0, 20)) {
      if (isFavorited(t.path)) continue
      await window.api.fs.favoriteAdd({ profileId: profileId.value, path: t.path, kind: t.kind, name: t.name })
      added++
    }
    await loadFavorites()
    ElMessage.success(added ? `已收藏 ${added} 项` : '所选项目均已在收藏夹')
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}
async function removeFavorite(entry: FsEntry): Promise<void> {
  const hit = favorites.value.find((f) => f.profileId === profileId.value && f.path === entry.path)
  if (!hit) return
  // 取消收藏需二次确认（用户 2026-11-18：危险操作一律确认，禁遮罩禁 ESC）
  try {
    await ElMessageBox.confirm(`确定取消收藏「${hit.name}」吗？`, '取消收藏', { type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '取消收藏', cancelButtonText: '保留' })
  } catch { return }
  try {
    await window.api.fs.favoriteRemove(hit._id)
    await loadFavorites()
    ElMessage.success('已取消收藏')
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}
/** 行末星标快捷收藏：已收藏=取消，未收藏=添加；复用同一状态与提示 */
function toggleFav(entry: FsEntry): void {
  if (isFavorited(entry.path)) void removeFavorite(entry)
  else void addFavorites([entry])
}
async function removeFavoriteById(f: FsFavorite): Promise<void> {
  // 收藏夹内单项移除同样二次确认（禁遮罩禁 ESC）
  try {
    await ElMessageBox.confirm(`确定移除收藏「${f.name}」吗？`, '移除收藏', { type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留' })
  } catch { return }
  try {
    await window.api.fs.favoriteRemove(f._id)
    await loadFavorites()
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}
async function copySelectedPaths(): Promise<void> {
  const list0 = selectedEntries.value
  if (!list0.length) return
  await window.api.os.clipboardWrite(list0.map((e) => e.path).join('\n'))
  ElMessage.success(`已复制 ${list0.length} 条路径`)
}

// ── §十一：编辑权限（本地 / SFTP；先读后改、确认后生效）──
function openPerm(): void {
  const t = selSingle.value
  if (!t || !canPerm.value) return
  permTarget.value = t
  permOctal.value = t.mode ?? '0644'
  permOpen.value = true
}
function permBits(): { owner: [boolean, boolean, boolean]; group: [boolean, boolean, boolean]; other: [boolean, boolean, boolean] } {
  const bits = parseInt(permOctal.value.replace(/^0?(?=[0-7]{3})/, '0'), 8) & 0o777
  const g = (shift: number): [boolean, boolean, boolean] => [Boolean((bits >> shift) & 4), Boolean((bits >> shift) & 2), Boolean((bits >> shift) & 1)]
  return { owner: g(6), group: g(3), other: g(0) }
}
/** rwx 勾选 ↔ 八进制输入双向联动（输入框仍是权威，勾选实时重算） */
function togglePermBit(group: 'owner' | 'group' | 'other', idx: 0 | 1 | 2): void {
  const b = permBits()
  b[group][idx] = !b[group][idx]
  const g = (t: [boolean, boolean, boolean]): number => (t[0] ? 4 : 0) | (t[1] ? 2 : 0) | (t[2] ? 1 : 0)
  permOctal.value = '0' + g(b.owner) + g(b.group) + g(b.other)
}
async function submitPerm(): Promise<void> {
  const t = permTarget.value
  if (!t || !profileId.value || permSaving.value) return
  const octal = permOctal.value.trim()
  if (!/^0?[0-7]{3}$/.test(octal)) { ElMessage.warning('权限须为 3-4 位八进制（如 0644）'); return }
  try {
    await ElMessageBox.confirm(
      `将把「${t.name}」的权限改为 ${octal}（${fsModeToRwx(octal)}）。确认修改吗？`,
      '编辑权限',
      { confirmButtonText: '确认修改', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false, closeOnPressEscape: false },
    )
  } catch { return }
  permSaving.value = true
  try {
    await window.api.fs.chmod({ profileId: profileId.value, path: t.path, modeOctal: octal })
    permOpen.value = false
    ElMessage.success('权限已修改')
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally { permSaving.value = false }
}

// ── §十一：属性弹框（只读展示 + 编辑入口）──
async function openProps(): Promise<void> {
  const t = selSingle.value
  if (!t) return
  await openPropsFor(t)
}
async function openPropsFor(entry: FsEntry): Promise<void> {
  propsEntry.value = entry
  propsStat.value = null
  propsLoading.value = true
  propsOpen.value = true
  try {
    const st = await window.api.fs.stat({ profileId: profileId.value, path: entry.path })
    propsStat.value = st.exists ? { size: st.size, modified: st.modified, isDir: st.isDir } : null
  } catch { propsStat.value = null }
  finally { propsLoading.value = false }
}

// ── §十一：转换格式 A（文本编码/换行符，全通道；仅文本扩展启用）──
function openConvert(): void {
  const t = selSingleFile.value
  if (!t || !canConvert.value) return
  convertTarget.value = t
  convertForm.value = { from: 'auto', to: 'utf-8', newline: 'keep' }
  convertOpen.value = true
}
async function submitConvert(): Promise<void> {
  const t = convertTarget.value
  if (!t || !profileId.value || convertSaving.value) return
  const f = convertForm.value
  const nlText = f.newline === 'keep' ? '保持换行符不变' : `换行符统一为 ${f.newline === 'lf' ? 'LF (\\n)' : 'CRLF (\\r\\n)'}`
  try {
    await ElMessageBox.confirm(
      `将读取「${t.name}」并按（${f.from === 'auto' ? '自动检测编码' : f.from} → ${f.to}，${nlText}）转换后写回原文件。转换前建议下载备份，确认执行吗？`,
      '转换文本编码 / 换行符',
      { confirmButtonText: '确认转换', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false, closeOnPressEscape: false },
    )
  } catch { return }
  convertSaving.value = true
  try {
    const r = await window.api.fs.convertText({ profileId: profileId.value, path: t.path, fromEncoding: f.from, toEncoding: f.to, newline: f.newline })
    convertOpen.value = false
    if (!r.encodingChanged && !r.newlineChanged) ElMessage.info(`内容已是 ${r.detected} 编码且换行符符合要求，未做修改`)
    else ElMessage.success(`已转换：${r.detected} → ${f.to}${r.newlineChanged ? ' + 换行符' : ''}（${fsFormatSize(r.bytes)}）`)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally { convertSaving.value = false }
}

// ── §十一：压缩 / 解压（仅本地通道，fflate）──
async function doZip(targets?: FsEntry[]): Promise<void> {
  if (!hasWritable.value || activeChannel.value?.type !== 'local') { ElMessage.warning('压缩仅支持可写的本地目录通道'); return }
  const list0 = targets ?? selectedEntries.value
  if (!list0.length) return
  const first = list0[0]!
  const defaultName = list0.length === 1 ? `${first.name}.zip` : `选中${list0.length}项.zip`
  try {
    const { value } = await ElMessageBox.prompt('在当前目录创建 zip 压缩包，输入文件名', '压缩', {
      confirmButtonText: '压缩', cancelButtonText: '取消',
      inputValue: defaultName,
      inputPattern: /^[^\\/:]+\.zip$/i, inputErrorMessage: '文件名不能含斜杠且须以 .zip 结尾',
      closeOnClickModal: false, closeOnPressEscape: false,
    })
    const name = String(value ?? '').trim()
    if (!name) return
    zipSaving.value = true
    const zipPath = path.value === '/' ? `/${name}` : `${path.value}/${name}`
    const r = await window.api.fs.zip({
      profileId: profileId.value,
      zipPath,
      sources: list0.map((e) => ({ path: e.path, kind: e.kind })),
    })
    ElMessage.success(`已压缩 ${r.files} 个文件 → ${name}（${fsFormatSize(r.size)}）`)
    void list(false)
  } catch (err) {
    if ((err as Error).message !== 'cancel' && err !== 'cancel') ElMessage.error(friendlyError(err))
  } finally { zipSaving.value = false }
}
// ── 解压到…（用户 2026-11-19 定版）：目标通道可选（跨源解压）+ 目录手输/级联
//    （不存在自动创建）+ 目标已有同名条目时覆盖确认。zip 从源通道读入内存后写入目标通道。 ──
const unzipOpen = ref(false)
const unzipSaving = ref(false)
const unzipEntry = ref<FsEntry | null>(null)
const unzipDestProfile = ref('')
const unzipDirInput = ref('')
const unzipCascaderRef = ref<{ togglePopperVisible: (v: boolean) => void } | null>(null)
const unzipDirProps = dirLazyProps(() => unzipDestProfile.value)

function openUnzip(entry: FsEntry): void {
  if (!hasWritable.value) { ElMessage.warning('当前没有可写的目标通道，无法解压'); return }
  if (!isFsZipName(entry.name)) { ElMessage.warning('仅支持 .zip 压缩包'); return }
  unzipEntry.value = entry
  unzipDestProfile.value = profileId.value
  const base = entry.name.replace(/\.zip$/i, '')
  const parent = entry.path.lastIndexOf('/') <= 0 ? '/' : entry.path.slice(0, entry.path.lastIndexOf('/'))
  unzipDirInput.value = parent === '/' ? `/${base}` : `${parent}/${base}`
  unzipOpen.value = true
}
function onUnzipDirPicked(v: unknown): void {
  unzipDirInput.value = String(v ?? '')
  unzipCascaderRef.value?.togglePopperVisible(false)
}
async function submitUnzip(overwrite = false): Promise<void> {
  const entry = unzipEntry.value
  if (!entry || unzipSaving.value) return
  const destDir = normalizeDestInput(unzipDirInput.value)
  if (destDir === null) { ElMessage.warning('目录路径非法（不能含 . / .. 段）'); return }
  if (!destDir || destDir === '/') { ElMessage.warning('目标目录不能为根目录，请填写具体目录（不存在会自动创建）'); return }
  unzipSaving.value = true
  try {
    const r = await window.api.fs.unzip({ profileId: profileId.value, path: entry.path, destProfileId: unzipDestProfile.value, destDir, overwrite })
    unzipOpen.value = false
    ElMessage.success(`已解压 ${r.files} 个文件 → ${unzipDestProfile.value === profileId.value ? r.destDir : `${unzipDestProfile.value}:${r.destDir}`}`)
    if (unzipDestProfile.value === profileId.value) void list(false)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.startsWith('__UNZIP_CONFLICT__:')) {
      // 目标目录已有同名条目：覆盖确认（用户拍板三选收敛为 覆盖/取消，改目录回弹框改）
      try {
        await ElMessageBox.confirm(`目标目录已存在同名条目：${msg.slice('__UNZIP_CONFLICT__:'.length)}。覆盖解压（同名文件将被覆盖）？`, '目标已有同名条目', {
          type: 'warning', confirmButtonText: '覆盖解压', cancelButtonText: '取消',
          closeOnClickModal: false, closeOnPressEscape: false,
        })
        // 递归重试前放行保存守卫（本次调用尚未走出 catch，finally 尚未复位）
        unzipSaving.value = false
        await submitUnzip(true)
      } catch { /* 取消：留在弹框可改目录 */ }
    } else {
      ElMessage.error(friendlyError(err))
    }
  } finally { unzipSaving.value = false }
}
async function newFile(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新建空白文本文件，输入文件名（如 page.html）', '新建文件', {
      confirmButtonText: '创建并编辑', cancelButtonText: '取消',
      inputPattern: /^[^\\/:]+$/, inputErrorMessage: '文件名不能含斜杠',
      closeOnClickModal: false, closeOnPressEscape: false,
    })
    const name = String(value ?? '').trim()
    if (!name) return
    const full = path.value === '/' ? `/${name}` : `${path.value}/${name}`
    await window.api.fs.write({ profileId: profileId.value, path: full, contentBase64: '' })
    void list(false)
    await openFile({ kind: 'file', name, path: full })
  } catch { /* 取消 */ }
}

// ── 编辑保存（冲突检测 §四） ──
async function saveEditor(): Promise<void> {
  const ed = editor.value
  if (ed.readonly || ed.saving || !profileId.value) return
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
    await window.api.fs.write({ profileId: profileId.value, path: ed.path, contentBase64, expect: { etag: ed.etag, size: ed.size, modified: ed.modified } })
    ElMessage.success('已保存到远端')
    ed.open = false
    void list(false)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('已变化')) {
      ed.conflict = true
      ElMessageBox.confirm('远端文件在你编辑期间已被修改。覆盖远端内容，还是放弃本次修改？', '保存冲突', {
        confirmButtonText: '覆盖远端', cancelButtonText: '放弃修改', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false,
      }).then(async () => {
        try {
          await window.api.fs.write({ profileId: profileId.value, path: ed.path, contentBase64, force: true })
          ElMessage.success('已覆盖保存')
          ed.open = false
          void list(false)
        } catch (err2) { ElMessage.error(friendlyError(err2)) }
      }).catch(() => { /* 放弃 */ })
    } else {
      ElMessage.error(friendlyError(err))
    }
  } finally {
    ed.saving = false
  }
}

// ── plans/10 传输设置（分片开关/阈值/片大小/并发实时生效；遗留分片清理，二次确认）──
const transferCfgOpen = ref(false)
const transferCfgForm = ref({ enabled: true, thresholdMb: 50, partSizeMb: 5, partsConcurrency: 3 })
const transferCfgSaving = ref(false)
const transferCfgOrphans = ref(0)
async function openTransferConfig(): Promise<void> {
  try {
    const s = await window.api.fs.transferMultipart()
    transferCfgForm.value = { enabled: s.enabled, thresholdMb: s.thresholdMb, partSizeMb: s.partSizeMb, partsConcurrency: s.partsConcurrency }
    transferCfgOrphans.value = s.orphans
  } catch { transferCfgOrphans.value = 0 }
  transferCfgOpen.value = true
}
async function submitTransferConfig(): Promise<void> {
  transferCfgSaving.value = true
  try {
    const s = await window.api.fs.setTransferMultipart({
      enabled: transferCfgForm.value.enabled,
      thresholdMb: transferCfgForm.value.thresholdMb,
      partSizeMb: transferCfgForm.value.partSizeMb,
      partsConcurrency: transferCfgForm.value.partsConcurrency,
    })
    transferCfgForm.value = { enabled: s.enabled, thresholdMb: s.thresholdMb, partSizeMb: s.partSizeMb, partsConcurrency: s.partsConcurrency }
    ElMessage.success('传输设置已保存（实时生效）')
    transferCfgOpen.value = false
  } catch (err) { ElMessage.error(friendlyError(err)) }
  finally { transferCfgSaving.value = false }
}
async function cleanOrphansInCfg(): Promise<void> {
  if (!transferCfgOrphans.value) return
  const ok = await ElMessageBox.confirm(
    `清理服务端遗留的 ${transferCfgOrphans.value} 个分片上传？正在别处进行的同名上传会被中止。`,
    '遗留分片清理',
    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false, closeOnPressEscape: false },
  ).then(() => true, () => false)
  if (!ok) return
  try {
    const n = await window.api.fs.cleanOrphanUploads()
    ElMessage.success(n ? `已清理 ${n} 个遗留分片` : '没有可清理的遗留分片')
    transferCfgOrphans.value = (await window.api.fs.transferMultipart()).orphans
  } catch (err) { ElMessage.error(friendlyError(err)) }
}

async function openDownloadDir(): Promise<void> {
  if (!profileId.value) return
  const dir = await window.api.fs.downloadDir(profileId.value)
  await window.api.os.shellOpen(dir)
}
async function changeDownloadDir(): Promise<void> {
  const dir = await window.api.os.pickDir()
  if (!dir) return
  await window.api.fs.setDownloadDir(dir)
  ElMessage.success('下载目录已更新')
}

// ── 传输事件订阅 + 完成自动刷新 ──
let refreshTimer: number | undefined
function scheduleRefresh(): void {
  if (refreshTimer !== undefined) return
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined
    if (runningCount.value === 0) void list(false)
  }, 1200)
}
onMounted(() => {
  window.api.fs.onTransferEvent((task) => {
    tasks.value.set(task.id, task)
    tasks.value = new Map(tasks.value)
    if (task.status === 'success' && (task.kind === 'upload' || task.kind === 'delete' || task.kind === 'copy' || task.kind === 'cross')) scheduleRefresh()
  })
  // 管理员模式提示：Windows UIPI 会拦截「低权限资源管理器 → 高权限应用」的拖放（系统级，代码无法绕过）
  void window.api.os.isElevated().then((v) => { elevated.value = v })
  // 网格右键菜单：点击任意处 / 在非卡片处右键 / Escape 关闭
  window.addEventListener('click', onWindowCtxMaybeClose)
  window.addEventListener('contextmenu', onWindowCtxMaybeClose)
  void loadChannels().then(() => { if (profileId.value) void list() })
  void loadFavorites() // §十一 收藏夹
  void loadMediaLimit() // 在线预览上限（可配）
  // 队列已有历史任务（页面刷新恢复）
  void window.api.fs.transferList().then((list0) => {
    for (const t of list0) tasks.value.set(t.id, t)
    tasks.value = new Map(tasks.value)
  })
  // 拖拽上传：window 级监听（见 onWindowDrop 注释）；capture 相位保证先于任何子元素拿到事件
  window.addEventListener('dragenter', onWindowDragEnter, { capture: true })
  window.addEventListener('dragover', onWindowDragOver, { capture: true })
  window.addEventListener('dragleave', onWindowDragLeave, { capture: true })
  window.addEventListener('drop', onWindowDrop, { capture: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowCtxMaybeClose)
  window.removeEventListener('contextmenu', onWindowCtxMaybeClose)
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
  window.removeEventListener('dragenter', onWindowDragEnter, { capture: true } as EventListenerOptions)
  window.removeEventListener('dragover', onWindowDragOver, { capture: true } as EventListenerOptions)
  window.removeEventListener('dragleave', onWindowDragLeave, { capture: true } as EventListenerOptions)
  window.removeEventListener('drop', onWindowDrop, { capture: true } as EventListenerOptions)
})

// ── 键盘（§3.3） ──
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && ctxMenu.value) { ctxMenu.value = null; return }
  if (preview.value.open || editor.value.open || player.value.open || mkdirOpen.value || renameOpen.value || moveOpen.value || deleteOpen.value) return
  const target = event.target as HTMLElement
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
  if (event.key === 'F5') { event.preventDefault(); refresh(); return }
  if (event.key === 'Delete' && selectedEntries.value.length) { event.preventDefault(); openDelete(selectedEntries.value); return }
  if (event.key === 'F2' && selectedEntries.value.length === 1) { event.preventDefault(); openRename(selectedEntries.value[0]!); return }
  if (event.key === 'Backspace') { event.preventDefault(); goUp(); return }
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  if (event.key === 'a' || event.key === 'A') { event.preventDefault(); selectAll() }
  else if (event.key === 'c' || event.key === 'C') { event.preventDefault(); clipCopy('copy') }
  else if (event.key === 'x' || event.key === 'X') { event.preventDefault(); clipCopy('cut') }
  else if (event.key === 'v' || event.key === 'V') { event.preventDefault(); void paste() }
}
</script>

<template>
  <div class="fs-page" tabindex="0" @keydown="onKeydown">
    <!-- 通道切换条 -->
    <div class="fs-channel-bar">
      <el-select v-model="profileId" size="small" class="fs-channel-select" placeholder="选择上传通道" filterable>
        <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="c.name">
          <span class="fs-channel-opt">
            <el-tag size="small" :type="c.type === 'cloud' ? 'success' : c.type === 'local' ? 'info' : 'warning'" class="fs-opt-tag">
              {{ c.type === 'cloud' ? '云' : c.type === 'local' ? '本地' : (c.protocol ?? '远端').toUpperCase() }}
            </el-tag>
            <span class="fs-opt-name">{{ c.name }}</span>
            <span class="fs-opt-detail">{{ c.detail }}</span>
            <el-tag v-if="c.isDefault" size="small" type="primary" effect="plain" class="fs-opt-tag">默认</el-tag>
          </span>
        </el-option>
      </el-select>
      <span v-if="activeChannel" class="fs-channel-meta">
        <span v-if="!activeChannel.hasSecret" class="fs-warn">密钥未配置，去「通道配置」填写</span>
        <span v-else-if="!hasWritable" class="fs-warn">该厂商仅支持浏览（写操作支持阿里云 OSS / AWS S3）</span>
        <span v-else class="fs-ok">已连接 · {{ activeChannel.detail }}</span>
      </span>
    </div>

    <!-- 路径区 -->
    <div class="fs-path-bar">
      <!-- 导航：图标+文字（纯图标易被误读成历史后退/前进，实际只有「上一级」语义） -->
      <el-button size="small" type="primary" plain class="fs-nav-btn" :icon="Back" title="回到上一级目录 (Backspace)" @click="goUp">上一级</el-button>
      <el-button size="small" type="primary" plain class="fs-nav-btn" :icon="Refresh" title="刷新当前目录 (F5)" @click="refresh">刷新</el-button>
      <div v-if="!pathEditing" class="fs-crumbs" @dblclick="pathEditing = true">
        <span class="fs-crumb fs-crumb-root" @click="gotoCrumb(-1)">{{ activeChannel?.name ?? '通道' }}</span>
        <template v-for="(seg, i) in crumbs" :key="i">
          <span class="fs-crumb-sep">/</span>
          <span class="fs-crumb" @click="gotoCrumb(i)">{{ seg }}</span>
        </template>
      </div>
      <el-input clearable
        v-else
        v-model="pathInput"
        size="small"
        class="fs-path-input"
        placeholder="输入路径回车直达（oss:// 风格可省前缀，'..' 会被拒绝）"
        autofocus
        @keyup.enter="submitPathInput"
        @blur="pathEditing = false"
      />
      <el-input
        v-model="filter"
        size="small"
        class="fs-filter"
        :prefix-icon="Search"
        placeholder="当前目录内搜索；回车 = 递归搜索"
        clearable
        @keyup.enter="runSearch"
      />
      <el-button-group class="fs-view-toggle">
        <el-button size="small" :type="viewMode === 'list' ? 'primary' : 'default'" :icon="MenuIcon" title="列表视图" @click="viewMode = 'list'" />
        <el-button size="small" :type="viewMode === 'grid' ? 'primary' : 'default'" :icon="Grid" title="网格视图" @click="viewMode = 'grid'" />
      </el-button-group>
    </div>

    <!-- 工具栏（§3.1 并集：常用操作外置，仅次要项进「更多▾」） -->
    <div class="fs-toolbar">
      <el-dropdown @command="(c: unknown) => (String(c) === 'dir' ? uploadDirs() : String(c) === 'output' ? uploadFromOutput() : uploadFiles())">
        <el-button size="small" type="success" :icon="Upload" :disabled="!profileId">上传</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="file">上传文件</el-dropdown-item>
            <el-dropdown-item command="dir">上传文件夹（保留结构）</el-dropdown-item>
            <el-dropdown-item command="output">从 EDM 产物目录选择…</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" type="primary" :icon="Download" :disabled="!selectedEntries.length" @click="downloadEntries(selectedEntries)">下载</el-button>
      <el-button size="small" type="primary" plain :icon="FolderAdd" :disabled="!hasWritable || !profileId" @click="mkdirOpen = true">新建文件夹</el-button>
      <el-button size="small" type="primary" plain :icon="Document" :disabled="!hasWritable || !profileId" @click="newFile">新建文件</el-button>
      <el-button size="small" type="warning" plain :icon="CopyDocument" title="复制到剪贴板，再到目标目录点「粘贴」；行内「复制」是弹框直落" :disabled="!selectedEntries.length" @click="clipCopy('copy')">复制（剪贴板）</el-button>
      <el-button size="small" type="success" plain :icon="Plus" title="粘贴 (Ctrl+V)；跨通道粘贴按复制执行" :disabled="!clipboard || !hasWritable" @click="paste">
        粘贴{{ clipboard ? `（${clipboard.items.length} 项${clipboard.op === 'cut' ? ' · 剪切' : ''}${clipboard.profileId !== profileId ? ' · 跨通道' : ''}）` : '' }}
      </el-button>
      <!-- 用户 2026-11-19：复制后不想粘贴（误触）可一键清空剪贴板 -->
      <el-button v-if="clipboard" size="small" type="danger" text title="清空剪贴板（不执行粘贴）" @click="clearClipboard">清空</el-button>
      <el-button size="small" type="warning" plain :icon="Rank" :disabled="!selectedEntries.length || !hasWritable" @click="openMove('move')">移动</el-button>
      <el-button size="small" type="primary" plain :icon="EditPen" :disabled="selectedEntries.length !== 1 || !hasWritable" @click="openRename(selectedEntries[0]!)">重命名</el-button>
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selectedEntries.length || !hasWritable" @click="openDelete(selectedEntries)">删除</el-button>
      <el-dropdown @command="moreCommand">
        <el-button size="small" :icon="MenuIcon">
          更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <!-- 整理组（§11.3：顶部既有按钮保持不动，新增操作全部分组收纳） -->
            <el-dropdown-item command="note" :icon="ChatDotRound" :disabled="!selectedEntries.length || !hasWritable">设置备注…</el-dropdown-item>
            <el-dropdown-item command="favorite" :icon="CollectionTag" :disabled="!selectedEntries.length || !profileId">添加收藏</el-dropdown-item>
            <el-dropdown-item command="favorites" :icon="Star">收藏夹…</el-dropdown-item>
            <el-dropdown-item command="copypath" :icon="CopyDocument" :disabled="!selectedEntries.length">复制路径</el-dropdown-item>
            <el-dropdown-item command="zip" :icon="Box" :disabled="!canZip">压缩为 zip…</el-dropdown-item>
            <el-dropdown-item command="unzip" :icon="FolderOpened" :disabled="!canUnzip">解压到…</el-dropdown-item>
            <el-dropdown-item command="convert" :icon="MagicStick" :disabled="!canConvert">转换文本编码 / 换行符…</el-dropdown-item>
            <!-- 权限与信息组 -->
            <el-dropdown-item command="perm" :icon="Lock" divided :disabled="!canPerm">编辑权限…</el-dropdown-item>
            <el-dropdown-item command="props" :icon="InfoFilled" :disabled="selectedEntries.length !== 1">属性</el-dropdown-item>
            <el-dropdown-item command="usage" :icon="TrendCharts" :disabled="!selSingleDir">统计选中目录容量</el-dropdown-item>
            <!-- 视图与设置组 -->
            <el-dropdown-item command="copyto" :icon="CopyDocument" divided :disabled="!selectedEntries.length">复制到…</el-dropdown-item>
            <el-dropdown-item command="cols" :icon="Grid">列设置…</el-dropdown-item>
            <el-dropdown-item command="ziplimits" :icon="Setting">压缩上限设置…</el-dropdown-item>
            <el-dropdown-item command="transfercaps" :icon="Setting">上限设置…</el-dropdown-item>
            <el-dropdown-item command="transferconfig" :icon="Setting">传输设置…</el-dropdown-item>
            <el-dropdown-item command="refresh" :icon="Refresh">刷新（F5）</el-dropdown-item>
            <el-dropdown-item command="downloaddir" :icon="MenuIcon">下载目录设置…</el-dropdown-item>
            <el-dropdown-item command="opendir" :icon="Folder">打开本地下载目录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 文件列表 -->
    <el-alert
      v-if="elevated && !adminTipDismissed"
      class="fs-admin-tip"
      type="warning" closable show-icon
      title="当前以管理员模式运行：Windows 系统会拦截资源管理器向本应用的拖放（UIPI 安全限制），请改用「上传文件」按钮选择，或以普通权限运行应用"
      @close="dismissAdminTip"
    />
    <div class="fs-list" :class="{ 'is-drag': dragOver }">
      <!-- 递归搜索结果横幅（二期） -->
      <div v-if="searchActive" class="fs-search-banner">
        <span class="fs-search-info">
          <el-icon v-if="searchLoading" class="fs-search-spin"><Loading /></el-icon>
          <span>递归搜索「{{ filter.trim() }}」：{{ searchLoading ? `已找到 ${searchEntries.length} 个 · 已扫描 ${searchScannedDirs} 个目录…` : `${searchEntries.length} 个结果` }}{{ searchTruncated ? '（已达扫描上限，结果可能不全）' : '' }}</span>
        </span>
        <el-button size="small" text type="primary" @click="exitSearch">返回目录</el-button>
      </div>
      <div v-if="!profileId" class="fs-empty">
        <p>还没有配置上传通道</p>
        <p class="fs-empty-hint">到「通道配置」页添加远程（FTP/SFTP）或云（OSS 等）profile 后即可浏览管理远端文件。</p>
      </div>
      <div v-else-if="pageError" class="fs-empty fs-error">
        <p>加载失败：{{ pageError }}</p>
        <el-button size="small" type="primary" plain @click="refresh">重试</el-button>
      </div>
      <!-- 流式搜索：首批结果到达即渲染列表，不再因 searchLoading 一直白屏 -->
      <div v-else-if="loading || (searchLoading && searchEntries.length === 0)" class="fs-empty"><p>{{ searchLoading ? '递归搜索中…' : '加载中…' }}</p></div>
      <div v-else-if="filteredEntries.length === 0" class="fs-empty">
        <p>{{ searchActive ? '递归搜索没有结果' : (filter ? '没有匹配的文件' : '此目录为空') }}</p>
        <p class="fs-empty-hint">{{ searchActive ? '换个关键词，或到上级目录再搜' : '把文件或文件夹拖进来即可上传到当前目录' }}</p>
      </div>

      <!-- 列表视图：单一 grid 容器 + subgrid 行——表头/数据行共用同一组列轨道，
           修复操作列 max-content 被两个独立 grid 各自计算导致的列错位（用户 2026-11-18） -->
      <template v-else-if="viewMode === 'list'">
        <div class="fs-table" :style="{ gridTemplateColumns: listGridCols }">
          <div class="fs-thead">
            <span class="fs-col-check">
              <el-checkbox :model-value="selection.size > 0 && selection.size === filteredEntries.length" :indeterminate="selection.size > 0 && selection.size < filteredEntries.length" @change="selectAll" />
            </span>
            <span class="fs-col-name fs-sortable" @click="sortKey = 'name'; sortDir = sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc'">名称{{ sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span class="fs-col-size fs-sortable" @click="sortKey = 'size'; sortDir = sortKey === 'size' && sortDir === 'asc' ? 'desc' : 'asc'">类型/大小{{ sortKey === 'size' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span class="fs-col-time fs-sortable" @click="sortKey = 'time'; sortDir = sortKey === 'time' && sortDir === 'asc' ? 'desc' : 'asc'">修改时间{{ sortKey === 'time' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span v-if="colShown.createdAt" class="fs-col-time">创建时间</span>
            <span v-if="colShown.mode" class="fs-col-mode">权限</span>
            <span v-if="colShown.owner" class="fs-col-owner">用户/组</span>
            <span v-if="colShown.note" class="fs-col-note">备注</span>
            <span class="fs-col-op">操作</span>
          </div>
          <div
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="fs-row"
            :class="{ selected: selection.has(entry.path) }"
            @click="rowClick(entry, $event)"
            @dblclick="rowOpen(entry)"
          >
          <span class="fs-col-check"><el-checkbox :model-value="selection.has(entry.path)" @click.stop @dblclick.stop @change="toggleCheck(entry)" /></span>
          <span class="fs-col-name">
            <el-icon class="fs-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
            <span class="fs-name" :class="{ 'is-dir': entry.kind === 'dir' }" :title="entry.path">{{ entry.name }}</span>
            <!-- 分享状态标记（用户 2026-11-19）：统一 Connection 图标，绿=自己的分享、橙=随父级；点击优先复制自己、否则父级 -->
            <el-tooltip v-if="shareMarkOf(entry).kind !== 'none'" :content="shareMarkTip(entry)" placement="top">
              <el-icon
                class="fs-share-mark"
                :class="shareMarkOf(entry).kind === 'own' ? 'is-own' : 'is-inherited'"
                @click.stop="copyShareLink(entry)"
              ><Connection /></el-icon>
            </el-tooltip>
            <span v-if="searchDirHint(entry)" class="fs-name-sub" :title="entry.path">{{ searchDirHint(entry) }}</span>
            <el-icon v-if="entry.kind === 'dir' && isUsageLoading(entry.path)" class="fs-usage-spin is-loading" title="正在统计…"><Loading /></el-icon>
            <el-button
              size="small" text
              class="fs-fav-toggle"
              :class="{ 'is-fav': isFavorited(entry.path) }"
              :title="isFavorited(entry.path) ? '取消收藏' : '收藏'"
              :aria-label="isFavorited(entry.path) ? '取消收藏' : '收藏'"
              @click.stop="toggleFav(entry)"
            ><el-icon><component :is="isFavorited(entry.path) ? StarFilled : Star" /></el-icon></el-button>
          </span>
          <span class="fs-col-size" :title="sizeCell(entry)">{{ sizeCell(entry) }}</span>
          <span class="fs-col-time" :title="fmtTime(entry.modified)">{{ fmtTime(entry.modified) }}</span>
          <span v-if="colShown.createdAt" class="fs-col-time" :title="fmtTime(entry.createdAt)">{{ fmtTime(entry.createdAt) }}</span>
          <span v-if="colShown.mode" class="fs-col-mode" :title="entry.mode ? `${entry.mode} ${fsModeToRwx(entry.mode)}` : ''">{{ entry.mode ?? '—' }}</span>
          <span v-if="colShown.owner" class="fs-col-owner" :title="entry.owner ? `${entry.owner}:${entry.group ?? ''}` : ''">{{ entry.owner ? `${entry.owner}:${entry.group ?? '—'}` : '—' }}</span>
          <span v-if="colShown.note" class="fs-col-note" :title="annotations.get(entry.path) ?? ''">{{ annotations.get(entry.path) ?? '' }}</span>
          <span class="fs-col-op">
            <!-- §11.4 顺序（用户 2026-11-18 改版：下载不区分文件/目录，统一放删除前）：
                 链接(文件)→粘贴(目录)→复制→移动→重命名→下载(全部)→删除→更多▾ -->
            <!-- 远程/云通道：baseUrl 裸链；本地通道：ShareHub 分享链接（用户 2026-11-19 定版，二者互斥按通道） -->
            <el-button v-if="entry.kind === 'file' && activeChannel?.type !== 'local'" size="small" text type="primary" title="复制外链（baseUrl + 文件路径）" @click.stop="rowLink(entry)">链接</el-button>
            <el-button v-if="canShareEntry()" size="small" text type="success" :title="entry.kind === 'dir' ? '分享目录（可勾选允许浏览整棵子树；带有效期、可撤销）' : '分享该文件（带有效期、可撤销）'" @click.stop="rowShare(entry)">分享链接</el-button>
            <el-button v-if="entry.kind === 'dir' && clipboard && hasWritable" size="small" text type="success" title="把剪贴板内容粘贴进该目录" @click.stop="rowPaste(entry)">粘贴</el-button>
            <el-button v-if="hasWritable" size="small" text type="warning" @click.stop="rowCopy(entry)">复制</el-button>
            <el-button v-if="hasWritable" size="small" text type="warning" @click.stop="rowMove(entry)">移动</el-button>
            <el-button v-if="hasWritable" size="small" text type="primary" @click.stop="openRename(entry)">重命名</el-button>
            <el-button size="small" text type="success" :title="entry.kind === 'dir' ? '目录递归下载到下载目录' : '下载到下载目录'" @click.stop="downloadEntries([entry])">下载</el-button>
            <el-button v-if="hasWritable" size="small" text type="danger" @click.stop="openDelete([entry])">删除</el-button>
            <el-dropdown trigger="click" @command="(c: unknown) => rowMoreCommand(String(c), entry)">
              <el-button size="small" text @click.stop>更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <!-- 信息组 -->
                  <el-dropdown-item command="props" :icon="InfoFilled">属性</el-dropdown-item>
                  <el-dropdown-item v-if="entry.kind === 'dir'" command="usage" :icon="TrendCharts">统计</el-dropdown-item>
                  <el-dropdown-item command="note" :icon="ChatDotRound">设置备注…</el-dropdown-item>
                  <el-dropdown-item command="favorite" :icon="CollectionTag">{{ isFavorited(entry.path) ? '取消收藏' : '添加收藏' }}</el-dropdown-item>
                  <el-dropdown-item command="copypath" :icon="CopyDocument">复制路径</el-dropdown-item>
                  <!-- 工具组（按通道与文件类型实时显隐：压缩/解压仅本地，文本转换仅文本扩展） -->
                  <template v-if="activeChannel?.type === 'local'">
                    <el-dropdown-item command="zip" :icon="Box" divided>压缩为 zip…</el-dropdown-item>
                    <el-dropdown-item v-if="isFsZipName(entry.name)" command="unzip" :icon="FolderOpened">解压到…</el-dropdown-item>
                  </template>
                  <el-dropdown-item v-if="entry.kind === 'file' && isFsTextName(entry.name)" command="convert" :icon="MagicStick" divided>转换编码 / 换行符…</el-dropdown-item>
                  <!-- 权限组（ShareHub 分享已外显为行操作「分享链接」，不再在更多菜单重复） -->
                  <el-dropdown-item v-if="hasMode" command="perm" :icon="Lock" divided :disabled="!entry.mode">编辑权限…</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
          </div>
          <div v-if="cursor" class="fs-more">
            <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多…</el-button>
          </div>
        </div>
      </template>

      <!-- 网格视图 -->
      <template v-else>
        <div class="fs-grid">
          <div
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="fs-cell"
            :class="{ selected: selection.has(entry.path) }"
            :title="`${entry.name}\n${entry.kind === 'dir' ? '目录' : fsFormatSize(entry.size)} · ${fmtTime(entry.modified)}`"
            @click="rowClick(entry, $event)"
            @dblclick="rowOpen(entry)"
            @contextmenu.prevent="openCtxMenu(entry, $event)"
          >
            <el-icon class="fs-cell-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
            <span class="fs-cell-name">{{ entry.name }}</span>
            <el-tooltip v-if="shareMarkOf(entry).kind !== 'none'" :content="shareMarkTip(entry)" placement="top">
              <el-icon
                class="fs-share-mark"
                :class="shareMarkOf(entry).kind === 'own' ? 'is-own' : 'is-inherited'"
                @click.stop="copyShareLink(entry)"
              ><Connection /></el-icon>
            </el-tooltip>
            <span v-if="searchDirHint(entry)" class="fs-cell-dir" :title="entry.path">{{ searchDirHint(entry) }}</span>
            <span class="fs-cell-meta">{{ sizeCell(entry) }}</span>
          </div>
        </div>
        <div v-if="cursor" class="fs-more">
          <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多…</el-button>
        </div>
      </template>
    </div>

    <!-- 状态条 -->
    <div class="fs-status">
      <span>共 {{ filteredEntries.length }} 项（{{ filteredEntries.filter((e) => e.kind === 'dir').length }} 目录 / {{ filteredEntries.filter((e) => e.kind === 'file').length }} 文件）</span>
      <span v-if="selection.size"> · 已选 {{ selection.size }} 项</span>
      <span class="fs-spacer" />
      <el-button size="small" text type="primary" :icon="MenuIcon" @click="openTransferPanel">
        传输队列{{ runningCount ? `（${runningCount} 进行中）` : '' }}
      </el-button>    </div>

    <!-- 拖拽遮罩提示 -->
    <div v-if="dragOver" class="fs-drop-mask">
      <div class="fs-drop-box">松开鼠标上传到当前目录</div>
    </div>

    <!-- 新建目录 -->
    <el-dialog v-model="mkdirOpen" title="新建文件夹" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input ref="mkdirInputRef" clearable v-model="mkdirName" data-autofocus placeholder="目录名（不含斜杠）" @keyup.enter="submitMkdir" />
      <template #footer>
        <el-button @click="mkdirOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMkdir">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog v-model="renameOpen" title="重命名" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input ref="renameInputRef" clearable v-model="renameName" data-autofocus @keyup.enter="submitRename" />
      <template #footer>
        <el-button @click="renameOpen = false">取消</el-button>
        <el-button type="primary" @click="submitRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 复制到 / 移动到 -->
    <el-dialog v-model="moveOpen" :title="moveMode === 'move' ? '移动到…' : '复制到…'" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div class="fs-move-body">
        <!-- 项20：复制/移动都可选目标通道；跨通道走传输队列，移动=复制成功删源 -->
        <template v-if="moveMode === 'copy' || moveMode === 'move'">
          <div class="hint" style="margin-bottom: 6px">目标通道（选择其它通道即跨通道{{ moveMode === 'move' ? '移动（复制后删源）' : '复制' }}，走传输队列）：</div>
          <el-select v-model="moveDestProfile" size="small" style="width: 100%; margin-bottom: 12px" filterable>
            <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="`${c.name}（${c.detail}）`" :disabled="!c.hasSecret" />
          </el-select>
        </template>
        <div class="hint" style="margin-bottom: 8px">目标目录（如 /a/b；留空或 / 为根目录）：</div>
        <el-input clearable v-model="moveDirInput" placeholder="/a/b，也可从下方目录树选择" @keyup.enter="submitMove" />
        <el-cascader
          ref="moveCascaderRef"
          :key="moveDestProfile || profileId || ''"
          class="fs-move-cascader"
          :props="moveDirProps"
          separator="/"
          popper-class="fs-dir-cascader-popper"
          size="small"
          placeholder="或从目录树选择目标目录（逐级下钻，点圈选中）"
          clearable
          style="width: 100%; margin-top: 8px"
          @change="onMoveDirPicked"
        />
        <div style="margin-top: 10px; display: flex; gap: 12px; align-items: center">
          <div class="fs-crumb" @click="moveDirInput = '/'">根目录 /</div>
          <div class="fs-crumb" @click="moveDirInput = path">填当前目录：{{ path === '/' ? '/（根）' : path }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="moveOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMove">{{ moveMode === 'move' ? '移动' : '复制' }}</el-button>
      </template>
    </el-dialog>

    <!-- 解压到…（目标通道可选=跨源解压；目录手输/级联，不存在自动创建；同名条目覆盖确认） -->
    <el-dialog v-model="unzipOpen" title="解压到…" width="500px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="unzipEntry">
        <div class="hint" style="margin-bottom: 8px">把「{{ unzipEntry.name }}」解压到目标目录（目录不存在将自动创建）：</div>
        <div class="hint" style="margin-bottom: 6px">目标通道（选择其它通道即跨源解压：zip 读入内存后写入目标通道，受压缩上限约束）：</div>
        <el-select v-model="unzipDestProfile" size="small" style="width: 100%; margin-bottom: 12px" filterable>
          <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="`${c.name}（${c.detail}）`" :disabled="!c.hasSecret" />
        </el-select>
        <div class="hint" style="margin-bottom: 8px">目标目录（如 /docs/output；留空或 / 不可用，须为具体目录路径）：</div>
        <el-input clearable v-model="unzipDirInput" placeholder="/a/b，也可从下方目录树选择" data-autofocus @keyup.enter="submitUnzip()" />
        <el-cascader
          ref="unzipCascaderRef"
          :key="unzipDestProfile || profileId || ''"
          class="fs-move-cascader"
          :props="unzipDirProps"
          separator="/"
          popper-class="fs-dir-cascader-popper"
          size="small"
          placeholder="或从目录树选择目标目录（逐级下钻，点圈选中）"
          clearable
          style="width: 100%; margin-top: 8px"
          @change="onUnzipDirPicked"
        />
        <div class="hint" style="margin-top: 10px">默认 = zip 所在目录下以 zip 名新建目录。目标目录中已有同名条目时会先询问是否覆盖。</div>
      </template>
      <template #footer>
        <el-button @click="unzipOpen = false">取消</el-button>
        <el-button type="primary" :loading="unzipSaving" @click="submitUnzip()">解压</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认（纯文件，无目录时） -->
    <el-dialog v-model="deleteOpen" title="删除确认" width="460px" :close-on-click-modal="false" :close-on-press-escape="false">
      <p>确定删除以下 {{ deleteTargets.length }} 项吗？此操作不可恢复。</p>
      <p class="fs-delete-list">{{ deleteTargets.map((e) => e.name).join('、') }}</p>
      <template #footer>
        <el-button @click="deleteOpen = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">删除</el-button>
      </template>
    </el-dialog>

    <!-- 图片预览 -->
    <el-dialog v-model="preview.open" :title="preview.name" width="720px" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-preview-dialog" @close="onPreviewClose">
      <div class="fs-preview-body">
        <iframe v-if="preview.pdfUrl" :src="preview.pdfUrl" class="fs-preview-pdf" title="PDF 预览" />
        <img v-else :src="preview.src" :style="{ transform: `scale(${preview.scale})` }" alt="preview" />
      </div>
      <template #footer>
        <template v-if="!preview.pdfUrl">
          <el-button size="small" type="primary" plain @click="preview.scale = Math.max(0.2, preview.scale - 0.2)">缩小</el-button>
          <el-button size="small" type="primary" plain @click="preview.scale = 1">复位</el-button>
          <el-button size="small" type="primary" plain @click="preview.scale = Math.min(5, preview.scale + 0.2)">放大</el-button>
        </template>
        <el-button size="small" @click="preview.open = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 文本编辑器（文件名 · 大小 统计信息置顶，用户 2026-11-18） -->
    <el-dialog v-model="editor.open" width="900px" top="4vh" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-editor-dialog">
      <template #header>
        <span class="fs-editor-title">{{ editor.name }}<span class="fs-editor-meta">{{ fsFormatSize(editor.size) }}</span></span>
      </template>
      <div class="fs-editor-body">
        <CodeEditor v-model="editor.content" :path="editor.path" :readonly="editor.readonly" :height="'100%'" :dark="themeDark" :minimap="true" />
      </div>
      <template #footer>
        <span v-if="editor.conflict" class="fs-conflict-hint">远端已变化，可覆盖保存</span>
        <el-button @click="editor.open = false">关闭</el-button>
        <el-button type="primary" :loading="editor.saving" :disabled="editor.readonly" @click="saveEditor">保存到远端</el-button>
      </template>
    </el-dialog>

    <!-- 网格视图右键菜单（与行操作全集一致，Teleport 到 body 防被列表容器裁切）。
         注意：不能用裸 el-dropdown-menu——它 inject(DROPDOWN_INJECTION_KEY, undefined) 后解构即抛错，
         菜单项完全不渲染（用户 2026-11-18 截图「只出现小黑框」根因）。这里用原生 ul/li + 事件委托。 -->
    <Teleport to="body">
      <div v-if="ctxMenu" class="fs-ctx" :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }" @click="ctxClick">
        <ul class="fs-ctx-menu">
          <li data-command="open"><el-icon><FolderOpened /></el-icon>打开</li>
          <li v-if="ctxMenu.entry.kind === 'file'" data-command="download"><el-icon><Download /></el-icon>下载</li>
          <li v-if="ctxMenu.entry.kind === 'file' && activeChannel?.type !== 'local'" data-command="link"><el-icon><Link /></el-icon>链接</li>
          <li v-if="canShareEntry()" data-command="share"><el-icon><Link /></el-icon>分享链接</li>
          <li v-if="ctxMenu.entry.kind === 'dir' && clipboard && hasWritable" data-command="paste"><el-icon><DocumentCopy /></el-icon>粘贴</li>
          <li v-if="hasWritable" data-command="copy" class="is-divided"><el-icon><CopyDocument /></el-icon>复制</li>
          <li v-if="hasWritable" data-command="move"><el-icon><Rank /></el-icon>移动</li>
          <li v-if="hasWritable" data-command="rename"><el-icon><EditPen /></el-icon>重命名</li>
          <li v-if="hasWritable" data-command="delete"><el-icon><Delete /></el-icon>删除</li>
          <!-- 信息组 -->
          <li data-command="props" class="is-divided"><el-icon><InfoFilled /></el-icon>属性</li>
          <li v-if="ctxMenu.entry.kind === 'dir'" data-command="usage"><el-icon><TrendCharts /></el-icon>统计</li>
          <li data-command="note"><el-icon><ChatDotRound /></el-icon>设置备注…</li>
          <li data-command="favorite"><el-icon><CollectionTag /></el-icon>{{ isFavorited(ctxMenu.entry.path) ? '取消收藏' : '添加收藏' }}</li>
          <li data-command="copypath"><el-icon><CopyDocument /></el-icon>复制路径</li>
          <!-- 工具组（按通道与文件类型实时显隐） -->
          <template v-if="activeChannel?.type === 'local'">
            <li data-command="zip" class="is-divided"><el-icon><Box /></el-icon>压缩为 zip…</li>
            <li v-if="isFsZipName(ctxMenu.entry.name)" data-command="unzip"><el-icon><FolderOpened /></el-icon>解压到…</li>
          </template>
          <li v-if="ctxMenu.entry.kind === 'file' && isFsTextName(ctxMenu.entry.name)" data-command="convert" class="is-divided"><el-icon><MagicStick /></el-icon>转换编码 / 换行符…</li>
          <!-- 权限组 -->
          <li v-if="hasMode" data-command="perm" class="is-divided" :class="{ 'is-disabled': !ctxMenu.entry.mode }"><el-icon><Lock /></el-icon>编辑权限…</li>
        </ul>
      </div>
    </Teleport>

    <!-- 音视频播放（二期）：src 为主进程临时文件的 file:// URL（流式落盘，不用 data URI） -->
    <el-dialog v-model="player.open" :title="player.name" width="760px" top="6vh" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-player-dialog" @close="player.src = ''">
      <div class="fs-player-body">
        <span v-if="player.loading && !player.src" class="hint">加载中…</span>
        <video v-else-if="player.video && player.src" :src="player.src" controls autoplay style="max-width: 100%; max-height: 58vh" @error="onMediaError" />
        <audio v-else-if="player.src" :src="player.src" controls autoplay style="width: 100%" @error="onMediaError" />
      </div>
      <!-- 描述与按钮分两行（用户 2026-11-19） -->
      <template #footer>
        <div class="hint">在线播放上限 {{ mediaLimitText }}（可在「更多▾ → 上限设置」调整，0=不限）；更大文件请下载后本地播放</div>
        <div style="margin-top: 10px; text-align: right">
          <el-button @click="player.open = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 上传重名确认：三选一（取消/保留重命名/全部覆盖）；文件名限高滚动，单次多选也不撑爆弹框 -->
    <el-dialog
      v-model="dupDialogOpen"
      title="上传重名确认"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @closed="resolveDupAction('skip')"
    >
      <div class="hint" style="margin-bottom: 8px">检测到 {{ dupList.length }} 个重名（含后缀）文件，请选择处理方式：</div>
      <ul class="fs-dup-list">
        <li v-for="n in dupList" :key="n" :title="n">{{ n }}</li>
      </ul>
      <div class="hint" style="margin-top: 10px; line-height: 1.9">
        · <b>保留</b>：重命名为 <code>原名_时间戳.后缀</code>（同批同一时间戳）<br />
        · <b>全部覆盖</b>：直接覆盖同名文件<br />
        · <b>取消</b>：忽略重名文件，其余照传
      </div>
      <template #footer>
        <el-button @click="resolveDupAction('skip')">取消</el-button>
        <el-button type="primary" @click="resolveDupAction('rename')">保留（自动重命名）</el-button>
        <el-button type="danger" @click="resolveDupAction('overwrite')">全部覆盖</el-button>
      </template>
    </el-dialog>

    <!-- plans/10：传输队列悬浮面板（替代旧抽屉；无遮罩、可拖拽、收起态仍显摘要） -->
    <TransferPanel ref="transferPanelRef" v-model:expanded="panelExpanded" :tasks="taskList" />

    <!-- plans/10 传输设置：分片开关/阈值/片大小/并发（实时生效、跨重启记忆）+ 遗留分片清理 -->
    <el-dialog v-model="transferCfgOpen" title="传输设置" width="460px" :close-on-click-modal="false" :close-on-press-escape="false">
      <!-- label-width="auto"：EP 自动取所有 label 最宽者统一右对齐、输入框同列（用户 2026-11-19 纠正：用 form 的 auto，不用写死 px） -->
      <el-form label-width="auto" size="small">
        <!-- 开关类控件一行布局（用户铁律：文字与开关同排，长说明放 detail 悬浮） -->
        <el-form-item label="大文件分片传输">
          <el-tooltip content="上传/下载超过阈值的大文件走分片 + 断点续传；上传分片仅 OSS / S3，下载分片覆盖本地 / SFTP / OSS / S3" placement="top"><el-icon class="fs-cfg-help"><InfoFilled /></el-icon></el-tooltip>
          <el-switch v-model="transferCfgForm.enabled" data-autofocus />
        </el-form-item>
        <el-form-item label="分片阈值" required>
          <el-input-number v-model="transferCfgForm.thresholdMb" :min="1" :max="1024" :step="5" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB（超过该大小走分片）</span>
        </el-form-item>
        <el-form-item label="单片大小" required>
          <el-input-number v-model="transferCfgForm.partSizeMb" :min="5" :max="100" :step="5" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB（5~100）</span>
        </el-form-item>
        <el-form-item label="分片并发" required>
          <el-input-number v-model="transferCfgForm.partsConcurrency" :min="1" :max="8" :step="1" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">个/任务（1~8）</span>
        </el-form-item>
        <el-form-item v-if="transferCfgOrphans > 0" label="遗留分片">
          <span class="fs-ziplimits-unit">服务端残留 {{ transferCfgOrphans }} 个</span>
          <el-button size="small" type="danger" plain @click="cleanOrphansInCfg">清理…</el-button>
        </el-form-item>
      </el-form>
      <div class="hint" style="margin-top: 8px">暂停为协作式：当前分片/块写完即停（最多一个分片延迟），服务端不留碎片、可无损续传；源文件变更后续传会自动废弃旧检查点重传。</div>
      <template #footer>
        <el-button @click="transferCfgOpen = false">取消</el-button>
        <el-button type="primary" :loading="transferCfgSaving" @click="submitTransferConfig">保存</el-button>
      </template>
    </el-dialog>

    <!-- ShareHub 安全分享（plans/09 S15）：本地通道文件的 TTL/可撤销分享 -->
    <ShareDialog
      v-model:open="shareDialog.open"
      tool-id="upload-manager"
      :label="shareDialog.label"
      :default-root="shareDialog.root"
      :default-entry="shareDialog.entry"
    />

    <!-- §十一：设置备注（确认后生效；多选批量同备注） -->
    <el-dialog v-model="noteOpen" :title="`设置备注${noteTargets.length > 1 ? `（${noteTargets.length} 项）` : ''}`" width="440px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input clearable v-model="noteInput" data-autofocus maxlength="200" placeholder="备注（留空清除；最多 200 字）" @keyup.enter="submitNote" />
      <div class="hint" style="margin-top: 8px">备注保存在本机应用数据，跨通道可用；重命名/移动后自动跟随。</div>
      <template #footer>
        <el-button @click="noteOpen = false">取消</el-button>
        <el-button type="primary" :loading="noteSaving" @click="submitNote">保存备注</el-button>
      </template>
    </el-dialog>

    <!-- §十一：编辑权限（本地 / SFTP；rwx 勾选 ↔ 八进制双向联动，确认后生效） -->
    <el-dialog v-model="permOpen" title="编辑权限" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="permTarget">
        <div class="hint" style="margin-bottom: 10px">{{ permTarget.name }} · 当前 {{ permTarget.mode }}（{{ fsModeToRwx(permTarget.mode) }}）</div>
        <div class="fs-perm-grid">
          <span />
          <span class="fs-perm-head">读</span><span class="fs-perm-head">写</span><span class="fs-perm-head">执行</span>
          <span class="fs-perm-label">属主</span>
          <template v-for="(bit, i) in permBits().owner" :key="`o${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('owner', i as 0 | 1 | 2)" />
          </template>
          <span class="fs-perm-label">属组</span>
          <template v-for="(bit, i) in permBits().group" :key="`g${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('group', i as 0 | 1 | 2)" />
          </template>
          <span class="fs-perm-label">其他</span>
          <template v-for="(bit, i) in permBits().other" :key="`t${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('other', i as 0 | 1 | 2)" />
          </template>
        </div>
        <div class="fs-perm-octal">
          八进制：<el-input v-model="permOctal" data-autofocus class="fs-perm-octal-input" size="small" placeholder="0644" @keyup.enter="submitPerm" />
          <span class="hint">= {{ fsModeToRwx(permOctal) }}</span>
        </div>
        <div class="hint" style="margin-top: 8px">Windows 本地目录实际只有只读位生效；POSIX（SFTP/Linux）全量生效。点「修改」后二次确认才写入。</div>
      </template>
      <template #footer>
        <el-button @click="permOpen = false">取消</el-button>
        <el-button type="primary" :loading="permSaving" @click="submitPerm">修改</el-button>
      </template>
    </el-dialog>

    <!-- §十一：属性（只读展示 + 编辑入口） -->
    <el-dialog v-model="propsOpen" title="属性" width="520px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="propsEntry">
        <div class="fs-props">
          <div class="fs-props-row"><span class="fs-props-k">名称</span><span class="fs-props-v">{{ propsEntry.name }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">路径</span><span class="fs-props-v">{{ propsEntry.path || '(根)' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">类型</span><span class="fs-props-v">{{ propsEntry.kind === 'dir' ? '目录' : '文件' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">大小</span><span class="fs-props-v">{{ propsEntry.kind === 'dir' ? sizeCell(propsEntry) : fsFormatSize(propsEntry.size) }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">修改时间</span><span class="fs-props-v">{{ fmtTime(propsStat?.modified ?? propsEntry.modified) }}</span></div>
          <div v-if="hasCreated" class="fs-props-row"><span class="fs-props-k">创建时间</span><span class="fs-props-v">{{ fmtTime(propsEntry.createdAt) }}</span></div>
          <div v-if="hasMode" class="fs-props-row"><span class="fs-props-k">权限</span><span class="fs-props-v">{{ propsEntry.mode ? `${propsEntry.mode}（${fsModeToRwx(propsEntry.mode)}）` : '—' }}</span></div>
          <div v-if="hasOwner" class="fs-props-row"><span class="fs-props-k">用户/组</span><span class="fs-props-v">{{ propsEntry.owner ? `${propsEntry.owner}:${propsEntry.group ?? '—'}` : '—' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">备注</span><span class="fs-props-v">{{ annotations.get(propsEntry.path) || '—' }}</span></div>
        </div>
      </template>
      <template #footer>
        <el-button v-if="propsEntry && colShown.note" size="small" type="warning" plain @click="openNote([propsEntry!])">编辑备注</el-button>
        <el-button v-if="propsEntry && hasMode && propsEntry.mode" size="small" type="primary" plain @click="selection = new Set([propsEntry!.path]); permTarget = propsEntry; permOctal = propsEntry.mode ?? '0644'; propsOpen = false; permOpen = true">编辑权限</el-button>
        <el-button size="small" @click="propsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- §十一：转换文本编码 / 换行符（转换格式 A，全通道，确认后生效） -->
    <el-dialog v-model="convertOpen" title="转换文本编码 / 换行符" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="convertTarget">
        <div class="hint" style="margin-bottom: 10px">{{ convertTarget.name }} · {{ fsFormatSize(convertTarget.size) }}</div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">当前编码</span>
          <el-select v-model="convertForm.from" size="small" style="flex: 1">
            <el-option label="自动检测" value="auto" />
            <el-option label="UTF-8" value="utf-8" />
            <el-option label="GBK / GB2312" value="gbk" />
            <el-option label="Big5" value="big5" />
          </el-select>
        </div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">转换为</span>
          <el-select v-model="convertForm.to" size="small" style="flex: 1">
            <el-option label="UTF-8（推荐）" value="utf-8" />
            <el-option label="GBK / GB2312" value="gbk" />
          </el-select>
        </div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">换行符</span>
          <el-select v-model="convertForm.newline" size="small" style="flex: 1">
            <el-option label="保持不变" value="keep" />
            <el-option label="LF（Unix \\n）" value="lf" />
            <el-option label="CRLF（Windows \\r\\n）" value="crlf" />
          </el-select>
        </div>
        <div class="hint" style="margin-top: 8px">直接写回原文件（转换前建议下载备份）；「自动检测」按 BOM → UTF-8 严格校验 → GBK 的顺序判定。</div>
      </template>
      <template #footer>
        <el-button @click="convertOpen = false">取消</el-button>
        <el-button type="primary" :loading="convertSaving" @click="submitConvert">转换</el-button>
      </template>
    </el-dialog>

    <!-- §十一：列设置（显隐记忆 localStorage；通道不具备数据的列禁用） -->
    <el-dialog v-model="colsOpen" title="列设置" width="400px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div class="fs-cols">
        <el-checkbox v-model="colsVisible.note">备注（全通道可用）</el-checkbox>
        <el-checkbox v-model="colsVisible.createdAt" :disabled="!hasCreated" title="仅本地目录通道提供创建时间">创建时间{{ hasCreated ? '' : '（当前通道无数据）' }}</el-checkbox>
        <el-checkbox v-model="colsVisible.mode" :disabled="!hasMode" title="仅本地与 SFTP 通道提供权限">权限{{ hasMode ? '' : '（当前通道无数据）' }}</el-checkbox>
        <el-checkbox v-model="colsVisible.owner" :disabled="!hasOwner" title="仅本地与 SFTP 通道提供用户/组">用户 / 用户组{{ hasOwner ? '' : '（当前通道无数据）' }}</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="colsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- §十一：压缩/解压上限设置（app.fs.zipFileCap / zipBytesCap） -->
    <el-dialog v-model="zipLimitsOpen" title="压缩上限设置" width="400px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto" size="small">
        <el-form-item label="文件数上限">
          <el-input-number v-model="zipLimitsForm.fileCap" :min="10" :max="100000" :step="100" :controls="false" style="width: 150px" data-autofocus />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="容量上限">
          <el-input-number v-model="zipLimitsForm.bytesCapMb" :min="1" :max="4096" :step="50" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB</span>
        </el-form-item>
      </el-form>
      <div class="hint" style="margin-top: 8px">单次压缩 / 解压共用；超出即中止，防大目录占满内存。</div>
      <template #footer>
        <el-button @click="zipLimitsOpen = false">取消</el-button>
        <el-button type="primary" :loading="zipLimitsSaving" @click="submitZipLimits">保存</el-button>
      </template>
    </el-dialog>

    <!-- 上限设置（上传 / 下载分开、搜索扫描页数；0=不限） -->
    <el-dialog v-model="transferCapsOpen" title="上限设置" width="440px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto" size="small">
        <el-form-item label="上传文件数上限">
          <el-input-number v-model="transferCapsForm.uploadCap" :min="0" :max="100000" :step="1000" :controls="false" style="width: 150px" data-autofocus />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="下载文件数上限">
          <el-input-number v-model="transferCapsForm.downloadCap" :min="0" :max="100000" :step="1000" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="搜索扫描页数上限">
          <el-input-number v-model="transferCapsForm.searchMaxPages" :min="0" :max="100000" :step="100" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">页</span>
        </el-form-item>
        <el-form-item label="在线预览大小上限">
          <el-input-number v-model="transferCapsForm.mediaLimitMb" :min="0" :max="4096" :step="50" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB</span>
        </el-form-item>
      </el-form>
      <div class="hint" style="margin-top: 8px">上传目录展平 / 下载目录递归展开分别限制（默认：上传 10000、下载 0 不限制）；设为 0 表示不限制。云搜索扫描页数默认 500，0 = 不限。在线预览（音视频播放）超过上限提示下载后查看，默认 100MB，0 = 不限。</div>
      <template #footer>
        <el-button @click="transferCapsOpen = false">取消</el-button>
        <el-button type="primary" :loading="transferCapsSaving" @click="submitTransferCaps">保存</el-button>
      </template>
    </el-dialog>

    <!-- §十一：收藏夹（跨通道直达） -->
    <el-drawer v-model="favDrawerOpen" title="收藏夹" size="380px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div v-if="!favorites.length" class="fs-empty"><p>还没有收藏</p><p class="fs-empty-hint">选中文件/目录后在「更多 ▾」里添加收藏</p></div>
      <div v-else class="fs-fav-list">
        <div v-for="f in favorites" :key="f._id" class="fs-fav-item">
          <el-icon class="fs-icon" :class="{ 'is-dir': f.kind === 'dir' }"><component :is="f.kind === 'dir' ? Folder : Document" /></el-icon>
          <span class="fs-fav-name" :title="`${f.profileName ?? f.profileId}/${f.path}`">{{ f.name }}</span>
          <span class="fs-fav-meta">{{ f.profileName ?? f.profileId }} · {{ f.path }}</span>
          <span class="fs-spacer" />
          <el-button size="small" text type="primary" @click="gotoFavorite(f)">前往</el-button>
          <el-button size="small" text type="danger" @click="removeFavoriteById(f)">删除</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.fs-page { display: flex; flex-direction: column; height: 100%; min-height: 0; outline: none; gap: 8px; padding: 10px 20px 14px; }
.fs-spacer { flex: 1; }
.hint { font-size: 12px; opacity: .6; line-height: 1.5; }

.fs-channel-bar { display: flex; align-items: center; gap: 10px; }
.fs-channel-select { width: 260px; }
.fs-channel-opt { display: flex; align-items: center; gap: 8px; }
.fs-opt-name { font-weight: 600; }
.fs-opt-detail { font-size: 12px; opacity: .6; }
.fs-channel-meta { font-size: 12px; opacity: .75; }
.fs-warn { color: var(--el-color-warning); }
.fs-ok { color: var(--el-color-success); }

.fs-path-bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fs-crumbs { display: flex; align-items: center; min-width: 0; overflow: hidden; flex: 1; white-space: nowrap; }
.fs-crumb { cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 13px; }
.fs-crumb:hover { background: var(--el-fill-color); }
.fs-crumb-root { font-weight: 600; }
.fs-crumb-sep { opacity: .4; margin: 0 2px; }
.fs-path-input { flex: 1; max-width: 560px; }
.fs-filter { width: 200px; margin-left: auto; }
.fs-view-toggle { margin-left: 4px; }

.fs-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* 不能给滚动容器垂直 padding：内容裁切在 padding box，顶缝会露出滚动的行（sticky 表头盖不到） */
.fs-list { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; position: relative; }
.fs-list.is-drag { outline: 2px dashed var(--el-color-primary); outline-offset: -4px; }

/* 列表表格：单一 grid 容器定义列轨道，表头与数据行用 subgrid 共享同一组轨道——
   修复操作列 max-content 被表头/数据行两个独立 grid 各自计算导致的列错位（用户 2026-11-18） */
.fs-table { display: grid; }
.fs-thead, .fs-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; padding: 0 10px; }
.fs-more { grid-column: 1 / -1; }
/* 表头不透明底色（用户反馈 2026-11-17：此前 opacity:.75 连背景一起半透明，滚动后与内容重叠）；muted 观感用文字色实现 */
.fs-thead { position: sticky; top: 0; background: var(--el-bg-color); z-index: 2; font-size: 12px; color: var(--el-text-color-secondary); height: 30px; border-bottom: 1px solid var(--el-border-color-lighter); }
.fs-row { height: 34px; cursor: default; border-bottom: 1px solid var(--el-border-color-extra-light); }
.fs-row:hover { background: var(--el-fill-color-light); background-clip: padding-box; }
.fs-row.selected { background: var(--el-color-primary-light-9); background-clip: padding-box; }
/* 首尾两列横向固定（用户 2026-11-18）：复选框贴左、操作贴右，水平滚动时保持可见可操作。
   用户明确要求固定列不要额外背景色——仅 sticky 定位，不加 background（2026-11-18 二次纠正） */
.fs-col-check, .fs-col-op { position: sticky; }
.fs-col-check { left: 0; z-index: 1; }
.fs-col-op { right: 0; z-index: 1; }
/* 表头本身 sticky（z2），其固定列更高一层（z3）盖过数据行固定列 */
.fs-thead .fs-col-check, .fs-thead .fs-col-op { z-index: 3; }
.fs-sortable { cursor: pointer; user-select: none; }
.fs-col-check { display: flex; align-items: center; }
.fs-col-name { display: flex; align-items: center; gap: 8px; min-width: 0; position: relative; padding-right: 24px; }
/* 分享状态标记：绿=自己的分享、橙=随父级树链接（用户 2026-11-19） */
.fs-share-mark { flex: none; font-size: 14px; cursor: pointer; transition: transform .12s; }
.fs-share-mark:hover { transform: scale(1.2); }
.fs-share-mark.is-own { color: var(--el-color-success); }
.fs-share-mark.is-inherited { color: var(--el-color-warning); }
.fs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-name.is-dir { color: var(--el-color-primary); font-weight: 500; }
/* 搜索结果嵌套文件的子目录灰字提示（searchDirHint） */
.fs-name-sub { flex: none; font-size: 12px; opacity: .55; margin-left: 4px; }
.fs-icon.is-dir { color: var(--el-color-warning); }
.fs-col-size, .fs-col-time, .fs-col-mode { font-size: 12px; opacity: .7; }
/* 导航图标（后退/刷新）：small 按钮默认图标 12px 太细小，放大加主色 */
/* 上一级/刷新：图标+文字按钮（2026-11-17 用户反馈纯图标不明显） */
.fs-path-bar .fs-nav-btn { font-weight: 600; }
.fs-path-bar .fs-nav-btn .el-icon { font-size: 15px; }
/* 统计 loading：目录名旁旋转图标（成功色） */
.fs-usage-spin { color: var(--el-color-success); margin-left: 2px; font-size: 13px; }
/* 操作列：表头居中（用户 2026-11-17），行内按钮靠右且间距收紧 */
.fs-thead .fs-col-op { justify-content: center; }
.fs-col-op { display: flex; justify-content: flex-end; gap: 0; }
.fs-col-op .el-button + .el-button { margin-left: 2px; }
/* 操作列按钮紧凑化：EP small text 默认 padding 5px 11px，8 个按钮撑爆固定列宽——压缩到 0 4px */
.fs-col-op .el-button.is-text { padding: 0 4px; height: 22px; min-height: 0; white-space: nowrap; }
/* §十一 扩展列：备注左对齐可截断（hover 看 title）；owner 组为数字对（uid:gid） */
.fs-col-note, .fs-col-owner { font-size: 12px; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fs-more { text-align: center; padding: 8px 0; }
/* 搜索横幅不再 sticky（用户 2026-11-18：与 sticky 表头 top:0 叠住导致表格被遮）；随内容正常滚动即可 */
.fs-search-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; margin: 4px 8px; border-radius: 8px; background: var(--el-color-primary-light-9); font-size: 13px; }
.fs-search-info { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.fs-search-spin { color: var(--el-color-primary); animation: fs-search-rotate 1s linear infinite; }
@keyframes fs-search-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.fs-player-body { display: flex; align-items: center; justify-content: center; min-height: 260px; background: var(--el-fill-color-dark); border-radius: 8px; padding: 12px; }
.fs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 10px; }
.fs-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px; border-radius: 8px; cursor: default; border: 1px solid transparent; }
.fs-cell:hover { background: var(--el-fill-color-light); }
.fs-cell.selected { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-5); }
.fs-cell-icon { font-size: 40px; color: var(--el-text-color-secondary); }
.fs-cell-icon.is-dir { color: var(--el-color-warning); }
.fs-cell-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
/* 搜索结果的目录提示单独一行（用户 2026-11-18：卡片式名称与目录分行显示） */
.fs-cell-dir { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; opacity: .55; margin-top: -2px; }
.fs-cell-meta { font-size: 11px; opacity: .6; }

.fs-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; text-align: center; }
.fs-empty-hint { font-size: 12px; opacity: .55; }
.fs-error { color: var(--el-color-danger); }

.fs-status { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .8; }
.fs-drop-mask { position: fixed; inset: 0; background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); z-index: 40; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.fs-drop-box { background: var(--el-bg-color); border: 2px dashed var(--el-color-primary); border-radius: 12px; padding: 24px 40px; font-size: 15px; }

.fs-delete-list { font-size: 12px; opacity: .7; max-height: 120px; overflow: auto; word-break: break-all; }
.fs-preview-body { display: flex; align-items: center; justify-content: center; min-height: 320px; overflow: auto; background: var(--el-fill-color-dark); border-radius: 8px; }
.fs-preview-body img { max-width: 100%; max-height: 60vh; transition: transform .15s; }
/* PDF：Chromium 内置 viewer，iframe 撑满弹框可视区 */
.fs-preview-body .fs-preview-pdf { width: 100%; height: 60vh; border: none; border-radius: 8px; background: var(--el-bg-color); }
.fs-editor-body { height: 60vh; }
/* 收藏星标（用户 2026-11-18 定版）：固定在名称列末尾同一位置；未收藏 hover 才显，已收藏常显黄色实心星 */
.fs-fav-toggle { position: absolute; right: 0; top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity .12s; padding: 0 2px; margin: 0; height: 22px; color: var(--el-text-color-secondary); }
.fs-row:hover .fs-fav-toggle, .fs-fav-toggle.is-fav { opacity: 1; }
.fs-fav-toggle.is-fav { color: var(--el-color-warning); }
/* 编辑器标题行：文件名 · 大小（统计信息自 footer 移到顶部，用户 2026-11-18） */
.fs-editor-title { display: inline-flex; align-items: baseline; gap: 10px; font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.fs-editor-meta { font-size: 12px; font-weight: 400; opacity: .6; }
.fs-admin-tip { margin-bottom: 8px; }
/* 网格视图右键菜单（Teleport 到 body，fixed 定位；原生 ul/li 避免 el-dropdown 裸用注入崩溃） */
.fs-ctx { position: fixed; z-index: 3000; min-width: 156px; padding: 5px 0; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color-light); border-radius: 6px; box-shadow: var(--el-box-shadow-light); }
.fs-ctx-menu { list-style: none; margin: 0; padding: 0; }
.fs-ctx-menu li { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 14px; font-size: 13px; color: var(--el-text-color-regular); white-space: nowrap; cursor: pointer; }
.fs-ctx-menu li .el-icon { font-size: 14px; color: var(--el-text-color-secondary); }
.fs-ctx-menu li:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.fs-ctx-menu li:hover .el-icon { color: inherit; }
.fs-ctx-menu li.is-divided { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--el-border-color-lighter); }
.fs-ctx-menu li.is-disabled { color: var(--el-text-color-disabled); cursor: not-allowed; }
.fs-conflict-hint { color: var(--el-color-warning); font-size: 12px; margin-right: 12px; }
.fs-move-body { display: flex; flex-direction: column; }

/* plans/10：传输队列抽屉已删，悬浮面板样式在 TransferPanel.vue 内自管 */
/* 传输设置弹框：必填红星 + 行内说明（label auto+nowrap，铁律） */
.fs-req { color: var(--el-color-danger); font-style: normal; margin-right: 2px; }
.fs-cfg-help { font-size: 14px; margin-left: 4px; color: var(--el-text-color-secondary); cursor: help; }

/* ── §十一：编辑权限 / 属性 / 转换 / 列设置 / 收藏夹 ── */
.fs-perm-grid { display: grid; grid-template-columns: 64px repeat(3, 1fr); justify-items: center; gap: 6px 0; align-items: center; }
.fs-perm-head { font-size: 12px; opacity: .6; }
.fs-perm-label { font-size: 13px; justify-self: start; }
/* EP .el-checkbox 默认 margin-right: 30px——居中时连 margin 一起算，勾选框整体偏左（2026-11-19 截图错位根因） */
.fs-perm-check { height: 22px; margin-right: 0; }
.fs-perm-octal { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
.fs-perm-octal-input { width: 110px; }
.fs-props { display: flex; flex-direction: column; gap: 8px; }
.fs-props-row { display: flex; gap: 12px; font-size: 13px; line-height: 1.5; }
.fs-props-k { flex: none; width: 72px; opacity: .6; }
.fs-props-v { flex: 1; min-width: 0; word-break: break-all; }
.fs-convert-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
/* 数字上限类弹框改用 el-form label-width="auto"（用户 2026-11-19 纠正：EP form 的 auto 自动等宽右对齐，不写死 px） */
/* 表单 label 宽度 auto + 不换行（用户铁律 2026-11-18：label 不允许固定宽度截断换行） */
.fs-convert-label { flex: none; width: auto; white-space: nowrap; font-size: 13px; opacity: .7; }
/* 重名确认：文件名限高滚动（单次多选几十个也能看全，不撑爆弹框） */
.fs-dup-list { max-height: 180px; overflow-y: auto; margin: 0; padding: 6px 10px 6px 24px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; font-size: 13px; line-height: 1.9; }
.fs-dup-list li { word-break: break-all; }
.fs-cols { display: flex; flex-direction: column; gap: 4px; }
.fs-ziplimits-unit { flex: none; margin-left: 10px; font-size: 13px; opacity: .7; }
.fs-fav-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; height: 100%; }
.fs-fav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.fs-fav-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
.fs-fav-meta { font-size: 12px; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
