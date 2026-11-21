import { computed, ref, watch, type Ref } from 'vue'
import { Document, Folder, Picture, VideoCamera } from '@element-plus/icons-vue'
import { isFsImageName, isFsMediaName, type FsChannelInfo, type FsEntry, type ShareRouteInfo } from '@sshk/shared'

/**
 * 视图状态（P4-4 自 FileExplorerPage 拆出）：列表/网格切换、排序、关键词与类型/链接下拉过滤、
 * 扩展列显隐（§十一 列设置）与实际渲染的过滤结果集。
 * 行为契约（与原页面逐字一致）：
 * - 下拉过滤仅影响显示，不影响选中集合语义（用户 2026-11-19）。
 * - 递归搜索态：结果已按名称排序，只叠加过滤不重排；普通目录按 dir→file + 排序键重排。
 * - 列显隐 localStorage 记忆（sshk.fs.cols），实际显示列 = 用户开关 ∩ 通道具备数据。
 */

export type FsShareMarkInfo = {
  kind: 'none' | 'own' | 'inherited'
  route?: ShareRouteInfo
  parent?: ShareRouteInfo
}

export interface FsViewDeps {
  entries: () => FsEntry[]
  searchActive: () => boolean
  searchEntries: () => FsEntry[]
  activeChannel: () => FsChannelInfo | null
  /** 分享三态标记（useFsShareMarks）：带链接过滤依赖它 */
  shareMarkOf: (entry: FsEntry) => FsShareMarkInfo
  /** 关键词过滤（页装配层持有、useFsSearch 共用）：搜索与目录内名称过滤是同一个输入框 */
  filter: Ref<string>
}

export function useFsView(deps: FsViewDeps) {
  const viewMode = ref<'list' | 'grid'>((localStorage.getItem('sshk.fs.view') as 'list' | 'grid' | null) ?? 'list')
  const sortKey = ref<'name' | 'size' | 'time'>('name')
  const sortDir = ref<'asc' | 'desc'>('asc')
  const filter = deps.filter
  /** 类型/链接下拉过滤（用户 2026-11-19）：仅影响显示，不影响选中集合语义 */
  const kindFilter = ref<'all' | 'file' | 'dir'>('all')
  const linkFilter = ref<'all' | 'linked' | 'unlinked'>('all')

  watch(viewMode, (v) => localStorage.setItem('sshk.fs.view', v))

  /** 带链接判定：本地=分享路由三态标记（own/inherited）；远程/云=有「链接」按钮的文件行（可复制 baseUrl 外链） */
  function hasLink(entry: FsEntry): boolean {
    return deps.activeChannel()?.type === 'local'
      ? deps.shareMarkOf(entry).kind !== 'none'
      : entry.kind === 'file'
  }
  /** 类型/链接下拉过滤：'all' 不动 */
  function applyDropdownFilters(list: FsEntry[]): FsEntry[] {
    let out = list
    if (kindFilter.value !== 'all') out = out.filter((e) => e.kind === kindFilter.value)
    if (linkFilter.value === 'linked') out = out.filter(hasLink)
    else if (linkFilter.value === 'unlinked') out = out.filter((e) => !hasLink(e))
    return out
  }
  const filteredEntries = computed(() => {
    const kw = filter.value.trim().toLowerCase()
    const nameMatch = (e: FsEntry): boolean => !kw || e.name.toLowerCase().includes(kw)
    // 递归搜索态：结果已按名称排序，只叠加过滤不重排
    if (deps.searchActive()) return applyDropdownFilters(deps.searchEntries().filter(nameMatch))
    const list = applyDropdownFilters(deps.entries().filter(nameMatch))
    const dir = sortDir.value === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      if (sortKey.value === 'size') return (((a.size ?? 0) - (b.size ?? 0)) || a.name.localeCompare(b.name)) * dir
      if (sortKey.value === 'time') return (((a.modified ?? 0) - (b.modified ?? 0)) || a.name.localeCompare(b.name)) * dir
      return a.name.localeCompare(b.name, 'zh-Hans-CN') * dir
    })
  })

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
  const hasCreated = computed(() => deps.activeChannel()?.type === 'local')
  const hasMode = computed(() => deps.activeChannel()?.type === 'local' || deps.activeChannel()?.protocol === 'sftp')
  const hasOwner = computed(() => deps.activeChannel()?.type === 'local' || deps.activeChannel()?.protocol === 'sftp')
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

  function fileIcon(entry: FsEntry): typeof Document {
    if (entry.kind === 'dir') return Folder
    if (isFsImageName(entry.name)) return Picture
    if (isFsMediaName(entry.name)) return VideoCamera
    return Document
  }

  return {
    viewMode, sortKey, sortDir, filter, kindFilter, linkFilter,
    hasLink, filteredEntries,
    colsVisible, hasCreated, hasMode, hasOwner, colsOpen, colShown, listGridCols,
    fileIcon,
  }
}

export type FsViewApi = ReturnType<typeof useFsView>
