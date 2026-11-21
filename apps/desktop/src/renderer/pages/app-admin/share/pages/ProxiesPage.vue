<script setup lang="ts">
/**
 * 分享管理 · 代理管理页（plans/12 §8.5，#140 列表化改造）。
 * P2-1 样板页（#156 迁即重构）：useTablePage（草稿/生效筛选+分页+轮询）+ useSelection（§七 跨页多选）
 * + ListPageShell/TableOpsColumn/ListPagination 公共组件；布局 CSS 全部上收 theme.css .lp-*。
 * 新增/编辑走 ProxyEditDialog；每次增删改/启停即时写 config（入库前二次校验），危险操作一律二次确认。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Plus } from '@element-plus/icons-vue'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, useTablePage } from '@sshk/ui-kit'
import type { HubStatus, ShareHubProxy } from '@sshk/shared'
import { host } from '../host'
import ProxyEditDialog, { type ProxyForm } from './ProxyEditDialog.vue'

interface ProxyRow { id: string; prefix: string; target: string; keepHost: boolean; enabled: boolean }

const status = ref<HubStatus | null>(null)

// ── 列表状态（P2-1：useTablePage 统一承载 草稿/生效筛选+分页+加载+轮询）──
const table = useTablePage<ProxyRow, { kw: string; state: string }>({
  // 数据源：load() 读 config 后写入 rows 镜像；fetch 直返镜像（客户端过滤/分页由本组件承载）
  fetch: async () => rows.value,
  rowKey: (r) => r.id,
  filters: () => ({ kw: '', state: 'all' }),
  clientFilter: (list, f) => {
    const k = f.kw.toLowerCase()
    return list.filter((r) => {
      if (f.state === 'enabled' && !r.enabled) return false
      if (f.state === 'disabled' && r.enabled) return false
      if (!k) return true
      return r.prefix.toLowerCase().includes(k) || r.target.toLowerCase().includes(k)
    })
  },
  selection: true,
  errorPrefix: '代理列表加载失败',
})

const rows = ref<ProxyRow[]>([])
const rowKey = table.rowKey
const selection = table.selection!

/** 批量勾选单一真相 = useSelection（§七）：el-table selection-change 全量同步（reserve-selection 跨页保留） */
function syncSelection(tableRows: ProxyRow[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

// ── 加载 / 落盘 ──
function toRow(r: ShareHubProxy): ProxyRow {
  return { id: r.id, prefix: r.prefix, target: r.target, keepHost: r.keepHost !== false, enabled: r.enabled === true }
}
async function refreshStatus(): Promise<void> { try { status.value = await host.shareHub.status() } catch { /* 静默 */ } }
async function load(): Promise<void> {
  const arr = await host.config.get('app.shareHub.proxies') as ShareHubProxy[] | null
  rows.value = Array.isArray(arr) ? arr.map(toRow) : []
  await table.refresh()
}

/** 入库前校验（双层铁律第二层）：重复前缀 / 空地址 / 非法协议——失败不发 IPC */
function validatePersist(next: ProxyRow[]): boolean {
  const seen = new Set<string>()
  for (const r of next) {
    const p = r.prefix.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-_]{0,31}$/.test(p)) { ElMessage.error(`代理前缀「${r.prefix}」格式非法`); return false }
    if (seen.has(p)) { ElMessage.error(`代理前缀「${p}」重复`); return false }
    seen.add(p)
    if (!r.target.trim() || !/^https?:\/\/\S+/i.test(r.target.trim())) { ElMessage.error(`代理「/${p}」目标地址非法（须以 http:// 或 https:// 开头）`); return false }
  }
  return true
}
async function persist(next: ProxyRow[], label: string): Promise<boolean> {
  if (!validatePersist(next)) return false
  try {
    await host.config.set('app.shareHub.proxies', next.map((r) => ({ ...r, keepHost: r.keepHost !== false, enabled: r.enabled === true })))
    rows.value = next
    // P1-1 配套：数据源变更后同步引擎数据 + 失效勾选清理（§七 防「幽灵计数」）
    await table.refresh()
    selection.prune(new Set(rows.value.map(rowKey)))
    await refreshStatus()
    if (status.value?.running) { ElMessage.success(`${label}已保存并即时生效`); return true }
    try {
      await ElMessageBox.confirm(`${label}已保存。分享服务当前未运行，是否立即启动使链接可访问？`, '保存成功', {
        type: 'info', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '启动服务', cancelButtonText: '暂不启动',
      })
      await (host.shareHubControl as Record<string, (a: string) => Promise<unknown>>).start!('start')
    } catch { /* 暂不启动 */ }
    return true
  } catch (err) { ElMessage.error((err as Error).message); return false }
}

// ── 新增 / 编辑弹框 ──
const dialogOpen = ref(false)
const editing = ref<ProxyForm | null>(null)
const takenPrefixes = computed(() => rows.value.filter((r) => r.id !== editing.value?.id).map((r) => r.prefix))
function openCreate(): void { editing.value = null; dialogOpen.value = true }
function openEdit(row: ProxyRow): void { editing.value = { ...row }; dialogOpen.value = true }
async function onSave(form: ProxyForm): Promise<void> {
  const idx = rows.value.findIndex((r) => r.id === form.id)
  const next = idx >= 0 ? rows.value.map((r) => (r.id === form.id ? { ...form } : r)) : [...rows.value, { ...form }]
  await persist(next, idx >= 0 ? '代理规则' : '新增代理')
}

// ── 行操作 ──
function proxyLink(row: ProxyRow): string {
  const s = status.value
  if (!s?.running || !s.port || !row.enabled || !row.prefix) return ''
  return `http://${s.displayIp}:${s.port}/${row.prefix}/`
}
async function copyLink(row: ProxyRow): Promise<void> {
  const url = proxyLink(row)
  if (!url) { ElMessage.warning('服务未运行或代理已停用，暂无可用链接'); return }
  try { await host.os.clipboardWrite(url); ElMessage.success('代理地址已复制') } catch (err) { ElMessage.error((err as Error).message) }
}
async function toggleEnabled(row: ProxyRow, enabled: boolean): Promise<void> {
  await persist(rows.value.map((r) => (r.id === row.id ? { ...r, enabled } : r)), '启停状态')
}
async function removeOne(row: ProxyRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`移除代理「/${row.prefix}」？保存后该代理入口将立即失效。`, '移除代理规则', {
      type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
    })
  } catch { return }
  await persist(rows.value.filter((r) => r.id !== row.id), '移除代理')
}
/** 批量删除单一真相 = useSelection（§七）：读 selection.count/selected，不读表格瞬时勾选 */
async function removeSelected(): Promise<void> {
  const ids = [...selection.selected.value]
  if (!ids.length) { ElMessage.warning('请先勾选要删除的代理'); return }
  try {
    await ElMessageBox.confirm(`确认移除选中的 ${ids.length} 条代理规则？对应入口将立即失效。`, '批量移除代理', {
      type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
    })
  } catch { return }
  const idSet = new Set(ids)
  selection.clear()
  await persist(rows.value.filter((r) => !idSet.has(r.id)), '批量移除')
}

const ops = [
  { key: 'edit', label: '编辑', type: 'primary' as const },
  { key: 'copy', label: '复制', type: 'success' as const },
  { key: 'remove', label: '删除', type: 'danger' as const },
]
function onAction(key: string, row: ProxyRow): void {
  if (key === 'edit') openEdit(row)
  else if (key === 'copy') void copyLink(row)
  else if (key === 'remove') void removeOne(row)
}

let statusTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void load()
  table.startPoll()
  statusTimer = setInterval(() => { void refreshStatus() }, 3000)
})
onUnmounted(() => {
  table.stopPoll()
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
})
</script>

<template>
  <ListPageShell :loading="table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="前缀 / 目标地址" style="width: 180px" @keyup.enter="table.search" />
      </div>
      <div class="f-item">
        <span class="f-label">状态</span>
        <el-select v-model="table.draft.value.state" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="已启用" value="enabled" />
          <el-option label="已停用" value="disabled" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="table.search">查询</el-button>
      <el-button size="small" @click="table.reset">重置</el-button>
    </template>

    <template #ops>
      <el-button size="small" type="success" plain :icon="Plus" @click="openCreate">新增代理</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selection.count.value" @click="removeSelected">批量删除（{{ selection.count.value }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="table.loading.value" @click="table.refresh">刷新</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
      <el-table-column type="selection" width="38" reserve-selection />
      <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column label="路径前缀" min-width="120" show-overflow-tooltip>
        <template #default="{ row }"><span class="prefix">/{{ row.prefix }}/</span></template>
      </el-table-column>
      <el-table-column prop="target" label="目标地址" min-width="240" show-overflow-tooltip />
      <el-table-column label="保留 Host" width="96" align="center">
        <template #default="{ row }"><el-tag size="small" :type="row.keepHost !== false ? 'warning' : 'info'" effect="plain">{{ row.keepHost !== false ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="启用" width="72" align="center">
        <template #default="{ row }"><el-switch :model-value="row.enabled" size="small" @change="(v: string | number | boolean) => toggleEnabled(row, v === true)" /></template>
      </el-table-column>
      <el-table-column label="代理地址" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button v-if="proxyLink(row)" link type="primary" size="small" @click="copyLink(row)">{{ proxyLink(row) }}</el-button>
          <span v-else class="muted">{{ row.enabled ? '（服务未运行）' : '（已停用）' }}</span>
        </template>
      </el-table-column>
      <TableOpsColumn :actions="ops" width="180" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as ProxyRow)" />
    </el-table>
    <EmptyState v-else description="还没有代理规则；新增一条即可把 /前缀/ 转发到目标地址" action-text="新增代理" @action="openCreate" />

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" :page-sizes="[10, 20, 50]" />
    </template>

    <ProxyEditDialog v-model="dialogOpen" :record="editing" :taken-prefixes="takenPrefixes" @save="onSave" />
  </ListPageShell>
</template>

<style scoped>
.prefix { font-weight: 600; }
.muted { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
