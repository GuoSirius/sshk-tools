import { fsApi } from './fsHost'
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fsFormatSize,
  type FsChannelInfo,
  type FsEntry,
  type FsListPage,
} from '@sshk/shared'

/**
 * 文件系统核心状态（P4-4 自 FileExplorerPage 拆出）：通道加载 + 目录列表 + 分页 + 导航 + 目录容量统计。
 * 行为契约（与原页面逐字一致）：
 * - 内部路径规范：根 = '/'，子路径 = /a/b/c；pathInput 兼容 a/b 与 /a/b/，根输入 ''/'/' 归一 '/'。
 * - listSeq 丢弃过期响应（切目录/切通道竞态，2026-11-19 用户实测）；list(false) 追加式刷新。
 * - pendingNavPath/pendingNavSelect：收藏夹跨通道/文件定位的「下次进入目录」契约，由 useFsFavorites 写入、list() 消费。
 * - 跨域联动走注册回调（页面装配时接线，顺序=原页面执行顺序）：
 *   onListStart（每次 list() 发起：搜索会话作废 → 清空选中）、
 *   onDirReload（resetCursor 成功后：备注/分享状态跟随目录重载）、
 *   onLocate（收藏定位文件：选中 + 滚动到视口居中）。
 */

/** 统一错误文案（原页面散写上收；各 composable 共用） */
export function friendlyError(err: unknown): string {
  const msg = (err as Error).message ?? String(err)
  // 移动部分完成的主进程提示已含处置建议，原样展示，别被下面的通用权限文案覆盖
  if (/移动未完成/.test(msg)) return msg
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg)) return '连接失败：无法连通主机（检查地址/端口/网络）'
  if (/530|532|认证|Authentication|password|All authentication/i.test(msg)) return '认证失败：检查用户名与密码/密钥'
  if (/NoSuchBucket|The specified bucket|not exist/i.test(msg)) return '路径不存在：检查 Bucket 与目录'
  if (/no right to access|bucket acl|AccessDenied|403|permission|Forbidden|无权|权限/i.test(msg)) {
    return '权限不足：当前密钥无此操作权限，请到云控制台检查 Bucket ACL 与子账号授权'
  }
  if (/密钥|Secret/i.test(msg)) return '密钥未配置：请到「文件管理 · 通道配置」填写并保存'
  return msg
}

export function useFsListing() {
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

  // ── 派生 ──
  const activeChannel = computed(() => channels.value.find((c) => c.id === profileId.value) ?? null)
  const crumbs = computed(() => path.value === '/' ? [] : path.value.split('/').filter(Boolean))
  /** Windows 式路径折叠：层级 >3 时中间段收成「…」（title 显示被折叠的完整路径），始终保留末 2 段 */
  const CRUMB_TAIL = 2
  const crumbItems = computed(() => {
    const all = crumbs.value
    if (all.length <= CRUMB_TAIL + 1) return all.map((seg, i) => ({ seg, i }))
    return all.slice(-CRUMB_TAIL).map((seg, j) => ({ seg, i: all.length - CRUMB_TAIL + j }))
  })
  const collapsedCrumbPath = computed(() => {
    const all = crumbs.value
    if (all.length <= CRUMB_TAIL + 1) return ''
    return '/' + all.slice(0, all.length - CRUMB_TAIL).join('/')
  })
  const hasWritable = computed(() => activeChannel.value?.writable === true)

  function fmtTime(ts: number | undefined): string {
    if (!ts) return '—'
    const d = new Date(ts)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // ── 收藏定位契约（useFsFavorites 写入，list() 消费）──
  const pendingNavPath = ref<string | null>(null)
  const pendingNavSelect = ref<string | null>(null)

  // ── 跨域注册回调（页面装配接线；顺序 = 原页面行为顺序）──
  const listStartCbs: Array<() => void> = []
  const dirReloadCbs: Array<() => void> = []
  const locateCbs: Array<(target: string) => void> = []
  function onListStart(cb: () => void): void { listStartCbs.push(cb) }
  function onDirReload(cb: () => void): void { dirReloadCbs.push(cb) }
  function onLocate(cb: (target: string) => void): void { locateCbs.push(cb) }

  // ── 目录容量统计（二期）：结果直接写入列表「类型/大小」列 ──
  /** 统计中的目录路径集合（支持多个目录并行统计，行内显示 loading） */
  const usageLoadingPaths = ref(new Set<string>())
  /** 已统计的目录容量（path → 结果），直接显示在列表「类型/大小」列 */
  const usageResults = ref(new Map<string, { size: number; files: number; truncated: boolean }>())
  function isUsageLoading(p: string): boolean { return usageLoadingPaths.value.has(p) }
  async function showUsage(entry: FsEntry): Promise<void> {
    if (!profileId.value || usageLoadingPaths.value.has(entry.path)) return
    usageLoadingPaths.value = new Set(usageLoadingPaths.value).add(entry.path)
    try {
      const r = await fsApi.usage({ profileId: profileId.value, path: entry.path })
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

  // ── 数据加载 ──
  async function loadChannels(): Promise<void> {
    try {
      const payload = await fsApi.profiles()
      channels.value = payload.channels
      outputRoot.value = payload.outputRoot
      const saved = localStorage.getItem('sshk.fs.profileId') ?? ''
      const ok = payload.channels.find((c) => c.id === saved) ?? payload.channels[0]
      profileId.value = ok?.id ?? ''
    } catch (err) {
      pageError.value = (err as Error).message
    }
  }

  let listSeq = 0 // 列表请求序号：切目录/切通道后丢弃过期响应（2026-11-19 用户实测本地慢目录与切换竞态）
  let lastListPath = '' // 上次列取的目录：目录变更时列表回到顶部（定位文件场景除外）
  const listEl = ref<HTMLElement | null>(null)

  async function list(resetCursor = true): Promise<void> {
    if (!profileId.value) return
    const seq = ++listSeq
    if (resetCursor) { cursor.value = null; entries.value = [] }
    // 列表发起：搜索会话作废 + 清空选中（回调注册顺序 = 原行为顺序：搜索在前、选中在后）
    for (const cb of listStartCbs) cb()
    loading.value = true
    pageError.value = ''
    try {
      const page: FsListPage = await fsApi.list({ profileId: profileId.value, path: path.value })
      if (seq !== listSeq) return // 期间用户已切目录/切通道：过期响应直接丢弃
      entries.value = page.entries
      cursor.value = page.nextCursor ?? null
      pathInput.value = path.value
      // 清掉已不在列表里的统计缓存（目录被删后同路径新目录不显示旧统计）
      const valid = new Set(page.entries.map((e) => e.path))
      usageResults.value = new Map([...usageResults.value].filter(([p]) => valid.has(p)))
      if (resetCursor) for (const cb of dirReloadCbs) cb() // 备注/分享状态跟随目录重载
      // 目录切换：列表回到顶部（用户 2026-11-19：进目录不定位，仅收藏定位文件时滚动）
      if (lastListPath !== path.value) {
        lastListPath = path.value
        listEl.value?.scrollTo({ top: 0 })
      }
      // 收藏文件跳转：进入父目录后选中该文件（未列到则忽略）
      if (pendingNavSelect.value) {
        const target = pendingNavSelect.value
        pendingNavSelect.value = null
        for (const cb of locateCbs) cb(target)
      }
    } catch (err) {
      if (seq !== listSeq) return
      entries.value = []
      cursor.value = null
      pageError.value = friendlyError(err)
    } finally {
      if (seq === listSeq) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor.value || loadingMore.value || !profileId.value) return
    const seq = listSeq
    loadingMore.value = true
    try {
      const page = await fsApi.list({ profileId: profileId.value, path: path.value, cursor: cursor.value })
      if (seq !== listSeq) return // 期间已切目录/切通道：过期分页不追加
      entries.value = [...entries.value, ...page.entries]
      cursor.value = page.nextCursor ?? null
    } catch (err) {
      if (seq === listSeq) ElMessage.error('加载更多失败：' + friendlyError(err))
    } finally {
      loadingMore.value = false
    }
  }

  watch(profileId, () => {
    localStorage.setItem('sshk.fs.profileId', profileId.value)
    path.value = '/'
    usageResults.value = new Map()
    usageLoadingPaths.value = new Set()
    if (!profileId.value) return
    // 收藏夹跨通道跳转：watch 已把路径清空重列，这里消费 pendingNavPath 再进目标目录
    if (pendingNavPath.value !== null) {
      const target = pendingNavPath.value
      pendingNavPath.value = null
      path.value = target
    }
    void list()
  })

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
  /** 收藏定位文件滚动（onLocate 回调内部用，等列表渲染完） */
  function scrollEntryIntoView(target: string): void {
    void nextTick(() => {
      document.querySelector(`[data-entry-path="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'center' })
    })
  }

  return {
    // 状态
    channels, outputRoot, profileId, path, pathInput, pathEditing,
    entries, cursor, loading, loadingMore, pageError, listEl,
    pendingNavPath, pendingNavSelect,
    // 派生
    activeChannel, hasWritable, crumbs, crumbItems, collapsedCrumbPath,
    // 容量统计
    usageLoadingPaths, usageResults, isUsageLoading, showUsage, sizeCell,
    // 行为
    loadChannels, list, loadMore, enterDir, goUp, gotoCrumb, submitPathInput, refresh, fmtTime, scrollEntryIntoView,
    // 注册
    onListStart, onDirReload, onLocate,
  }
}

export type FsListingApi = ReturnType<typeof useFsListing>
