<script setup lang="ts">
/**
 * 分享管理 · 访问日志页（plans/12 §8.2）。
 * EP datetimerange 快捷+自选时间范围（精确到时分秒，2026-11-20 列表页规范）；IP/路径搜索、状态码/工具过滤；导出 CSV（随筛选）、
 * 单条删除/批量删除/仅清空访问日志（均二次确认）；分页。数据走 NeDB shareLogs 独立通道。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Download } from '@element-plus/icons-vue'
import { EmptyState } from '@sshk/ui-kit'
import type { ShareAccessLog, ShareLogsQuery } from '@sshk/shared'
import { toMs } from '@sshk/shared'
import { host } from '../host'
import { fmtDateTime } from '../share-util'

interface RouteRow { id: string; label: string; toolId: string }

const rows = ref<ShareAccessLog[]>([])
const total = ref(0)
const routes = ref<RouteRow[]>([])
const loading = ref(false)
const searchIp = ref('')
const searchPath = ref('')
const statusGroup = ref('')
const toolFilter = ref('')
const dateRange = ref<[string, string] | null>(null)
const page = ref(1)
const pageSize = ref(50)
const selected = ref<ShareAccessLog[]>([])

/** 快捷：滚动窗口到当前时刻（毫秒精确），与自选自然日统一为 from/to 毫秒（plans/12 §十二③） */
const shortcuts = [
  { text: '近 1 小时', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 3600_000), now] } },
  { text: '近 24 小时', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 86_400_000), now] } },
  { text: '近 7 天', value: (): [Date, Date] => { const now = new Date(); return [new Date(now.getTime() - 7 * 86_400_000), now] } },
  { text: '全部', value: (): [Date, Date] => [new Date(0), new Date()] },
]

const routeMap = computed(() => new Map(routes.value.map((r) => [r.id, r])))

/** UI 过滤状态 → 查询条件（时间：2026-11-20 规範精确到时分秒，闭区间毫秒；无范围=全部） */
function buildQuery(offsetOverride?: number): ShareLogsQuery {
  let from: number | undefined
  let to: number | undefined
  if (dateRange.value && dateRange.value[0] && dateRange.value[1]) {
    from = toMs(dateRange.value[0]) ?? undefined
    to = toMs(dateRange.value[1]) ?? undefined
  }
  return {
    from, to,
    ip: searchIp.value.trim() || undefined,
    path: searchPath.value.trim() || undefined,
    statusGroup: (statusGroup.value || undefined) as ShareLogsQuery['statusGroup'],
    toolId: toolFilter.value || undefined,
    limit: pageSize.value,
    offset: offsetOverride ?? (page.value - 1) * pageSize.value,
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const res = await host.shareHub.logs(buildQuery())
    rows.value = res.rows
    total.value = res.total
    routes.value = await host.shareHub.list()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { loading.value = false }
}

function doSearch(): void { page.value = 1; void refresh() }

/** 重置：清空全部筛选并立即生效（2026-11-20 列表页规范：筛选栏统一 查询+重置） */
function resetFilters(): void {
  searchIp.value = ''; searchPath.value = ''; dateRange.value = null; statusGroup.value = ''; toolFilter.value = ''
  doSearch()
}

function statusColor(s: number): string {
  return s >= 200 && s < 400 ? 'var(--el-color-success)' : 'var(--el-color-danger)'
}

/** 列操作：按此 IP / 按此路由过滤 */
function filterByIp(ip: string): void { searchIp.value = ip; doSearch() }
function filterByRoute(routeId: string): void {
  const r = routeMap.value.get(routeId)
  if (r) toolFilter.value = r.toolId
  else ElMessage.info('该路由已撤销，无法按其过滤')
  doSearch()
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
    await refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除选中（danger 二次确认） */
async function removeSelected(): Promise<void> {
  const ids = selected.value.map((r) => r.id)
  if (!ids.length) { ElMessage.warning('请先勾选要删除的记录'); return }
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${ids.length} 条访问记录？删除后不可恢复。`, '批量删除', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch { return }
  try {
    const n = await host.shareHub.deleteLogs(ids)
    ElMessage.success(`已删除 ${n} 条`)
    selected.value = []
    await refresh()
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
    selected.value = []
    page.value = 1
    await refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 导出 CSV（随当前筛选；文件名带时间范围戳） */
async function exportCsv(): Promise<void> {
  try {
    const q = buildQuery(0)
    q.limit = 100000
    q.offset = 0
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

onMounted(() => { void refresh() })
</script>

<template>
  <div class="page-wrap">
    <!-- 筛选栏（2026-11-20 四轮规范：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置） -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">来源 IP</span>
        <el-input v-model="searchIp" clearable placeholder="全部" size="small" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">路径</span>
        <el-input v-model="searchPath" clearable placeholder="全部" size="small" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">时间</span>
        <el-date-picker
          v-model="dateRange" type="datetimerange" size="small" unlink-panels
          value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间"
          range-separator="至" :shortcuts="shortcuts" style="width: 360px" @change="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">状态码</span>
        <el-select v-model="statusGroup" clearable placeholder="全部" size="small" style="width: 180px" @change="doSearch">
          <el-option label="2xx 成功" value="2xx" />
          <el-option label="3xx 跳转" value="3xx" />
          <el-option label="4xx 失败" value="4xx" />
          <el-option label="5xx 服务错" value="5xx" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">工具</span>
        <el-select v-model="toolFilter" clearable placeholder="全部" size="small" style="width: 180px" @change="doSearch">
          <el-option v-for="r in routes" :key="r.id" :label="r.toolId" :value="r.toolId" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：筛选栏下方，单独一行居右 -->
    <div class="toolbar">
      <el-button size="small" type="success" plain :icon="Download" @click="exportCsv">导出 CSV</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selected.length" @click="removeSelected">批量删除</el-button>
      <el-button size="small" type="danger" plain @click="clearLogs">仅清空访问日志</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
      <span class="muted">共 {{ total }} 条</span>
    </div>
    <div class="table-wrap" v-loading="loading">
      <el-table v-if="rows.length > 0" :data="rows" size="small" height="100%" @selection-change="(v: ShareAccessLog[]) => selected = v">
        <el-table-column type="selection" width="40" fixed="left" />
        <el-table-column type="index" :index="(i: number) => (page - 1) * pageSize + i + 1" label="序号" width="60" align="center" fixed="left" />
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
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="filterByIp(row.ip)">按IP过滤</el-button>
              <el-button size="small" type="primary" plain @click="filterByRoute(row.routeId)">按路由</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="暂无访问记录；调整筛选条件或稍后再试" />
    </div>
    <div class="foot">
      <el-pagination
        v-model:current-page="page" v-model:page-size="pageSize" :total="total"
        :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next, jumper" small
        @current-change="refresh" @size-change="doSearch"
      />
    </div>
  </div>
</template>

<style scoped>
/* 三段式布局与内容管理列表对齐：根容器高度链 + 区块间距 token，表格区独占剩余高度 */
.page-wrap { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; padding: var(--sshk-page-padding); gap: var(--sshk-gap-sm); }
/* 筛选栏/操作栏（2026-11-20 列表页规范）：筛选在上 label+控件包 .f-item 整体换行不错开，操作单独一行居右 */
.filter-bar { flex: none; display: flex; align-items: center; gap: var(--sshk-gap-sm); flex-wrap: wrap; }
/* #128：查询/重置互相间距与控件一致（归零 EP 兄弟 margin 走 gap），查询与控件之间加大间隔 */
.filter-bar .el-button + .el-button { margin-left: 0; }
.filter-bar > .el-button:first-of-type { margin-left: 16px; }
.f-item { display: inline-flex; gap: var(--sshk-gap-sm); align-items: center; white-space: nowrap; }
.f-label { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
/* 操作栏紧凑口径（2026-11-20 用户反馈：内边距/间距缩小）——归零 EP 兄弟 margin，改用 gap 4px */
.toolbar { flex: none; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.toolbar .el-button + .el-button, .toolbar .el-button + .el-dropdown, .toolbar .el-dropdown + .el-button { margin-left: 0; }
.toolbar .el-button { padding-left: 8px; padding-right: 8px; }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; justify-content: flex-end; }
.muted { font-size: 12px; color: var(--el-text-color-secondary); }
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
</style>
