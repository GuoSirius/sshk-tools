<script setup lang="ts">
/**
 * 分享管理 · 挂载管理页（plans/12 §8.4；P4-6 迁即重构，对齐 ProxiesPage 样板）。
 * useTablePage（草稿/生效筛选+分页）+ useSelection（§七 跨页多选，批量删除单一真相）
 * + ListPageShell/TableOpsColumn/ListPagination 公共组件；布局 CSS 全部上收 theme.css .lp-*。
 * 新增/编辑走 MountEditDialog；每次增删改/启停即时写 config（入库前二次校验），危险操作一律二次确认。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Plus } from '@element-plus/icons-vue'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, useTablePage } from '@sshk/ui-kit'
import type { HubStatus, ShareHubMount } from '@sshk/shared'
import { host } from '../host'
import MountEditDialog, { type MountForm } from './MountEditDialog.vue'

interface MountRow { id: string; dir: string; alias: string; enabled: boolean; allowIndex: boolean; password: string }

const status = ref<HubStatus | null>(null)
const rows = ref<MountRow[]>([])

// ── 列表状态（P4-6：useTablePage 统一承载 草稿/生效筛选+分页；数据源=load() 写入 rows 镜像）──
const table = useTablePage<MountRow, { kw: string; state: string }>({
  fetch: async () => rows.value,
  rowKey: (r) => r.id,
  filters: () => ({ kw: '', state: 'all' }),
  clientFilter: (list, f) => {
    const k = f.kw.toLowerCase()
    return list.filter((r) => {
      if (f.state === 'enabled' && !r.enabled) return false
      if (f.state === 'disabled' && r.enabled) return false
      if (!k) return true
      return r.alias.toLowerCase().includes(k) || r.dir.toLowerCase().includes(k)
    })
  },
  selection: true,
  errorPrefix: '挂载列表加载失败',
})
const rowKey = table.rowKey
const selection = table.selection!

/** 批量勾选单一真相 = useSelection（§七）：el-table selection-change 全量同步（reserve-selection 跨页保留） */
function syncSelection(tableRows: MountRow[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

// ── 加载 / 落盘 ──
function toRow(m: ShareHubMount): MountRow {
  return { id: m.id, dir: m.dir, alias: m.alias, enabled: m.enabled, allowIndex: m.allowIndex !== false, password: String(m.password ?? '') }
}
async function refreshStatus(): Promise<void> { try { status.value = await host.shareHub.status() } catch { /* 静默 */ } }
async function load(): Promise<void> {
  const arr = await host.config.get('app.shareHub.mounts') as ShareHubMount[] | null
  rows.value = Array.isArray(arr) ? arr.map(toRow) : []
  await table.refresh()
}

/** 入库前校验（双层铁律第二层）：重复挂载点 / 空目录 / 非法别名——失败不发 IPC */
function validatePersist(next: MountRow[]): boolean {
  const seen = new Set<string>()
  for (const r of next) {
    if (!r.dir.trim()) { ElMessage.error('存在未选择目录的挂载，无法保存'); return false }
    const alias = r.alias.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-_]{0,31}$/.test(alias)) { ElMessage.error(`挂载点「${r.alias}」格式非法`); return false }
    if (seen.has(alias)) { ElMessage.error(`挂载点「${alias}」重复`); return false }
    seen.add(alias)
  }
  return true
}
/** 写盘 + 未运行时询问是否启动服务 */
async function persist(next: MountRow[], label: string): Promise<boolean> {
  if (!validatePersist(next)) return false
  try {
    await host.config.set('app.shareHub.mounts', next.map((r) => ({ ...r, allowIndex: r.allowIndex !== false, enabled: r.enabled === true })))
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
const editing = ref<MountForm | null>(null)
const takenAliases = computed(() => rows.value.filter((r) => r.id !== editing.value?.id).map((r) => r.alias))
function openCreate(): void { editing.value = null; dialogOpen.value = true }
function openEdit(row: MountRow): void { editing.value = { ...row }; dialogOpen.value = true }
async function onSave(form: MountForm, done: (ok: boolean) => void): Promise<void> {
  const idx = rows.value.findIndex((r) => r.id === form.id)
  const next = idx >= 0 ? rows.value.map((r) => (r.id === form.id ? { ...form } : r)) : [...rows.value, { ...form }]
  const ok = await persist(next, idx >= 0 ? '挂载目录' : '新增挂载')
  done(ok) // 失败时弹框保留表单，用户可修正后重试
}

// ── 行操作 ──
function mountLink(row: MountRow): string {
  const s = status.value
  if (!s?.running || !s.port || !row.enabled || !row.alias) return ''
  const ak = row.password ? `?ak=${encodeURIComponent(row.password)}` : ''
  return `http://${s.displayIp}:${s.port}/${row.alias}/${ak}`
}
async function copyLink(row: MountRow): Promise<void> {
  const url = mountLink(row)
  if (!url) { ElMessage.warning('服务未运行或挂载已停用，暂无可用链接'); return }
  try { await host.os.clipboardWrite(url); ElMessage.success('访问地址已复制') } catch (err) { ElMessage.error((err as Error).message) }
}
async function toggleEnabled(row: MountRow, enabled: boolean): Promise<void> {
  await persist(rows.value.map((r) => (r.id === row.id ? { ...r, enabled } : r)), '启停状态')
}
async function removeOne(row: MountRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`移除挂载「${row.alias || row.dir}」？保存后该目录的分享链接将立即失效。`, '移除挂载目录', {
      type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
    })
  } catch { return }
  await persist(rows.value.filter((r) => r.id !== row.id), '移除挂载')
}
/** 批量删除单一真相 = useSelection（§七）：读 selection.count/selected，不读表格瞬时勾选 */
async function removeSelected(): Promise<void> {
  const ids = [...selection.selected.value]
  if (!ids.length) { ElMessage.warning('请先勾选要删除的挂载'); return }
  try {
    await ElMessageBox.confirm(`确认移除选中的 ${ids.length} 个挂载？对应分享链接将立即失效。`, '批量移除挂载', {
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
function onAction(key: string, row: MountRow): void {
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
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="挂载点 / 目录" style="width: 180px" @keyup.enter="table.search" />
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
      <el-button size="small" type="success" plain :icon="Plus" @click="openCreate">新增挂载</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selection.count.value" @click="removeSelected">批量删除（{{ selection.count.value }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="table.loading.value" @click="load">刷新</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
      <el-table-column type="selection" width="38" reserve-selection />
      <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column label="挂载点" min-width="120" show-overflow-tooltip>
        <template #default="{ row }"><span class="alias">/{{ row.alias }}</span></template>
      </el-table-column>
      <el-table-column prop="dir" label="本地目录" min-width="200" show-overflow-tooltip />
      <el-table-column label="访问密钥" width="96" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.password" size="small" type="warning" effect="plain">已设置</el-tag>
          <span v-else class="muted">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="允许索引" width="88" align="center">
        <template #default="{ row }"><el-tag size="small" :type="row.allowIndex !== false ? 'warning' : 'info'" effect="plain">{{ row.allowIndex !== false ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="启用" width="72" align="center">
        <template #default="{ row }"><el-switch :model-value="row.enabled" size="small" @change="(v: string | number | boolean) => toggleEnabled(row, v === true)" /></template>
      </el-table-column>
      <el-table-column label="访问地址" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button v-if="mountLink(row)" link type="primary" size="small" @click="copyLink(row)">{{ mountLink(row) }}</el-button>
          <span v-else class="muted">{{ row.enabled ? '（服务未运行）' : '（已停用）' }}</span>
        </template>
      </el-table-column>
      <TableOpsColumn :actions="ops" width="180" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as MountRow)" />
    </el-table>
    <EmptyState v-else description="还没有挂载目录；新增一个目录即可生成固定分享链接" action-text="新增挂载" @action="openCreate" />

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" />
    </template>

    <MountEditDialog v-model="dialogOpen" :record="editing" :taken-aliases="takenAliases" @save="onSave" />
  </ListPageShell>
</template>

<style scoped>
.alias { font-weight: 600; }
.muted { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
