<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Back,
  CopyDocument,
  Delete,
  Document,
  Download,
  EditPen,
  Folder,
  FolderAdd,
  Grid,
  Menu as MenuIcon,
  Picture,
  Plus,
  Rank,
  Refresh,
  Search,
  Top,
  Upload,
  VideoCamera,
  DocumentCopy,
} from '@element-plus/icons-vue'
import {
  FS_IMAGE_PREVIEW_LIMIT,
  FS_MEDIA_PLAY_LIMIT,
  FS_TEXT_EDIT_LIMIT,
  fsFormatSize,
  fsMediaMime,
  isFsImageName,
  isFsMediaName,
  isFsTextName,
  isFsVideoName,
  type FsChannelInfo,
  type FsEntry,
  type FsListPage,
  type FsTransferTask,
} from '@sshk/shared'
import { CodeEditor } from '@sshk/code-editor'

/**
 * X6 文件系统页（plans/08 §3）：进入上传配置工具默认展示。
 * 布局三段：通道切换条 / 路径区（面包屑 + 可编辑路径）+ 工具栏 / 文件列表（列表·网格双视图）
 * + 状态条 + 右下角传输队列抽屉。
 * 通道 = 上传配置的 remote/cloud profile；密钥只在 main（safeStorage），渲染层零接触。
 */

// ── 通道与目录状态 ──
const channels = ref<FsChannelInfo[]>([])
const outputRoot = ref('')
const profileId = ref('')
const path = ref('')
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
const renameOpen = ref(false)
const renameTarget = ref<FsEntry | null>(null)
const renameName = ref('')
const moveOpen = ref(false)
const moveMode = ref<'copy' | 'move'>('copy')
const moveDirInput = ref('')
/** 复制目标通道（跨通道互拷二期；move 模式不支持跨通道） */
const moveDestProfile = ref('')
const deleteOpen = ref(false)
const deleteTargets = ref<FsEntry[]>([])
const deleteInput = ref('')

// ── 预览 / 编辑 / 播放 ──
const preview = ref({ open: false, name: '', src: '', scale: 1 })
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

// ── 容量统计（二期）──
const usageLoading = ref(false)

// ── 传输队列 ──
const drawerOpen = ref(false)
const tasks = ref(new Map<string, FsTransferTask>())
const taskList = computed(() => [...tasks.value.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)))
const runningCount = computed(() => taskList.value.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'conflict').length)

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
const selectedDirs = computed(() => selectedEntries.value.filter((e) => e.kind === 'dir').length)
const selectedFiles = computed(() => selectedEntries.value.length - selectedDirs.value)
const crumbs = computed(() => path.value ? path.value.split('/') : [])
const hasWritable = computed(() => activeChannel.value?.writable === true)

function fmtTime(ts: number | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtSpeed(v: number | undefined): string {
  if (!v || v <= 0) return ''
  return `${fsFormatSize(v)}/s`
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
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg)) return '连接失败：无法连通主机（检查地址/端口/网络）'
  if (/530|532|认证|Authentication|password|All authentication/i.test(msg)) return '认证失败：检查用户名与密码/密钥'
  if (/NoSuchBucket|The specified bucket|not exist/i.test(msg)) return '路径不存在：检查 Bucket 与目录'
  if (/密钥|Secret/i.test(msg)) return '密钥未配置：请到「上传配置」填写并保存'
  return msg
}

watch(profileId, () => {
  localStorage.setItem('sshk.fs.profileId', profileId.value)
  path.value = ''
  if (profileId.value) void list()
})
watch(viewMode, (v) => localStorage.setItem('sshk.fs.view', v))

// ── 导航 ──
function enterDir(entry: FsEntry): void {
  if (entry.kind !== 'dir') return
  path.value = entry.path
  void list()
}
function goUp(): void {
  if (!path.value) return
  const i = path.value.lastIndexOf('/')
  path.value = i < 0 ? '' : path.value.slice(0, i)
  void list()
}
function gotoCrumb(index: number): void {
  path.value = index < 0 ? '' : crumbs.value.slice(0, index + 1).join('/')
  void list()
}
function submitPathInput(): void {
  pathEditing.value = false
  const target = pathInput.value.trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/')
  if (target.split('/').some((p) => !p || p === '.' || p === '..')) {
    ElMessage.warning('路径不允许包含 . / .. 或空段')
    pathInput.value = path.value
    return
  }
  path.value = target
  void list()
}
function refresh(): void {
  void list()
}

// ── 递归搜索（二期）：回车触发，扫当前路径前缀（根 = 整个通道）──
async function runSearch(): Promise<void> {
  const kw = filter.value.trim()
  if (!kw) { searchActive.value = false; searchEntries.value = []; return }
  if (!profileId.value) return
  searchLoading.value = true
  try {
    const r = await window.api.fs.search({ profileId: profileId.value, path: path.value, keyword: kw })
    searchEntries.value = r.entries
    searchTruncated.value = r.truncated
    searchActive.value = true
    selection.value = new Set()
    if (!r.entries.length) ElMessage.info('递归搜索没有结果')
  } catch (err) {
    ElMessage.error('递归搜索失败：' + friendlyError(err))
  } finally {
    searchLoading.value = false
  }
}
function exitSearch(): void {
  searchActive.value = false
  searchEntries.value = []
  searchTruncated.value = false
  filter.value = ''
}

// ── 目录容量统计（二期）──
async function showUsage(entry: FsEntry): Promise<void> {
  if (!profileId.value || usageLoading.value) return
  usageLoading.value = true
  try {
    const r = await window.api.fs.usage({ profileId: profileId.value, path: entry.path })
    ElMessageBox.alert(
      `${entry.name || '根目录'}：${fsFormatSize(r.size)} · ${r.files} 个文件${r.truncated ? '（扫描达到上限，以上为已扫部分）' : ''}`,
      '目录容量统计',
      { confirmButtonText: '知道了' },
    )
  } catch (err) {
    ElMessage.error(friendlyError(err))
  } finally {
    usageLoading.value = false
  }
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

/** 音视频在线播放（二期）：超阈值引导下载后本地播放 */
function openPlayer(entry: FsEntry): void {
  if ((entry.size ?? 0) > FS_MEDIA_PLAY_LIMIT) {
    ElMessageBox.confirm(`文件 ${fsFormatSize(entry.size)} 超过在线播放上限（${fsFormatSize(FS_MEDIA_PLAY_LIMIT)}）。是否直接下载该文件？`, '文件过大', {
      type: 'warning', confirmButtonText: '下载', cancelButtonText: '取消',
      closeOnClickModal: false, closeOnPressEscape: false,
    }).then(() => { void downloadEntries([entry]) }).catch(() => { /* 取消 */ })
    return
  }
  player.value = { open: true, name: entry.name, src: '', video: isFsVideoName(entry.name), loading: true }
  void window.api.fs.read({ profileId: profileId.value, path: entry.path, maxBytes: FS_MEDIA_PLAY_LIMIT })
    .then((r) => {
      const mime = fsMediaMime(entry.name) || 'application/octet-stream'
      player.value.src = `data:${mime};base64,${r.contentBase64}`
    })
    .catch((err) => {
      player.value.open = false
      const msg = (err as Error).message ?? ''
      if (/过大|超过/.test(msg)) {
        ElMessageBox.confirm(`${msg}。是否直接下载该文件？`, '文件过大', {
          type: 'warning', confirmButtonText: '下载', cancelButtonText: '取消',
          closeOnClickModal: false, closeOnPressEscape: false,
        }).then(() => { void downloadEntries([entry]) }).catch(() => { /* 取消 */ })
      } else {
        ElMessage.warning(friendlyError(err))
      }
    })
    .finally(() => { player.value.loading = false })
}

async function openFile(entry: FsEntry): Promise<void> {
  if (!profileId.value) return
  if (isFsImageName(entry.name)) {
    try {
      const r = await window.api.fs.read({ profileId: profileId.value, path: entry.path, maxBytes: FS_IMAGE_PREVIEW_LIMIT })
      preview.value = { open: true, name: entry.name, src: dataUriOf(entry.name, r.contentBase64), scale: 1 }
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
      // 超阈值 → 引导下载编辑
      ElMessageBox.confirm(`${(err as Error).message}。是否直接下载该文件？`, '文件过大', {
        type: 'warning', confirmButtonText: '下载', cancelButtonText: '取消',
        closeOnClickModal: false, closeOnPressEscape: false,
      }).then(() => { void downloadEntries([entry]) }).catch(() => { /* 保持关闭 */ })
    }
    return
  }
  if (isFsMediaName(entry.name)) {
    openPlayer(entry)
    return
  }
  // 二进制 / 未知扩展：只有下载
  void downloadEntries([entry])
}

function dataUriOf(name: string, base64: string): string {
  const mime = isFsImageName(name)
    ? (/\.svg$/i.test(name) ? 'image/svg+xml' : `image/${(/\.jpe?g$/i.test(name) ? 'jpeg' : (/\.ico$/i.test(name) ? 'x-icon' : (/\.bmp$/i.test(name) ? 'bmp' : (/\.gif$/i.test(name) ? 'gif' : (/\.webp$/i.test(name) ? 'webp' : 'png')))))}`)
    : 'application/octet-stream'
  return `data:${mime};base64,${base64}`
}

// ── 上传（文件 / 文件夹 / EDM 产物） ──
async function uploadFiles(): Promise<void> {
  const paths = await window.api.fs.pickUpload({ type: 'file' })
  if (!paths.length || !profileId.value) return
  const files = await window.api.fs.flattenLocal(paths)
  await enqueueUploads(files)
}
async function uploadDirs(): Promise<void> {
  const paths = await window.api.fs.pickUpload({ type: 'dir' })
  if (!paths.length || !profileId.value) return
  const files = await window.api.fs.flattenLocal(paths)
  await enqueueUploads(files)
}
async function uploadFromOutput(): Promise<void> {
  if (!outputRoot.value) { ElMessage.info('未找到 EDM 产物目录'); return }
  const paths = await window.api.os.pickFile({ multi: true, defaultPath: outputRoot.value })
  if (!paths.length || !profileId.value) return
  const files = await window.api.fs.flattenLocal(paths)
  await enqueueUploads(files)
}

/** 本地展平结果 → 传输队列上传任务（relPath 保留目录结构） */
async function enqueueUploads(files: { name: string; localPath: string; relPath: string; size: number }[]): Promise<void> {
  if (!files.length || !profileId.value) return
  const inputs = files.map((f) => ({
    kind: 'upload' as const,
    profileId: profileId.value,
    name: f.name,
    remotePath: path.value ? `${path.value}/${f.relPath}` : f.relPath,
    localPath: f.localPath,
    size: f.size,
  }))
  const { taskIds } = await window.api.fs.transferStart(inputs)
  if (taskIds.length) {
    drawerOpen.value = true
    ElMessage.success(`已加入传输队列：${taskIds.length} 个文件`)
    // 上传完成后列表要能看到新文件：延迟刷新一次（完成后事件里也会刷）
    setTimeout(() => { if (runningCount.value === 0) void list(false) }, 2500)
  }
}

// ── 拖拽上传 ──
const dragOver = ref(false)
async function onDrop(event: DragEvent): Promise<void> {
  dragOver.value = false
  const files = [...(event.dataTransfer?.files ?? [])]
  const paths = files.map((f) => window.api.fs.pathForFile(f)).filter(Boolean)
  if (!paths.length || !profileId.value) return
  const flat = await window.api.fs.flattenLocal(paths)
  await enqueueUploads(flat)
}
function onDragOver(): void { dragOver.value = true }
function onDragLeave(): void { dragOver.value = false }

// ── 下载 ──
async function downloadEntries(list0: FsEntry[]): Promise<void> {
  const files = list0.filter((e) => e.kind === 'file')
  if (!files.length || !profileId.value) return
  const base = await window.api.fs.downloadDir(profileId.value)
  const inputs = files.map((f) => ({
    kind: 'download' as const,
    profileId: profileId.value,
    name: f.name,
    remotePath: f.path,
    destPath: `${base.replace(/[\\/]+$/, '')}/${f.name}`,
    size: f.size ?? 0,
  }))
  const { taskIds } = await window.api.fs.transferStart(inputs)
  if (taskIds.length) drawerOpen.value = true
}

// ── 新建 / 重命名 / 删除 ──
async function submitMkdir(): Promise<void> {
  const name = mkdirName.value.trim()
  if (!name || /[\\/]/.test(name)) { ElMessage.warning('目录名不能为空且不含斜杠'); return }
  try {
    await window.api.fs.mkdir({ profileId: profileId.value, path: path.value ? `${path.value}/${name}` : name })
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
}
async function submitRename(): Promise<void> {
  const target = renameTarget.value
  const name = renameName.value.trim()
  if (!target || !name || /[\\/]/.test(name) || name === target.name) { renameOpen.value = false; return }
  const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
  try {
    await window.api.fs.mv({ profileId: profileId.value, sources: [{ path: target.path, kind: target.kind }], destDir: parent })
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
      drawerOpen.value = true
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
function openMove(mode: 'copy' | 'move'): void {
  if (!selectedEntries.value.length) return
  moveMode.value = mode
  moveDirInput.value = path.value
  moveDestProfile.value = profileId.value
  moveOpen.value = true
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
/** SFTP 通道显示权限列（§3.2：仅 SFTP 有值） */
const hasMode = computed(() => activeChannel.value?.protocol === 'sftp')
async function submitMove(): Promise<void> {
  const dest = moveDirInput.value.trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/')
  if (dest.split('/').some((p) => !p)) { ElMessage.warning('目标目录不合法'); return }
  const sources = selectedEntries.value.map((e) => ({ path: e.path, kind: e.kind }))
  const cross = moveMode.value === 'copy' && moveDestProfile.value && moveDestProfile.value !== profileId.value
  moveOpen.value = false
  try {
    if (moveMode.value === 'move') {
      await window.api.fs.mv({ profileId: profileId.value, sources, destDir: dest })
      ElMessage.success('已移动')
    } else if (cross) {
      const r = await window.api.fs.crossCopy({ srcProfileId: profileId.value, destProfileId: moveDestProfile.value, sources, destDir: dest })
      drawerOpen.value = true
      ElMessage.info(`跨通道复制已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
    } else {
      const { taskIds } = await window.api.fs.cp({ profileId: profileId.value, sources, destDir: dest })
      if (taskIds.length) { drawerOpen.value = true; ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
      else ElMessage.success('已复制')
    }
    selection.value = new Set()
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}
async function paste(): Promise<void> {
  const clip = clipboard.value
  if (!clip || !profileId.value) return
  // 跨通道粘贴（二期）：复制语义走 crossCopy；剪切跨通道降级为复制（源保留，避免半删风险）
  if (clip.profileId !== profileId.value) {
    if (!hasWritable.value) { ElMessage.warning('当前通道不支持写操作，无法作为粘贴目标'); return }
    try {
      const r = await window.api.fs.crossCopy({ srcProfileId: clip.profileId, destProfileId: profileId.value, sources: clip.items, destDir: path.value })
      if (clip.op === 'cut') ElMessage.info('跨通道剪切按复制执行（源文件保留）')
      drawerOpen.value = true
      ElMessage.info(`跨通道复制已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
      void list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
    return
  }
  try {
    if (clip.op === 'cut') {
      await window.api.fs.mv({ profileId: profileId.value, sources: clip.items, destDir: path.value })
      clipboard.value = null
      ElMessage.success('已粘贴（移动）')
    } else {
      const { taskIds } = await window.api.fs.cp({ profileId: profileId.value, sources: clip.items, destDir: path.value })
      if (taskIds.length) { drawerOpen.value = true; ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
      else ElMessage.success('已粘贴（复制）')
    }
    void list(false)
  } catch (err) {
    ElMessage.error(friendlyError(err))
  }
}

// ── 新建文件 ──
async function newFile(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新建空白文本文件，输入文件名（如 page.html）', '新建文件', {
      confirmButtonText: '创建并编辑', cancelButtonText: '取消',
      inputPattern: /^[^\\/:]+$/, inputErrorMessage: '文件名不能含斜杠',
      closeOnClickModal: false, closeOnPressEscape: false,
    })
    const name = String(value ?? '').trim()
    if (!name) return
    const full = path.value ? `${path.value}/${name}` : name
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

/** 清理已完结传输任务（抽屉工具栏） */
async function clearFinishedTasks(): Promise<void> {
  const { removed } = await window.api.fs.transferClear()
  ElMessage.success(removed ? `已清理 ${removed} 个完结任务` : '没有可清理的任务')
}

// ── 传输队列抽屉 ──
function statusText(t: FsTransferTask): string {
  switch (t.status) {
    case 'queued': return '排队中'
    case 'running': return t.kind === 'delete' ? `删除中 ${t.transferred}/${t.size}` : '传输中'
    case 'success': return '完成'
    case 'failed': return '失败'
    case 'canceled': return '已取消'
    case 'conflict': return '待确认'
    default: return t.status
  }
}
function kindLabel(t: FsTransferTask): string {
  switch (t.kind) {
    case 'upload': return '上传'
    case 'download': return '下载'
    case 'copy': return '复制'
    case 'cross': return '跨通道'
    default: return '删除'
  }
}
function kindTagType(t: FsTransferTask): 'success' | 'primary' | 'warning' | 'danger' {
  switch (t.kind) {
    case 'upload': return 'success'
    case 'download': return 'primary'
    case 'copy': return 'warning'
    case 'cross': return 'warning'
    default: return 'danger'
  }
}
function percentOf(t: FsTransferTask): number {
  if (t.status === 'success') return 100
  if (t.size > 0) return Math.min(100, Math.round((t.transferred / t.size) * 100))
  return t.status === 'running' ? 5 : 0
}
async function cancelTask(id: string): Promise<void> {
  await window.api.fs.transferCancel([id])
}
async function retryTask(t: FsTransferTask, overwrite = false): Promise<void> {
  if (t.status === 'conflict' && !overwrite) {
    await window.api.fs.transferRetry([t.id], true)
    ElMessage.info('已按覆盖执行')
    return
  }
  await window.api.fs.transferRetry([t.id], overwrite)
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
    if (task.status === 'success' && (task.kind === 'upload' || task.kind === 'delete' || task.kind === 'copy')) scheduleRefresh()
  })
  void loadChannels().then(() => { if (profileId.value) void list() })
  // 队列已有历史任务（页面刷新恢复）
  void window.api.fs.transferList().then((list0) => {
    for (const t of list0) tasks.value.set(t.id, t)
    tasks.value = new Map(tasks.value)
  })
})
onBeforeUnmount(() => { if (refreshTimer !== undefined) window.clearTimeout(refreshTimer) })

// ── 键盘（§3.3） ──
function onKeydown(event: KeyboardEvent): void {
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
  <div class="fs-page" tabindex="0" @keydown="onKeydown" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
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
        <span v-if="!activeChannel.hasSecret" class="fs-warn">密钥未配置，去「上传配置」填写</span>
        <span v-else-if="!hasWritable" class="fs-warn">该厂商仅支持浏览（写操作支持阿里云 OSS / AWS S3）</span>
        <span v-else class="fs-ok">已连接 · {{ activeChannel.detail }}</span>
      </span>
      <span class="fs-spacer" />
      <el-button size="small" text :icon="MenuIcon" title="下载目录" @click="changeDownloadDir">下载目录</el-button>
      <el-button size="small" text :icon="DocumentCopy" title="打开本地下载目录" @click="openDownloadDir">打开目录</el-button>
    </div>

    <!-- 路径区 -->
    <div class="fs-path-bar">
      <el-button size="small" text :icon="Back" :disabled="!path" title="上一级 (Backspace)" @click="goUp" />
      <el-button size="small" text :icon="Refresh" title="刷新 (F5)" @click="refresh" />
      <div v-if="!pathEditing" class="fs-crumbs" @dblclick="pathEditing = true">
        <span class="fs-crumb fs-crumb-root" @click="gotoCrumb(-1)">{{ activeChannel?.name ?? '通道' }}</span>
        <template v-for="(seg, i) in crumbs" :key="i">
          <span class="fs-crumb-sep">/</span>
          <span class="fs-crumb" @click="gotoCrumb(i)">{{ seg }}</span>
        </template>
      </div>
      <el-input
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

    <!-- 工具栏 -->
    <div class="fs-toolbar">
      <el-dropdown @command="(c: unknown) => (String(c) === 'dir' ? uploadDirs() : String(c) === 'output' ? uploadFromOutput() : uploadFiles())">
        <el-button size="small" type="primary" :icon="Upload" :disabled="!profileId">
          上传<el-icon class="el-icon--right"><Top style="transform: rotate(180deg)" /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="file">上传文件</el-dropdown-item>
            <el-dropdown-item command="dir">上传文件夹（保留结构）</el-dropdown-item>
            <el-dropdown-item command="output">从 EDM 产物目录选择…</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" :icon="Download" :disabled="selectedFiles === 0" @click="downloadEntries(selectedEntries)">下载</el-button>
      <el-button size="small" :icon="FolderAdd" :disabled="!hasWritable || !profileId" @click="mkdirOpen = true">新建文件夹</el-button>
      <el-button size="small" :icon="Document" :disabled="!hasWritable || !profileId" @click="newFile">新建文件</el-button>
      <el-button size="small" :icon="CopyDocument" :disabled="!selectedEntries.length" @click="clipCopy('copy')">复制</el-button>
      <el-button size="small" :icon="Rank" :disabled="!selectedEntries.length" @click="openMove('copy')">复制到…</el-button>
      <el-button size="small" :icon="Rank" :disabled="!selectedEntries.length || !hasWritable" @click="openMove('move')">移动到…</el-button>
      <el-button size="small" :icon="EditPen" :disabled="selectedEntries.length !== 1 || !hasWritable" @click="openRename(selectedEntries[0]!)">重命名</el-button>
      <el-button size="small" :icon="Delete" :disabled="selectedEntries.length !== 1 || selectedEntries[0]!.kind !== 'dir'" :loading="usageLoading" title="统计选中目录的容量与文件数" @click="showUsage(selectedEntries[0]!)">统计</el-button>
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selectedEntries.length || !hasWritable" @click="openDelete(selectedEntries)">删除</el-button>
      <span class="fs-spacer" />
      <el-button size="small" :icon="Plus" title="粘贴 (Ctrl+V)；跨通道粘贴按复制执行" :disabled="!clipboard || clipboard.profileId === profileId && !hasWritable" @click="paste">
        粘贴{{ clipboard ? `（${clipboard.items.length} 项${clipboard.op === 'cut' ? ' · 剪切' : ''}${clipboard.profileId !== profileId ? ' · 跨通道' : ''}）` : '' }}
      </el-button>
    </div>

    <!-- 文件列表 -->
    <div class="fs-list" :class="{ 'is-drag': dragOver, 'has-mode': hasMode }">
      <!-- 递归搜索结果横幅（二期） -->
      <div v-if="searchActive" class="fs-search-banner">
        <span>
          递归搜索「{{ filter.trim() }}」：{{ searchEntries.length }} 个结果{{ searchTruncated ? '（已达扫描上限，结果可能不全）' : '' }}
        </span>
        <el-button size="small" text type="primary" @click="exitSearch">返回目录</el-button>
      </div>
      <div v-if="!profileId" class="fs-empty">
        <p>还没有配置上传通道</p>
        <p class="fs-empty-hint">到「上传配置」页添加远程（FTP/SFTP）或云（OSS 等）profile 后即可浏览管理远端文件。</p>
      </div>
      <div v-else-if="pageError" class="fs-empty fs-error">
        <p>加载失败：{{ pageError }}</p>
        <el-button size="small" type="primary" plain @click="refresh">重试</el-button>
      </div>
      <div v-else-if="loading || searchLoading" class="fs-empty"><p>{{ searchLoading ? '递归搜索中…' : '加载中…' }}</p></div>
      <div v-else-if="filteredEntries.length === 0" class="fs-empty">
        <p>{{ searchActive ? '递归搜索没有结果' : (filter ? '没有匹配的文件' : '此目录为空') }}</p>
        <p class="fs-empty-hint">{{ searchActive ? '换个关键词，或到上级目录再搜' : '把文件或文件夹拖进来即可上传到当前目录' }}</p>
      </div>

      <!-- 列表视图 -->
      <template v-else-if="viewMode === 'list'">
        <div class="fs-thead">
          <span class="fs-col-check">
            <el-checkbox :model-value="selection.size > 0 && selection.size === filteredEntries.length" :indeterminate="selection.size > 0 && selection.size < filteredEntries.length" @change="selectAll" />
          </span>
          <span class="fs-col-name fs-sortable" @click="sortKey = 'name'; sortDir = sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc'">名称{{ sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
          <span class="fs-col-size fs-sortable" @click="sortKey = 'size'; sortDir = sortKey === 'size' && sortDir === 'asc' ? 'desc' : 'asc'">大小{{ sortKey === 'size' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
          <span class="fs-col-time fs-sortable" @click="sortKey = 'time'; sortDir = sortKey === 'time' && sortDir === 'asc' ? 'desc' : 'asc'">修改时间{{ sortKey === 'time' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
          <span v-if="hasMode" class="fs-col-mode">权限</span>
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
          <span class="fs-col-check"><el-checkbox :model-value="selection.has(entry.path)" @click.prevent.stop @change="toggleCheck(entry)" /></span>
          <span class="fs-col-name">
            <el-icon class="fs-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
            <span class="fs-name" :class="{ 'is-dir': entry.kind === 'dir' }" :title="entry.path">{{ entry.name }}</span>
          </span>
          <span class="fs-col-size">{{ entry.kind === 'dir' ? '目录' : fsFormatSize(entry.size) }}</span>
          <span class="fs-col-time" :title="fmtTime(entry.modified)">{{ fmtTime(entry.modified) }}</span>
          <span v-if="hasMode" class="fs-col-mode">{{ entry.mode ?? '—' }}</span>
          <span class="fs-col-op">
            <el-button v-if="entry.kind === 'file'" size="small" text type="primary" @click.stop="rowOpen(entry)">打开</el-button>
            <el-button v-if="entry.kind === 'file'" size="small" text :icon="Download" title="下载" @click.stop="downloadEntries([entry])" />
            <el-button v-if="entry.kind === 'file' && hasWritable" size="small" text :icon="CopyDocument" title="复制到…" @click.stop="rowCopy(entry)" />
            <el-button v-if="entry.kind === 'file' && hasWritable" size="small" text :icon="Rank" title="移动到…" @click.stop="rowMove(entry)" />
            <el-button v-if="entry.kind === 'dir'" size="small" text title="目录容量统计" @click.stop="showUsage(entry)">统计</el-button>
            <el-button v-if="hasWritable" size="small" text :icon="EditPen" title="重命名" @click.stop="openRename(entry)" />
            <el-button size="small" text :icon="Delete" type="danger" title="删除" @click.stop="openDelete([entry])" />
          </span>
        </div>
        <div v-if="cursor" class="fs-more">
          <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多…</el-button>
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
          >
            <el-icon class="fs-cell-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
            <span class="fs-cell-name">{{ entry.name }}</span>
            <span class="fs-cell-meta">{{ entry.kind === 'dir' ? '目录' : fsFormatSize(entry.size) }}</span>
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
      <el-button size="small" text type="primary" :icon="MenuIcon" @click="drawerOpen = true">
        传输队列{{ runningCount ? `（${runningCount} 进行中）` : '' }}
      </el-button>
    </div>

    <!-- 拖拽遮罩提示 -->
    <div v-if="dragOver" class="fs-drop-mask">
      <div class="fs-drop-box">松开鼠标上传到当前目录</div>
    </div>

    <!-- 新建目录 -->
    <el-dialog v-model="mkdirOpen" title="新建文件夹" width="420px" close-on-click-modal="false" close-on-press-escape="false">
      <el-input v-model="mkdirName" placeholder="目录名（不含斜杠）" autofocus @keyup.enter="submitMkdir" />
      <template #footer>
        <el-button @click="mkdirOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMkdir">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog v-model="renameOpen" title="重命名" width="420px" close-on-click-modal="false" close-on-press-escape="false">
      <el-input v-model="renameName" autofocus @keyup.enter="submitRename" />
      <template #footer>
        <el-button @click="renameOpen = false">取消</el-button>
        <el-button type="primary" @click="submitRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 复制到 / 移动到 -->
    <el-dialog v-model="moveOpen" :title="moveMode === 'move' ? '移动到…' : '复制到…'" width="480px" close-on-click-modal="false" close-on-press-escape="false">
      <div class="fs-move-body">
        <template v-if="moveMode === 'copy'">
          <div class="hint" style="margin-bottom: 6px">目标通道（选择其它通道即跨通道复制，走传输队列）：</div>
          <el-select v-model="moveDestProfile" size="small" style="width: 100%; margin-bottom: 12px" filterable>
            <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="`${c.name}（${c.detail}）`" :disabled="!c.hasSecret" />
          </el-select>
        </template>
        <div class="hint" style="margin-bottom: 8px">目标目录（通道根相对路径，如 a/b；留空为根目录）：</div>
        <el-input v-model="moveDirInput" placeholder="a/b" @keyup.enter="submitMove" />
        <div class="fs-crumb" style="margin-top: 10px; display: inline-block" @click="moveDirInput = path">填当前目录：{{ path || '(根)' }}</div>
      </div>
      <template #footer>
        <el-button @click="moveOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMove">{{ moveMode === 'move' ? '移动' : '复制' }}</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认（纯文件，无目录时） -->
    <el-dialog v-model="deleteOpen" title="删除确认" width="460px" close-on-click-modal="false" close-on-press-escape="false">
      <p>确定删除以下 {{ deleteTargets.length }} 项吗？此操作不可恢复。</p>
      <p class="fs-delete-list">{{ deleteTargets.map((e) => e.name).join('、') }}</p>
      <template #footer>
        <el-button @click="deleteOpen = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">删除</el-button>
      </template>
    </el-dialog>

    <!-- 图片预览 -->
    <el-dialog v-model="preview.open" :title="preview.name" width="720px" close-on-click-modal="false" close-on-press-escape="false" class="fs-preview-dialog">
      <div class="fs-preview-body">
        <img :src="preview.src" :style="{ transform: `scale(${preview.scale})` }" alt="preview" />
      </div>
      <template #footer>
        <el-button size="small" @click="preview.scale = Math.max(0.2, preview.scale - 0.2)">缩小</el-button>
        <el-button size="small" @click="preview.scale = 1">复位</el-button>
        <el-button size="small" @click="preview.scale = Math.min(5, preview.scale + 0.2)">放大</el-button>
        <el-button size="small" @click="preview.open = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 文本编辑器 -->
    <el-dialog v-model="editor.open" :title="editor.name" width="900px" top="4vh" close-on-click-modal="false" close-on-press-escape="false" class="fs-editor-dialog">
      <div class="fs-editor-body">
        <CodeEditor v-model="editor.content" :path="editor.path" :readonly="editor.readonly" :height="'100%'" :dark="themeDark" :minimap="true" />
      </div>
      <template #footer>
        <span v-if="editor.conflict" class="fs-conflict-hint">远端已变化，可覆盖保存</span>
        <span class="hint">{{ editor.name }} · {{ fsFormatSize(editor.size) }}</span>
        <el-button @click="editor.open = false">关闭</el-button>
        <el-button type="primary" :loading="editor.saving" :disabled="editor.readonly" @click="saveEditor">保存到远端</el-button>
      </template>
    </el-dialog>

    <!-- 音视频播放（二期） -->
    <el-dialog v-model="player.open" :title="player.name" width="760px" top="6vh" close-on-click-modal="false" close-on-press-escape="false" class="fs-player-dialog" @close="player.src = ''">
      <div class="fs-player-body">
        <span v-if="player.loading && !player.src" class="hint">加载中…</span>
        <video v-else-if="player.video && player.src" :src="player.src" controls autoplay style="max-width: 100%; max-height: 58vh" />
        <audio v-else-if="player.src" :src="player.src" controls autoplay style="width: 100%" />
      </div>
      <template #footer>
        <span class="hint">在线播放上限 {{ fsFormatSize(FS_MEDIA_PLAY_LIMIT) }}；更大文件请下载后本地播放</span>
        <el-button @click="player.open = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 传输队列抽屉 -->
    <el-drawer v-model="drawerOpen" title="传输队列" direction="btt" size="45%" close-on-click-modal="false" close-on-press-escape="false">
      <div class="fs-drawer-toolbar">
        <el-button size="small" text @click="clearFinishedTasks">清理已完结</el-button>
        <span class="hint">同通道并发：远程 3 / 云 5；失败自动重试 1 次</span>
      </div>
      <div class="fs-task-list">
        <div v-if="!taskList.length" class="fs-empty"><p>暂无传输任务</p></div>
        <div v-for="t in taskList" :key="t.id" class="fs-task" :class="`is-${t.status}`">
          <div class="fs-task-head">
            <el-tag size="small" :type="kindTagType(t)">{{ kindLabel(t) }}</el-tag>
            <span class="fs-task-name" :title="t.remotePath ?? t.localPath">{{ t.name }}</span>
            <span class="fs-task-meta" :title="t.kind === 'cross' ? `${t.profileName} → ${t.destProfileName}` : t.profileName">
              {{ t.kind === 'cross' ? `${t.profileName} → ${t.destProfileName}` : t.profileName }}
            </span>
            <span class="fs-spacer" />
            <span v-if="t.status === 'running'" class="fs-task-speed">{{ fmtSpeed(t.speed) }}</span>
            <span class="fs-task-status">{{ statusText(t) }}</span>
            <el-button v-if="t.status === 'running' || t.status === 'queued'" size="small" text type="danger" @click="cancelTask(t.id)">取消</el-button>
            <el-button v-if="t.status === 'conflict'" size="small" text type="warning" @click="retryTask(t, true)">覆盖</el-button>
            <el-button v-if="t.status === 'failed' || t.status === 'canceled'" size="small" text type="primary" @click="retryTask(t)">重试</el-button>
          </div>
          <el-progress
            v-if="t.status !== 'failed' && t.status !== 'canceled'"
            :percentage="percentOf(t)"
            :status="t.status === 'success' ? 'success' : t.status === 'conflict' ? 'warning' : undefined"
            :stroke-width="6"
          />
          <div v-if="t.error" class="fs-task-error">{{ t.error }}</div>
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

.fs-thead, .fs-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 110px 170px 210px; align-items: center; padding: 0 10px; }
/* 表头不透明底色（用户反馈 2026-11-17：此前 opacity:.75 连背景一起半透明，滚动后与内容重叠）；muted 观感用文字色实现 */
.fs-thead { position: sticky; top: 0; background: var(--el-bg-color); z-index: 2; font-size: 12px; color: var(--el-text-color-secondary); height: 30px; border-bottom: 1px solid var(--el-border-color-lighter); }
.fs-row { height: 34px; cursor: default; border-bottom: 1px solid var(--el-border-color-extra-light); }
.fs-row:hover { background: var(--el-fill-color-light); background-clip: padding-box; }
.fs-row.selected { background: var(--el-color-primary-light-9); background-clip: padding-box; }
.fs-sortable { cursor: pointer; user-select: none; }
.fs-col-check { display: flex; align-items: center; }
.fs-col-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-name.is-dir { color: var(--el-color-primary); font-weight: 500; }
.fs-icon.is-dir { color: var(--el-color-warning); }
.fs-col-size, .fs-col-time, .fs-col-mode { font-size: 12px; opacity: .7; }
.fs-col-op { display: flex; justify-content: flex-end; gap: 2px; }
/* SFTP 权限列（§3.2：仅 SFTP 显示） */
.fs-list.has-mode .fs-thead, .fs-list.has-mode .fs-row { grid-template-columns: 34px minmax(0, 1fr) 100px 160px 66px 200px; }

.fs-more { text-align: center; padding: 8px 0; }
.fs-search-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; margin: 4px 8px; border-radius: 8px; background: var(--el-color-primary-light-9); font-size: 13px; position: sticky; top: 30px; z-index: 1; }
.fs-player-body { display: flex; align-items: center; justify-content: center; min-height: 260px; background: var(--el-fill-color-dark); border-radius: 8px; padding: 12px; }
.fs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 10px; }
.fs-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px; border-radius: 8px; cursor: default; border: 1px solid transparent; }
.fs-cell:hover { background: var(--el-fill-color-light); }
.fs-cell.selected { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-5); }
.fs-cell-icon { font-size: 40px; color: var(--el-text-color-secondary); }
.fs-cell-icon.is-dir { color: var(--el-color-warning); }
.fs-cell-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
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
.fs-editor-body { height: 60vh; }
.fs-conflict-hint { color: var(--el-color-warning); font-size: 12px; margin-right: 12px; }
.fs-move-body { display: flex; flex-direction: column; }

.fs-drawer-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.fs-task-list { overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.fs-task { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 8px 12px; }
.fs-task-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.fs-task-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.fs-task-meta { font-size: 12px; opacity: .6; }
.fs-task-speed { font-size: 12px; color: var(--el-color-primary); }
.fs-task-status { font-size: 12px; }
.fs-task.is-failed .fs-task-status { color: var(--el-color-danger); }
.fs-task.is-conflict .fs-task-status { color: var(--el-color-warning); }
.fs-task.is-success .fs-task-status { color: var(--el-color-success); }
.fs-task-error { font-size: 12px; color: var(--el-color-danger); margin-top: 4px; word-break: break-all; }
</style>
