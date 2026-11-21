import { ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FilePickerItem, FilePickerLibrary, FilePickerMode, FilePickerSource, FilePickerTarget } from '../types'

/**
 * 图库列表域（P6-3 自 FilePickerDialog 拆出，搬代码不改行为）：
 * 一次拉足（FETCH_LIMIT）+ 前端分批渲染（renderedCount 由壳持有传入）+ 懒加载；
 * 「加载更多」按游标续拉；关键词搜索支持跨页全量扫描（分块续拉直到扫完/达上限/被新上下文取代）。
 */

/** 一批渲染的文件数：一次拉全但分批挂 DOM，滚动到底再追加 */
export const PAGE_SIZE = 48
/** 一次向后端拉取的文件上限（各云 SDK 单页上限 ≥ 500；前端再分批渲染/懒加载） */
const FETCH_LIMIT = 500

export interface GalleryListProps {
  mode: FilePickerMode
  library: FilePickerLibrary
}

export interface GalleryListDeps {
  /** 当前激活来源 */
  activeSource: ComputedRef<FilePickerSource | null>
  /** 当前目录 target（列表请求参数） */
  target: Ref<FilePickerTarget>
  /** 文件名搜索关键词（带关键词刷新时自动续扫） */
  keyword: Ref<string>
  /** 已渲染数量（分批渲染游标，壳层持有） */
  renderedCount: Ref<number>
}

export interface GalleryList {
  /** 列表已列文件 */
  items: Ref<FilePickerItem[]>
  loadingList: Ref<boolean>
  /** 列表分页游标：非空表示来源侧还有剩余文件，可「加载更多」续拉 */
  galleryCursor: Ref<string | null>
  loadingMore: Ref<boolean>
  scanning: Ref<boolean>
  scanTotal: Ref<number>
  /** 扫描达上限（结果可能不全） */
  scanCapped: Ref<boolean>
  /** 终止在途搜索扫描 */
  cancelScan(): void
  /** 关键词变化后的跨页全量扫描入口（壳层防抖调用） */
  runSearchScan(): Promise<void>
  /** 刷新列表（拉首页；带关键词且来源侧还有剩余页时自动续扫） */
  loadGallery(): Promise<void>
  /** 「加载更多」续拉下一页 */
  loadMoreGallery(): Promise<void>
}

export function useGalleryList(props: GalleryListProps, deps: GalleryListDeps): GalleryList {
  /** 列表已列文件 */
  const items = ref<FilePickerItem[]>([])
  const loadingList = ref(false)
  /** 列表分页游标：非空表示来源侧还有剩余文件，可「加载更多」续拉 */
  const galleryCursor = ref<string | null>(null)
  const loadingMore = ref(false)

  /** ── 搜索跨页全量扫描：来源侧还有未加载页时自动分块续拉，保证关键词能命中后面页的文件 ── */
  const SEARCH_SCAN_CHUNK = 2000
  /** 扫描上限：防异常超大桶无限拉取（达到即提示「结果可能不全」） */
  const SEARCH_SCAN_MAX = 10_000
  const scanning = ref(false)
  const scanTotal = ref(0)
  const scanCapped = ref(false)
  let scanSeq = 0

  function cancelScan(): void {
    scanSeq++
    scanning.value = false
  }

  /** 从已加载页的游标开始分块续拉，直到扫完/达上限/被新上下文取代；匹配结果随 items 增长即时过滤呈现 */
  async function runSearchScan(): Promise<void> {
    const source = deps.activeSource.value
    if (!source || !deps.keyword.value || !galleryCursor.value || scanning.value) return
    const seq = ++scanSeq
    scanning.value = true
    scanTotal.value = items.value.length
    scanCapped.value = false
    try {
      let cursor: string | null = galleryCursor.value
      while (cursor && scanTotal.value < SEARCH_SCAN_MAX) {
        const page = await props.library.list(source, deps.target.value, { limit: SEARCH_SCAN_CHUNK, cursor, kind: props.mode })
        if (seq !== scanSeq) return // 关键词/目录/来源已变，本轮结果丢弃
        items.value = [...items.value, ...page.items]
        scanTotal.value = items.value.length
        cursor = page.nextCursor ?? null
        galleryCursor.value = cursor
      }
      if (cursor) scanCapped.value = true
    } catch (err) {
      if (seq === scanSeq) ElMessage.error(`搜索扫描失败：${(err as Error).message}`)
    } finally {
      if (seq === scanSeq) scanning.value = false
    }
  }

  async function loadGallery(): Promise<void> {
    const source = deps.activeSource.value
    if (!source) return
    scanSeq++ // 上下文重置：进行中的搜索扫描立即失效
    scanning.value = false
    loadingList.value = true
    deps.renderedCount.value = PAGE_SIZE
    try {
      // 不清空 pool：重选目录得到新列表后，此前已选仍保留，可继续累积
      const page = await props.library.list(source, deps.target.value, { limit: FETCH_LIMIT, kind: props.mode })
      items.value = page.items
      galleryCursor.value = page.nextCursor ?? null
    } catch (err) {
      items.value = []
      galleryCursor.value = null
      ElMessage.error(`读取文件列表失败：${(err as Error).message}`)
    } finally {
      loadingList.value = false
    }
    // 带关键词进入/刷新列表：来源侧还有未加载页时自动续扫，保证搜索能命中后面页
    if (deps.keyword.value && galleryCursor.value) void runSearchScan()
  }

  /** 「加载更多」续拉下一页（大目录 1000/10000+ 个文件时按页取，不一次列爆） */
  async function loadMoreGallery(): Promise<void> {
    const source = deps.activeSource.value
    if (!source || !galleryCursor.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const page = await props.library.list(source, deps.target.value, { limit: FETCH_LIMIT, cursor: galleryCursor.value, kind: props.mode })
      items.value = [...items.value, ...page.items]
      galleryCursor.value = page.nextCursor ?? null
      deps.renderedCount.value += PAGE_SIZE
    } catch (err) {
      ElMessage.error(`加载更多失败：${(err as Error).message}`)
    } finally {
      loadingMore.value = false
    }
  }

  return {
    items, loadingList, galleryCursor, loadingMore,
    scanning, scanTotal, scanCapped,
    cancelScan, runSearchScan, loadGallery, loadMoreGallery,
  }
}
