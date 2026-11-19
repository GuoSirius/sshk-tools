<script setup lang="ts">
/**
 * 分享管理 · 路由管理页（plans/12 §8.1，默认入口）。
 * 可见全量路由（含所有工具创建，不传 toolId 即全量=跨工具特权）；续期/撤销/复制链接/更多（改TTL、永久、切换允许索引）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, CopyDocument, MoreFilled } from '@element-plus/icons-vue'
import type { ShareRouteInfo, ShareRouteTicket } from '@sshk/shared'
import { host } from '../host'
import { ttlLeft, routeState, routeStateTag, fmtDateTime, SHARE_PERMANENT_EXPIRES_AT } from '../share-util'

const routes = ref<ShareRouteInfo[]>([])
const status = ref<{ running: boolean; port: number } | null>(null)
const loading = ref(false)
const search = ref('')
const toolFilter = ref('')
const stateFilter = ref('')

let timer: ReturnType<typeof setInterval> | null = null

const toolOptions = computed(() => [...new Set(routes.value.map((r) => r.toolId))])
const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return routes.value.filter((r) => {
    if (toolFilter.value && r.toolId !== toolFilter.value) return false
    if (stateFilter.value && routeState(r) !== stateFilter.value) return false
    if (!kw) return true
    return r.label.toLowerCase().includes(kw) || r.toolId.toLowerCase().includes(kw) || r.root.toLowerCase().includes(kw)
  })
})

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
    <div class="toolbar">
      <el-input v-model="search" clearable placeholder="搜索标签 / 工具 / 路径" size="small" style="width: 220px" />
      <el-select v-model="toolFilter" clearable placeholder="工具：全部" size="small" style="width: 150px">
        <el-option v-for="t in toolOptions" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="stateFilter" clearable placeholder="状态：全部" size="small" style="width: 120px">
        <el-option label="有效" value="有效" />
        <el-option label="已过期" value="已过期" />
        <el-option label="永久" value="永久" />
      </el-select>
      <el-button type="success" size="small" :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
      <el-tag size="small" type="info" class="mini-tag">{{ filtered.length }} 条 / 共 {{ routes.length }} 条</el-tag>
      <el-tag v-if="status?.running" size="small" type="success" class="mini-tag">运行中 · 端口 {{ status.port }}</el-tag>
      <el-tag v-else size="small" type="warning" class="mini-tag">服务未运行</el-tag>
    </div>
    <el-table :data="filtered" size="small" v-loading="loading" empty-text="暂无分享路由" style="width: 100%">
      <el-table-column type="index" label="序号" width="56" align="center" fixed="left" />
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
      <el-table-column label="操作" width="196" align="center" fixed="right">
        <template #default="{ row }">
          <div class="op-row">
            <el-button size="small" text type="primary" @click="renewRoute(row, 72)">续期</el-button>
            <el-button size="small" text type="success" :icon="CopyDocument" @click="copyLink(row)">复制</el-button>
            <el-button size="small" text type="danger" @click="revokeRoute(row)">撤销</el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => moreCommand(row, cmd)">
              <el-button size="small" text :icon="MoreFilled" />
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
  </div>
</template>

<style scoped>
.page-wrap { padding: 12px 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
.op-row { display: inline-flex; align-items: center; gap: 2px; }
.op-row :deep(.el-button) { padding: 3px 5px; font-size: 12px; margin-left: 0; }
.op-row :deep(.el-dropdown) { margin-left: 2px; }
</style>
