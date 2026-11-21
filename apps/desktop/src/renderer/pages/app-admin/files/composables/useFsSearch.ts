import { fsApi, osApi } from './fsHost'
import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FsEntry } from '@sshk/shared'
import { friendlyError } from './useFsListing'

/**
 * 递归搜索（二期，P4-4 自 FileExplorerPage 拆出）：回车触发，扫当前路径前缀（根 = 整个通道）。
 * 行为契约（与原页面逐字一致）：
 * - 流式：主进程每攒 20 条/完成一层就推一批，第一批到达即进入列表视图；不再等全量扫完白屏。
 * - 当前目录（已加载）的命中作为首批结果——保证「不回车能看到的，回车后也一定在」。
 * - activeSearchId 会话 id：切换目录/退出搜索/新搜索时作废，在途批次与结果一律丢弃。
 */
export interface FsSearchDeps {
  profileId: () => string
  path: () => string
  /** 当前目录已加载条目（首批命中来源） */
  entries: () => FsEntry[]
  /** 搜索关键词（工具栏过滤框草稿值，双向） */
  filter: Ref<string>
}

export function useFsSearch(deps: FsSearchDeps) {
  const searchActive = ref(false)
  const searchLoading = ref(false)
  const searchEntries = ref<FsEntry[]>([])
  const searchTruncated = ref(false)
  const searchScannedDirs = ref(0)
  /** 当前搜索会话 id：切换目录/退出搜索/新搜索时置空，在途批次与结果一律丢弃 */
  let activeSearchId = ''
  /** 新搜索发起时清空选中（页面装配时绑定 selection.reset，避免 composable 环依赖） */
  let resetSelection: () => void = () => { /* 装配前空实现 */ }
  function bindResetSelection(fn: () => void): void { resetSelection = fn }

  /** list() 发起时作废在途搜索会话（原 list() 开头的四行复位，不清 filter、不动 searchLoading） */
  function invalidateSession(): void {
    activeSearchId = ''
    searchActive.value = false
    searchEntries.value = []
    searchTruncated.value = false
  }

  async function runSearch(): Promise<void> {
    const kw = deps.filter.value.trim()
    if (!kw) { searchActive.value = false; searchEntries.value = []; return }
    if (!deps.profileId()) return
    const reqId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    activeSearchId = reqId
    searchLoading.value = true
    searchActive.value = true // 立刻进入搜索态，横幅显示「扫描中…」
    // 先把当前目录（已加载）的命中作为首批结果——保证「不回车能看到的，回车后也一定在」
    // （用户 2026-11-18：输入 tool 有 6 个，回车递归只剩 1 个，因云扫描上限截断漏掉当前目录）
    const localHits = deps.entries().filter((e) => e.name.toLowerCase().includes(kw.toLowerCase()))
    searchEntries.value = localHits.slice()
    searchScannedDirs.value = 0
    searchTruncated.value = false
    resetSelection()
    const off = fsApi.onSearchEvent((e) => {
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
      const r = await fsApi.search({ profileId: deps.profileId(), path: deps.path(), keyword: kw, reqId })
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
    deps.filter.value = ''
  }

  /** 搜索结果态命中子目录文件时的所在目录（用户 2026-11-19：不再内联灰字，改为名称后 icon——hover 查看完整目录、点击复制目录） */
  function searchDirHint(entry: FsEntry): string {
    if (!searchActive.value || entry.kind !== 'file') return ''
    return entry.path.slice(0, entry.path.lastIndexOf('/'))
  }

  /** 复制搜索命中文件的完整路径（含文件名，用户 2026-11-19） */
  async function copyEntryDir(entry: FsEntry): Promise<void> {
    if (!searchDirHint(entry)) return
    await osApi.clipboardWrite(entry.path)
    ElMessage.success('路径已复制')
  }

  return {
    searchActive, searchLoading, searchEntries, searchTruncated, searchScannedDirs,
    runSearch, exitSearch, invalidateSession, bindResetSelection, searchDirHint, copyEntryDir,
  }
}

export type FsSearchApi = ReturnType<typeof useFsSearch>
