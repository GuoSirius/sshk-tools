<script setup lang="ts">
/**
 * 分享管理 · 代理管理页（plans/12 §8.5，#140 列表化改造）。
 * 规范列表页：筛选栏（label+.f-item+查询/重置）→ 操作栏 → 表格 → 分页；新增/编辑走 ProxyEditDialog；
 * 每次增删改/启停即时写 config（入库前二次校验），危险操作一律二次确认。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, Plus } from '@element-plus/icons-vue'
import { EmptyState } from '@sshk/ui-kit'
import type { HubStatus, ShareHubProxy } from '@sshk/shared'
import { host } from '../host'
import ProxyEditDialog, { type ProxyForm } from './ProxyEditDialog.vue'

interface ProxyRow { id: string; prefix: string; target: string; keepHost: boolean; enabled: boolean }

const status = ref<HubStatus | null>(null)
const rows = ref<ProxyRow[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// ── 列表筛选（草稿态/生效态分离）──
const kw = ref('')
const stateFilter = ref('all')
const applied = ref({ kw: '', state: 'all' })
const currentPage = ref(1)
const pageSize = ref(10)
const selected = ref<ProxyRow[]>([])

function doSearch(): void {
  applied.value = { kw: kw.value.trim(), state: stateFilter.value }
  currentPage.value = 1
}
function resetFilters(): void { kw.value = ''; stateFilter.value = 'all'; doSearch() }

const filtered = computed(() => {
  const f = applied.value
  const k = f.kw.toLowerCase()
  return rows.value.filter((r) => {
    if (f.state === 'enabled' && !r.enabled) return false
    if (f.state === 'disabled' && r.enabled) return false
    if (!k) return true
    return r.prefix.toLowerCase().includes(k) || r.target.toLowerCase().includes(k)
  })
})
const paged = computed(() => filtered.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

// ── 加载 / 落盘 ──
function toRow(r: ShareHubProxy): ProxyRow {
  return { id: r.id, prefix: r.prefix, target: r.target, keepHost: r.keepHost !== false, enabled: r.enabled === true }
}
async function refreshStatus(): Promise<void> { try { status.value = await host.shareHub.status() } catch { /* 静默 */ } }
async function load(): Promise<void> {
  loading.value = true
  try {
    const arr = await host.config.get('app.shareHub.proxies') as ShareHubProxy[] | null
    rows.value = Array.isArray(arr) ? arr.map(toRow) : []
    await refreshStatus()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { loading.value = false }
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
async function removeSelected(): Promise<void> {
  const ids = new Set(selected.value.map((r) => r.id))
  if (!ids.size) { ElMessage.warning('请先勾选要删除的代理'); return }
  try {
    await ElMessageBox.confirm(`确认移除选中的 ${ids.size} 条代理规则？对应入口将立即失效。`, '批量移除代理', {
      type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
    })
  } catch { return }
  selected.value = []
  await persist(rows.value.filter((r) => !ids.has(r.id)), '批量移除')
}

onMounted(() => { void load(); timer = setInterval(() => { void refreshStatus() }, 3000) })
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })
</script>

<template>
  <div class="page-wrap">
    <!-- 筛选栏（列表页规范：label+控件包 .f-item 整体换行；末尾统一 查询+重置） -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="kw" size="small" clearable placeholder="前缀 / 目标地址" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">状态</span>
        <el-select v-model="stateFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="已启用" value="enabled" />
          <el-option label="已停用" value="disabled" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：单独一行居右 -->
    <div class="toolbar">
      <el-button size="small" type="success" plain :icon="Plus" @click="openCreate">新增代理</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selected.length" @click="removeSelected">批量删除（{{ selected.length }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="table-wrap" v-loading="loading">
      <el-table v-if="paged.length > 0" :data="paged" size="small" height="100%" @selection-change="(v: ProxyRow[]) => selected = v">
        <el-table-column type="selection" width="38" />
        <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
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
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="success" plain @click="copyLink(row)">复制</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有代理规则；新增一条即可把 /前缀/ 转发到目标地址" action-text="新增代理" @action="openCreate" />
    </div>

    <div class="foot">
      <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next, jumper" small />
    </div>

    <ProxyEditDialog v-model="dialogOpen" :record="editing" :taken-prefixes="takenPrefixes" @save="onSave" />
  </div>
</template>

<style scoped>
.page-wrap { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; padding: var(--sshk-page-padding); gap: var(--sshk-gap-sm); }
.filter-bar { flex: none; display: flex; gap: var(--sshk-gap-sm); align-items: center; flex-wrap: wrap; }
.filter-bar .el-button + .el-button { margin-left: 0; }
.filter-bar > .el-button:first-of-type { margin-left: 16px; }
.f-item { display: inline-flex; gap: var(--sshk-gap-sm); align-items: center; white-space: nowrap; }
.f-label { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
.toolbar { flex: none; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.toolbar .el-button + .el-button, .toolbar .el-button + .el-dropdown, .toolbar .el-dropdown + .el-button { margin-left: 0; }
.toolbar .el-button { padding-left: 8px; padding-right: 8px; }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; justify-content: flex-end; }
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
.prefix { font-weight: 600; }
.muted { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
