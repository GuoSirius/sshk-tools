<script setup lang="ts">
/**
 * 分享管理 · 路由管理页（plans/12 §8.1，默认入口；P4-6 迁即重构）。
 * useTablePage（草稿/生效筛选 + 客户端分页 + 5s 轮询 pollMs）+ ListPageShell/TableOpsColumn/ListPagination
 * 公共组件栈（布局 CSS 全部上收 theme.css .lp-*）；
 * 可见全量路由（含所有工具创建，不传 toolId 即全量=跨工具特权，P1-5 硬鉴权保留）；
 * TableOpsColumn：续期(72h)/复制 内联，更多▾=设为永久/切换目录浏览/撤销（危险项收进更多）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, useTablePage } from '@sshk/ui-kit'
import type { HubStatus, ShareRouteInfo, ShareRouteTicket } from '@sshk/shared'
import { host } from '../host'
import { ttlLeft, routeState, routeStateTag, fmtDateTime, SHARE_PERMANENT_EXPIRES_AT } from '../share-util'

const allRoutes = ref<ShareRouteInfo[]>([])
const status = ref<HubStatus | null>(null)

// ── 列表状态（P4-6：useTablePage 统一承载 草稿/生效筛选 + 客户端分页 + 5s 轮询）──
const table = useTablePage<ShareRouteInfo, { kw: string; toolId: string; state: string }>({
  fetch: async () => {
    const [list, st] = await Promise.all([host.shareHub.list(), host.shareHub.status()])
    allRoutes.value = list
    status.value = st
    return list
  },
  rowKey: (r) => r.id,
  filters: () => ({ kw: '', toolId: '', state: '' }),
  clientFilter: (list, f) => {
    const kw = f.kw.toLowerCase()
    return list.filter((r) => {
      if (f.toolId && r.toolId !== f.toolId) return false
      if (f.state && routeState(r) !== f.state) return false
      if (!kw) return true
      return r.label.toLowerCase().includes(kw) || r.toolId.toLowerCase().includes(kw) || r.root.toLowerCase().includes(kw)
    })
  },
  pollMs: 5000,
  errorPrefix: '路由列表加载失败',
})

const toolOptions = computed(() => [...new Set(allRoutes.value.map((r) => r.toolId))])

// ── 行操作（危险操作一律二次确认，禁遮罩/禁 ESC）──
async function renewRoute(row: ShareRouteInfo, ttlHours: number | null, mode: 'reset' | 'extend' = 'reset'): Promise<void> {
  try {
    await host.shareHub.renew(row.id, ttlHours, mode)
    ElMessage.success(ttlHours === 0 ? '已设为永久有效' : `已续期 ${ttlHours} 小时`)
    await table.refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 切换允许目录浏览（renew(null) 原样续期 + allowIndex 覆盖，token 不变零副作用） */
async function toggleIndex(row: ShareRouteInfo): Promise<void> {
  try {
    await host.shareHub.renew(row.id, null, 'reset', { allowIndex: !(row.allowIndex !== false) })
    ElMessage.success(row.allowIndex !== false ? '已关闭目录浏览' : '已允许目录浏览')
    await table.refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function revokeRoute(row: ShareRouteInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认撤销「${row.label}」（${row.toolId}）的分享路由？该链接会立即失效且不可恢复。`,
      '撤销分享路由',
      { type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
    )
  } catch { return }
  try {
    const ok = await host.shareHub.revoke(row.id)
    if (ok) { ElMessage.success('已撤销'); await table.refresh() }
    else ElMessage.warning('路由已不存在')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 复制链接：取展示 IP 首条（ticket 弹框复用范式）；listRoutes 不含 token，经 renew(null) 原样返回 ticket 换取 urls */
async function copyLink(row: ShareRouteInfo): Promise<void> {
  const s = status.value
  if (!s?.running || !s.port) { ElMessage.warning('分享服务未运行，无法生成链接'); return }
  try {
    const ticket = await host.shareHub.renew(row.id, null) as ShareRouteTicket
    const url = ticket.urls[0] ?? ''
    if (!url) { ElMessage.warning('暂无可用链接'); return }
    await host.os.clipboardWrite(url)
    ElMessage.success('链接已复制')
  } catch (err) { ElMessage.error((err as Error).message) }
}

// ── 操作列（TableOpsColumn：≤3 内联 + 更多▾；语义配色 §2.5）──
const ops = [
  { key: 'renew', label: '续期', type: 'primary' as const },
  { key: 'copy', label: '复制', type: 'success' as const },
]
const moreOps = [
  { key: 'permanent', label: '设为永久有效', type: 'warning' as const },
  { key: 'toggleIndex', label: '切换目录浏览', type: 'info' as const },
  { key: 'revoke', label: '撤销', type: 'danger' as const },
]
function onAction(key: string, row: ShareRouteInfo): void {
  if (key === 'renew') void renewRoute(row, 72)
  else if (key === 'copy') void copyLink(row)
  else if (key === 'permanent') void renewRoute(row, 0)
  else if (key === 'toggleIndex') void toggleIndex(row)
  else if (key === 'revoke') void revokeRoute(row)
}

onMounted(() => { void table.refresh(); table.startPoll() })
onUnmounted(() => { table.stopPoll() })
</script>

<template>
  <ListPageShell :loading="table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="标签 / 工具 / 路径" style="width: 180px" @keyup.enter="table.search" />
      </div>
      <div class="f-item">
        <span class="f-label">工具</span>
        <el-select v-model="table.draft.value.toolId" size="small" clearable placeholder="全部" style="width: 180px">
          <el-option v-for="t in toolOptions" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">状态</span>
        <el-select v-model="table.draft.value.state" size="small" clearable placeholder="全部" style="width: 180px">
          <el-option label="有效" value="有效" />
          <el-option label="已过期" value="已过期" />
          <el-option label="永久" value="永久" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="table.search">查询</el-button>
      <el-button size="small" @click="table.reset">重置</el-button>
    </template>

    <template #ops>
      <el-tag v-if="status?.running" size="small" type="success">运行中 · 端口 {{ status.port }}</el-tag>
      <el-tag v-else size="small" type="warning">服务未运行</el-tag>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="table.loading.value" @click="table.refresh">刷新</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%">
      <el-table-column type="index" label="序号" width="56" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column prop="toolId" label="工具" width="110" show-overflow-tooltip />
      <el-table-column prop="label" label="标签" min-width="130" show-overflow-tooltip />
      <el-table-column prop="hits" label="访问数" width="70" align="center" />
      <el-table-column label="更新时间" width="150">
        <template #default="{ row }">{{ fmtDateTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="剩余" width="86">
        <template #default="{ row }">
          <el-tag v-if="row.expiresAt === SHARE_PERMANENT_EXPIRES_AT" type="warning" size="small" effect="plain" class="mini-tag">永久</el-tag>
          <span v-else>{{ ttlLeft(row.expiresAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="150">
        <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="70" align="center">
        <template #default="{ row }">
          <el-tag :type="routeStateTag(routeState(row))" size="small" effect="plain" class="mini-tag">{{ routeState(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="允许索引" width="78" align="center">
        <template #default="{ row }">
          <el-tag :type="row.allowIndex !== false ? 'warning' : 'info'" size="small" effect="plain" class="mini-tag">{{ row.allowIndex !== false ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <TableOpsColumn :actions="ops" :more="moreOps" width="200" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as ShareRouteInfo)" />
    </el-table>
    <EmptyState v-else description="暂无分享路由；在内容管理或文件管理中生成分享链接后，路由会显示在这里" />

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" />
    </template>
  </ListPageShell>
</template>

<style scoped>
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
</style>
