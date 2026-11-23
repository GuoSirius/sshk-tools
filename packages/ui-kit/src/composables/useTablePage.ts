import { computed, onActivated, onDeactivated, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSelection, type Selection } from './useSelection'

/**
 * 列表页统一状态（B8/CR-30 · P2-1 建库）：
 * 分页状态 + 加载/错误 + 草稿/生效筛选分离 + 刷新 + 轮询 + 内置 useSelection（§七 跨页多选）。
 * 接线约定（写进《UI 与页面规范》）：
 * - el-table 必须绑定 :row-key="rowKey" 与 :data="data"；跨页勾选列加 reserve-selection；
 * - 批量操作一律读 selection.count / selection.selected，不读表格瞬时勾选；
 * - 删除/导入覆盖成功回调后调 selection.prune(validIds) 防「幽灵计数」。
 */
export interface UseTablePageOptions<T, F extends Record<string, unknown>> {
  /** 数据源：返回数组 = 客户端分页（全量拉回 + clientFilter + slice）；返回 {rows,total} = 服务端分页（search 时重拉） */
  fetch: () => Promise<T[] | { rows: T[]; total: number }>
  /** 行主键（useSelection 与 reserve-selection 共用） */
  rowKey: (row: T) => string
  /** 筛选草稿初值工厂（草稿态=控件实时绑定；生效态=点「查询」才拷贝） */
  filters?: () => F
  /** 客户端过滤（applied → 行过滤谓词集合）；服务端分页时筛选条件请放进 fetch 闭包读 applied */
  clientFilter?: (rows: T[], applied: F) => T[]
  /** 内置跨页多选：true 时返回 selection */
  selection?: boolean
  /** 自动刷新间隔 ms（如 RoutesPage 5s 轮询）；不传则不轮询 */
  pollMs?: number
  pageSize?: number
  /** 失败 toast 前缀（缺省直接展示 err.message） */
  errorPrefix?: string
}

export interface UseTablePageReturn<T, F extends Record<string, unknown>> {
  /** 当前页数据（客户端模式=过滤+分页切片；服务端模式=fetch.rows） */
  data: ComputedRef<T[]>
  loading: Ref<boolean>
  total: ComputedRef<number>
  page: Ref<number>
  pageSize: Ref<number>
  /** 筛选草稿（控件绑定）与生效态（点查询才拷贝） */
  draft: Ref<F>
  applied: Ref<F>
  /** 应用草稿 → 生效（回到第一页 + 服务端模式重拉） */
  search: () => Promise<void>
  /** 清空草稿并立即生效 */
  reset: () => Promise<void>
  /** 拉取/刷新（ loading 计数、错误 toast） */
  refresh: () => Promise<void>
  /** 行主键（el-table :row-key 与 selection 共用） */
  rowKey: (row: T) => string
  /** 跨页多选（options.selection 为 true 时才有） */
  selection: Selection | null
  /** 轮询控制（options.pollMs 设置时自动随生命周期启停；手动启停用这对） */
  startPoll: () => void
  stopPoll: () => void
}

export function useTablePage<T extends object, F extends Record<string, unknown> = Record<string, unknown>>(
  options: UseTablePageOptions<T, F>,
): UseTablePageReturn<T, F> {
  const rawRows = ref<T[]>([]) as Ref<T[]>
  const serverTotal = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(options.pageSize ?? 10)
  const draft = ref((options.filters?.() ?? {}) as F) as Ref<F>
  const applied = ref((options.filters?.() ?? {}) as F) as Ref<F>

  const selection: Selection | null = options.selection ? useSelection() : null

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const result = await options.fetch()
      if (Array.isArray(result)) {
        rawRows.value = result
        serverTotal.value = 0
      } else {
        rawRows.value = result.rows
        serverTotal.value = result.total
      }
      // 失效清理时机（§七）：删除/导入覆盖由调用方显式 prune；这里只防数据源缩水后的越界页
      const total = totalCount.value
      const maxPage = Math.max(1, Math.ceil(total / pageSize.value))
      if (page.value > maxPage) page.value = maxPage
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ElMessage.error(options.errorPrefix ? `${options.errorPrefix}：${msg}` : msg)
    } finally {
      loading.value = false
    }
  }

  const filtered = computed<T[]>(() => {
    if (serverTotal.value > 0) return rawRows.value // 服务端模式：过滤已下推
    const rows = rawRows.value
    return options.clientFilter ? options.clientFilter(rows, applied.value) : rows
  })
  const totalCount = computed<number>(() =>
    serverTotal.value > 0 ? serverTotal.value : filtered.value.length,
  )
  const data = computed<T[]>(() => {
    if (serverTotal.value > 0) return rawRows.value
    const start = (page.value - 1) * pageSize.value
    return filtered.value.slice(start, start + pageSize.value)
  })

  async function search(): Promise<void> {
    applied.value = { ...(draft.value as F) }
    page.value = 1
    await refresh()
  }

  async function reset(): Promise<void> {
    draft.value = (options.filters?.() ?? {}) as F
    await search()
  }

  let timer: ReturnType<typeof setInterval> | null = null
  function startPoll(): void {
    if (!options.pollMs || timer) return
    timer = setInterval(() => { void refresh() }, options.pollMs)
  }
  function stopPoll(): void {
    if (timer) { clearInterval(timer); timer = null }
  }
  // KeepAlive 缓存（台账 #182）配套：页面被缓存（deactivated）时停轮询防后台空转，回归（activated）恢复
  onActivated(() => { if (options.pollMs) startPoll() })
  onDeactivated(stopPoll)
  onUnmounted(stopPoll)

  return {
    data, loading, total: totalCount, page, pageSize,
    draft, applied, search, reset, refresh,
    rowKey: options.rowKey,
    selection, startPoll, stopPoll,
  }
}
