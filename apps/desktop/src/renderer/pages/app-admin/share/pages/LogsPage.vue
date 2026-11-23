<script setup lang="ts">
/**
 * 分享管理 · 访问日志页（plans/12 §8.2；P4-6 迁即重构）。
 * useTablePage 服务端分页模式（NeDB skip/limit 下推，P1-5/CR-45 游标分页契约零变化）+
 * ListPageShell/TableOpsColumn/ListPagination；筛选（IP/路径/时间范围精确到时分秒/状态码/工具）草稿生效分离；
 * 批量删除单一真相 = useSelection（§七 跨页多选，删除后 prune 防「幽灵计数」）；
 * 单条删除/批量删除/仅清空（均二次确认）；导出 CSV（随当前筛选）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Download } from '@element-plus/icons-vue'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, useTablePage } from '@sshk/ui-kit'
import type { ShareAccessLog, ShareLogsQuery } from '@sshk/shared'
import { toMs } from '@sshk/shared'
import { host } from '../host'
import { fmtDateTime } from '../share-util'

interface RouteRow { id: string; label: string; toolId: string }
// type 而非 interface：useTablePage 的 F 泛型约束 Record<string, unknown>，interface 无隐式索引签名
type LogFilters = { ip: string; path: string; statusGroup: string; toolId: string; range: [string, string] | null }

const routes = ref<RouteRow[]>([])

// ── 列表状态（useTablePage 服务端分页：fetch 返回 {rows,total}；筛选条件放进 fetch 读 applied）──
const table = useTablePage<ShareAccessLog, LogFilters>({
  // 显式返回类型：fetch 闭包内引用 table 自身（读 applied/page/pageSize），不标注会 TS7022 循环推断
  fetch: async (): Promise<{ rows: ShareAccessLog[]; total: number }> => {
    const res = await host.shareHub.logs(buildQuery(table.applied.value, table.pageSize.value, (table.page.value - 1) * table.pageSize.value))
    routes.value = await host.shareHub.list()
    return { rows: res.rows, total: res.total }
  },
  rowKey: (r) => r.id,
  filters: (): LogFilters => ({ ip: '', path: '', statusGroup: '', toolId: '', range: null }),
  pageSize: 50,
  selection: true,
  errorPrefix: '访问日志加载失败',
})
const rowKey = table.rowKey
const selection = table.selection!

/** 批量勾选单一真相 = useSelection（§七）：el-table selection-change 全量同步（reserve-selection 跨页保留） */
function syncSelection(tableRows: ShareAccessLog[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

/** 快捷：滚动窗口到当前时刻（毫秒精确），与自选自然日统一为 from/to 毫秒（plans/12 §十二③） */
const shortcuts = [
  { text: '近 1 小时', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 3600_000), now] } },
  { text: '近 24 小时', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 86_400_000), now] } },
  { text: '近 7 天', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 7 * 86_400_000), now] } },
  { text: '全部', value: (): [Date, Date] => [new Date(0), new Date()] },
]

const routeMap = computed(() => new Map(routes.value.map((r) => [r.id, r])))

/** UI 筛选状态 → 查询条件（时间：精确到时分秒，闭区间毫秒；无范围=全部；服务端分页下推 skip/limit） */
function buildQuery(f: LogFilters, limit: number, offset: number): ShareLogsQuery {
  let from: number | undefined
  let to: number | undefined
  if (f.range && f.range[0] && f.range[1]) {
    from = toMs(f.range[0]) ?? undefined
    to = toMs(f.range[1]) ?? undefined
  }
  return {
    from, to,
    ip: f.ip.trim() || undefined,
    path: f.path.trim() || undefined,
    statusGroup: (f.statusGroup || undefined) as ShareLogsQuery['statusGroup'],
    toolId: f.toolId || undefined,
    limit,
    offset,
  }
}

// ── 服务端分页重拉：翻页/改页尺寸后重拉（ListPagination 只改状态；页尺寸变化 ListPagination 已回第一页）──
watch([table.page, table.pageSize], () => { void table.refresh() })

/** 查询：草稿 → 生效（回第一页；已在第一页则直接重拉，翻页触发由 watch 承接，避免双重拉取） */
async function doSearch(): Promise<void> {
  table.applied.value = { ...table.draft.value }
  if (table.page.value === 1) await table.refresh()
  else table.page.value = 1
}

/** 重置：清空全部筛选并立即生效（2026-11-20 列表页规范：筛选栏统一 查询+重置） */
async function resetFilters(): Promise<void> {
  table.draft.value = { ip: '', path: '', statusGroup: '', toolId: '', range: null }
  await doSearch()
}

function statusColor(s: number): string {
  return s >= 200 && s < 400 ? 'var(--el-color-success)' : 'var(--el-color-danger)'
}

/** 列操作：按此 IP / 按此路由过滤 */
function filterByIp(ip: string): void {
  table.draft.value.ip = ip
  void doSearch()
}
function filterByRoute(routeId: string): void {
  const r = routeMap.value.get(routeId)
  if (r) table.draft.value.toolId = r.toolId
  else ElMessage.info('该路由已撤销，无法按其过滤')
  void doSearch()
}

/** 单条删除（danger 二次确认，禁遮罩禁 ESC） */
async function removeOne(row: ShareAccessLog): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除这条访问记录（${fmtDateTime(row.at)} · ${row.ip}）？`, '删除访问记录', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch { return }
  try {
    const n = await host.shareHub.deleteLogs([row.id])
    ElMessage.success(`已删除 ${n} 条`)
    await table.refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除选中（danger 二次确认）；单一真相 = selection.count/selected，不读表格瞬时勾选 */
async function removeSelected(): Promise<void> {
  const ids = [...selection.selected.value]
  if (!ids.length) { ElMessage.warning('请先勾选要删除的记录'); return }
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${ids.length} 条访问记录？删除后不可恢复。`, '批量删除', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch { return }
  try {
    const n = await host.shareHub.deleteLogs(ids)
    ElMessage.success(`已删除 ${n} 条`)
    // 失效清理（§七）：被删 id 已不存在，清空勾选真相；reserve-selection 残留随 refresh 后 selection-change 归零
    selection.clear()
    await table.refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 仅清空访问日志（不影响分享路由，danger 二次确认） */
async function clearLogs(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空全部访问日志？该操作不可恢复（不影响分享链接与路由）。', '仅清空访问日志', {
      type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch { return }
  try {
    const n = await host.shareHub.clearLogs()
    ElMessage.success(`已清空（删除 ${n} 条）`)
    selection.clear()
    await table.refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 导出 CSV（随当前生效筛选；文件名带时间范围戳） */
async function exportCsv(): Promise<void> {
  try {
    const q = buildQuery(table.applied.value, 100000, 0)
    const csv = await host.shareHub.exportLogs(q)
    if (!csv || csv === '\ufeff') { ElMessage.info('当前筛选条件下没有可导出的记录'); return }
    const stamp = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const name = `share-logs-${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}.csv`
    const path = await host.os.pickSave({ fileName: name, extensions: ['csv'] })
    if (!path) return
    await host.os.writeText(path, csv)
    ElMessage.success('CSV 已导出')
  } catch (err) { ElMessage.error((err as Error).message) }
}

// ── 操作列（TableOpsColumn）──
const ops = [
  { key: 'byIp', label: '按IP过滤', type: 'primary' as const },
  { key: 'byRoute', label: '按路由', type: 'primary' as const },
  { key: 'remove', label: '删除', type: 'danger' as const },
]
function onAction(key: string, row: ShareAccessLog): void {
  if (key === 'byIp') filterByIp(row.ip)
  else if (key === 'byRoute') filterByRoute(row.routeId)
  else if (key === 'remove') void removeOne(row)
}

onMounted(() => { void table.refresh() })
</script>

<template>
  <ListPageShell :loading="table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">来源 IP</span>
        <el-input v-model="table.draft.value.ip" clearable placeholder="全部" size="small" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">路径</span>
        <el-input v-model="table.draft.value.path" clearable placeholder="全部" size="small" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">时间</span>
        <el-date-picker
          v-model="table.draft.value.range" type="datetimerange" size="small" unlink-panels
          value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间"
          range-separator="至" :shortcuts="shortcuts" style="width: 360px" />
      </div>
      <div class="f-item">
        <span class="f-label">状态码</span>
        <el-select v-model="table.draft.value.statusGroup" clearable placeholder="全部" size="small" style="width: 180px">
          <el-option label="2xx 成功" value="2xx" />
          <el-option label="3xx 跳转" value="3xx" />
          <el-option label="4xx 失败" value="4xx" />
          <el-option label="5xx 服务错" value="5xx" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">工具</span>
        <el-select v-model="table.draft.value.toolId" clearable placeholder="全部" size="small" style="width: 180px">
          <el-option v-for="r in routes" :key="r.id" :label="r.toolId" :value="r.toolId" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </template>

    <template #ops>
      <el-button size="small" type="success" plain :icon="Download" @click="exportCsv">导出 CSV</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selection.count.value" @click="removeSelected">批量删除（{{ selection.count.value }}）</el-button>
      <el-button size="small" type="danger" plain @click="clearLogs">仅清空访问日志</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="table.loading.value" @click="table.refresh">刷新</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
      <el-table-column type="selection" width="40" fixed="left" reserve-selection />
      <el-table-column type="index" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" label="序号" width="60" align="center" fixed="left" />
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ fmtDateTime(row.at) }}</template>
      </el-table-column>
      <el-table-column prop="ip" label="来源 IP" width="140" show-overflow-tooltip />
      <el-table-column prop="path" label="路径" min-width="160" show-overflow-tooltip />
      <el-table-column label="状态码" width="76" align="center">
        <template #default="{ row }"><span :style="{ color: statusColor(row.status) }">{{ row.status }}</span></template>
      </el-table-column>
      <el-table-column label="命中路由" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="routeMap.get(row.routeId)">{{ routeMap.get(row.routeId)!.label }}</span>
          <el-tag v-else size="small" type="info" effect="plain" class="mini-tag">已撤销</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="归属工具" width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ routeMap.get(row.routeId)?.toolId ?? '' }}</template>
      </el-table-column>
      <TableOpsColumn :actions="ops" width="220" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as ShareAccessLog)" />
    </el-table>
    <EmptyState v-else description="暂无访问记录；调整筛选条件或稍后再试" />

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" />
    </template>
  </ListPageShell>
</template>

<style scoped>
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
</style>
