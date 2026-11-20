<script setup lang="ts">
/**
 * 分享管理 · 路由管理页（plans/12 §8.1，默认入口）。
 * 可见全量路由（含所有工具创建，不传 toolId 即全量=跨工具特权）；续期/撤销/复制链接/更多（改TTL、永久、切换允许索引）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, CopyDocument, MoreFilled } from '@element-plus/icons-vue'
import { EmptyState } from '@sshk/ui-kit'
import type { ShareRouteInfo, ShareRouteTicket } from '@sshk/shared'
import { host } from '../host'
import { ttlLeft, routeState, routeStateTag, fmtDateTime, SHARE_PERMANENT_EXPIRES_AT } from '../share-util'

const routes = ref<ShareRouteInfo[]>([])
const status = ref<{ running: boolean; port: number } | null>(null)
const loading = ref(false)

/** 筛选草稿态（控件实时绑定）与生效态（点查询才拷贝，避免 5s 自动刷新干扰筛选） */
const search = ref('')
const toolFilter = ref('')
const stateFilter = ref('')
const applied = ref({ kw: '', toolId: '', state: '' })
const currentPage = ref(1)
const pageSize = ref(10)

const toolOptions = computed(() => [...new Set(routes.value.map((r) => r.toolId))])
const filtered = computed(() => {
  const f = applied.value
  const kw = f.kw.toLowerCase()
  return routes.value.filter((r) => {
    if (f.toolId && r.toolId !== f.toolId) return false
    if (f.state && routeState(r) !== f.state) return false
    if (!kw) return true
    return r.label.toLowerCase().includes(kw) || r.toolId.toLowerCase().includes(kw) || r.root.toLowerCase().includes(kw)
  })
})
const paged = computed(() => filtered.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

function doSearch(): void {
  applied.value = { kw: search.value.trim(), toolId: toolFilter.value, state: stateFilter.value }
  currentPage.value = 1
}
function resetFilters(): void {
  search.value = ''; toolFilter.value = ''; stateFilter.value = ''
  doSearch()
}

let timer: ReturnType<typeof setInterval> | null = null

async function refresh(): Promise<void> {
  loading.value = true
  try {
    routes.value = await host.shareHub.list()
    status.value = await host.shareHub.status()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { loading.value = false }
}

async function renewRoute(row: ShareRouteInfo, ttlHours: number | null, mode: 'reset' | 'extend' = 'reset'): Promise<void> {
  try {
    await host.shareHub.renew(row.id, ttlHours, mode)
    ElMessage.success(ttlHours === 0 ? '已设为永久有效' : `已续期 ${ttlHours} 小时`)
    await refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 更多▾ → 续期到默认 72h / 设为永久 / 切换允许索引 */
async function moreCommand(row: ShareRouteInfo, cmd: string): Promise<void> {
  if (cmd === 'ttl72') return renewRoute(row, 72)
  if (cmd === 'permanent') return renewRoute(row, 0)
  if (cmd === 'toggleIndex') {
    try {
      await host.shareHub.renew(row.id, null, 'reset', { allowIndex: !(row.allowIndex !== false) })
      ElMessage.success(row.allowIndex !== false ? '已关闭目录浏览' : '已允许目录浏览')
      await refresh()
    } catch (err) { ElMessage.error((err as Error).message) }
  }
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
    if (ok) { ElMessage.success('已撤销'); await refresh() }
    else ElMessage.warning('路由已不存在')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 复制链接：取展示 IP 首条（ticket 弹框复用范式） */
async function copyLink(row: ShareRouteInfo): Promise<void> {
  const s = status.value
  if (!s?.running || !s.port) { ElMessage.warning('分享服务未运行，无法生成链接'); return }
  // listRoutes 不含 token：经 renew(null) 原样返回 ticket 换取 urls（token 不变，零副作用）
  try {
    const ticket = await host.shareHub.renew(row.id, null) as ShareRouteTicket
    const url = ticket.urls[0] ?? ''
    if (!url) { ElMessage.warning('暂无可用链接'); return }
    await host.os.clipboardWrite(url)
    ElMessage.success('链接已复制')
  } catch (err) { ElMessage.error((err as Error).message) }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => { void refresh() }, 5000)
})
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })
</script>

<template>
  <div class="page-wrap">
    <!-- 筛选栏（2026-11-20 列表页规范：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置） -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="search" size="small" clearable placeholder="标签 / 工具 / 路径" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">工具</span>
        <el-select v-model="toolFilter" size="small" clearable placeholder="全部" style="width: 180px">
          <el-option v-for="t in toolOptions" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">状态</span>
        <el-select v-model="stateFilter" size="small" clearable placeholder="全部" style="width: 180px">
          <el-option label="有效" value="有效" />
          <el-option label="已过期" value="已过期" />
          <el-option label="永久" value="永久" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：筛选栏下方，单独一行居右 -->
    <div class="toolbar">
      <el-button size="small" type="success" plain :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
      <el-divider direction="vertical" />
      <el-tag size="small" type="info" class="mini-tag">{{ filtered.length }} 条 / 共 {{ routes.length }} 条</el-tag>
      <el-tag v-if="status?.running" size="small" type="success" class="mini-tag">运行中 · 端口 {{ status.port }}</el-tag>
      <el-tag v-else size="small" type="warning" class="mini-tag">服务未运行</el-tag>
    </div>

    <div class="table-wrap" v-loading="loading">
      <el-table v-if="paged.length > 0" :data="paged" size="small" height="100%">
        <el-table-column type="index" label="序号" width="56" align="center" fixed="left" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
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
        <el-table-column label="操作" width="240" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="renewRoute(row, 72)">续期</el-button>
              <el-button size="small" type="success" plain :icon="CopyDocument" @click="copyLink(row)">复制</el-button>
              <el-button size="small" type="danger" plain @click="revokeRoute(row)">撤销</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => moreCommand(row, cmd)">
                <el-button size="small" plain :icon="MoreFilled">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="ttl72">续期 72h（重置计时）</el-dropdown-item>
                    <el-dropdown-item command="permanent">设为永久有效</el-dropdown-item>
                    <el-dropdown-item command="toggleIndex">{{ row.allowIndex !== false ? '关闭目录浏览' : '允许目录浏览' }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="暂无分享路由；在内容管理或文件管理中生成分享链接后，路由会显示在这里" />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filtered.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        small
      />
    </div>
  </div>
</template>

<style scoped>
/* 三段式布局与内容管理列表对齐：根容器高度链 + 区块间距 token，表格区独占剩余高度 */
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
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
</style>
