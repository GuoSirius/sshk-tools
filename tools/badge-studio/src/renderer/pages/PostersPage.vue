<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, ListPageShell, ListPagination, TimeText, useTablePage, useToolId } from '@sshk/ui-kit'
import { inMsRange } from '@sshk/shared'
import {
  posters, listLoading,
  loadPosterIntoWorkspace, onPosterCommand,
  sourceStates, staleCount, copyPosterLink,
  shareDialog, refreshShareLinks, posterLinkState,
  batchExportHtml, batchDeletePosters, openListShare,
  startNewPosterConfirm,
} from '../store'

/**
 * Badge Studio——海报列表页：
 * 「编辑」把海报完整载入工作区并跳回生成页（草稿海报只回显名称/配置，回路完整）；
 * 状态/批量导出/删除在 ../state，删除确认弹框在壳页 actions 外统一挂载。
 * 操作列条件化（用户 2026-11-18）：复制链接/导出/复制代码/下载图片/分享/重新打标
 * 均按产物与链接状态条件显示，编辑/删除恒可用。
 *
 * P6-1 收尾（#156）：接 useTablePage（草稿/生效筛选+分页+内置 useSelection）/ListPageShell/ListPagination
 * 公共组件栈（布局 CSS 全部上收 theme.css .lp-*；flush=嵌在 ToolPageLayout 留白体内去根 padding）。
 * 批量勾选单一真相 = useSelection（§七），批量删除/导出读 selection、删除后 prune 防「幽灵计数」；
 * 数据源 = state 单例 posters（壳挂载与各状态函数里 loadPosters），fetch 只回读该 ref，
 * watch 到集合替换后本地 refresh（不再发 IPC，零重复请求）。
 */
const route = useRoute()
const router = useRouter()
const toolId = useToolId()

// ── 列表状态（P6-1：useTablePage 统一承载 草稿/生效筛选 + 客户端分页）──
const table = useTablePage<PosterRecord, { kw: string; state: string; dateRange: [string, string] | null }>({
  // 数据源：state.loadPosters 写入 posters 单例；fetch 直返镜像（客户端过滤/分页由本组件承载，无 IPC）
  fetch: async () => posters.value,
  rowKey: (r) => r._id,
  filters: () => ({ kw: '', state: 'all', dateRange: null }),
  clientFilter: (list, f) => {
    const k = f.kw.trim().toLowerCase()
    return list.filter((row) => {
      if (k && !row.name.toLowerCase().includes(k)) return false
      if (f.state !== 'all' && posterState(row) !== f.state) return false
      // 时间范围：毫秒闭区间（shared 统一封装，规范精确到秒）
      if (!inMsRange(row.lastGeneratedAt ?? row.updatedAt, f.dateRange?.[0], f.dateRange?.[1])) return false
      return true
    })
  },
  selection: true,
})
const rowKey = table.rowKey
const selection = table.selection!
// 集合被 loadPosters 整体替换时本地重切分页（fetch 无 IPC，零重复请求），并清理已不存在的勾选
watch(posters, () => {
  void table.refresh().then(() => selection.prune(new Set(posters.value.map(rowKey))))
})

/** 批量勾选单一真相 = useSelection（§七）：el-table selection-change 全量同步（reserve-selection 跨页保留） */
function syncSelection(tableRows: PosterRecord[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

/** 页面内切视图：走路由（宿主菜单/高亮/URL 全同步），不再用 emit 补丁 */
function navigateToGenerate(): void {
  void router.push('/tool/' + (toolId.value || String(route.params.toolId)) + '/generate')
}
async function createPoster(): Promise<void> {
  if (!(await startNewPosterConfirm())) return
  navigateToGenerate()
}

async function editPoster(row: PosterRecord): Promise<void> {
  navigateToGenerate()
  await loadPosterIntoWorkspace(row)
  ElMessage.success('已载入「' + row.name + '」到工作区，改完点「生成海报」覆盖该海报')
}

/** 勾选单一真相（§七）：从 useSelection 反查行集合 */
function selectedRows(): PosterRecord[] {
  return posters.value.filter((p) => selection.has(p._id))
}

/** 批量删除（危险操作二次确认：禁遮罩禁 ESC）；删除后 prune 清理失效勾选（§七） */
async function doBatchDelete(): Promise<void> {
  const rows = selectedRows()
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的海报'); return }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${rows.length} 个海报？记录将归档（产物文件保留）。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
    )
  } catch { return }
  await batchDeletePosters(rows)
  selection.prune(new Set(posters.value.map(rowKey)))
}

async function doBatchExport(): Promise<void> {
  await batchExportHtml(selectedRows())
}

function posterState(row: PosterRecord): 'stale' | 'draft' | 'generated' {
  if (sourceStates.value[row._id]?.stale) return 'stale'
  return row.outputs.badged ? 'generated' : 'draft'
}

// 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
// eslint-disable-next-line no-restricted-syntax
onMounted(() => {
  void table.refresh() // 回读 state 单例当前集合（首轮等壳层 loadPosters 完成后由 watch 接管）
  void refreshShareLinks() // 链接列 tag 数据源（路由快照）
})
// 分享弹框每次关闭后刷新：新建/撤销/重新生成都会改变行链接状态
watch(() => shareDialog.open, (open) => { if (!open) void refreshShareLinks() })
</script>

<template>
  <div class="poster-list-panel">
    <!-- N5 源更新提示：源邮件重新生成后，行级标黄 + 一键重新打标 -->
    <el-alert
      v-if="staleCount > 0"
      type="warning"
      :closable="false"
      show-icon
      class="stale-banner"
      :title="`有 ${staleCount} 个海报的源邮件已重新生成，产物仍是旧数据`"
      description="点对应行「重新打标」即可用新源覆盖重生成（统计与角标配置沿用该海报已存的快照）。"
    />

    <ListPageShell flush :loading="listLoading || table.loading.value">
      <template #filter>
        <div class="f-item">
          <span class="f-label">搜索</span>
          <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="名称" style="width: 180px" @keyup.enter="table.search" />
        </div>
        <div class="f-item">
          <span class="f-label">状态</span>
          <el-select v-model="table.draft.value.state" size="small" style="width: 180px">
            <el-option label="全部" value="all" />
            <el-option label="已生成" value="generated" />
            <el-option label="草稿" value="draft" />
            <el-option label="源已更新" value="stale" />
          </el-select>
        </div>
        <div class="f-item">
          <span class="f-label">生成时间</span>
          <el-date-picker
            v-model="table.draft.value.dateRange"
            size="small"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
            style="width: 360px"
          />
        </div>
        <el-button size="small" type="primary" @click="table.search">查询</el-button>
        <el-button size="small" @click="table.reset">重置</el-button>
      </template>

      <template #ops>
        <el-button size="small" type="warning" plain :disabled="selection.count.value === 0" @click="doBatchExport">批量导出（{{ selection.count.value }}）</el-button>
        <el-button size="small" type="danger" plain :disabled="selection.count.value === 0" @click="doBatchDelete">批量删除（{{ selection.count.value }}）</el-button>
        <el-divider direction="vertical" />
        <el-button size="small" type="primary" plain @click="createPoster">新建海报</el-button>
        <el-button size="small" type="success" plain :loading="shareDialog.loading" @click="openListShare">分享列表</el-button>
      </template>

      <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
        <el-table-column type="index" label="#" width="46" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="sourceStates[row._id]?.stale" size="small" type="warning" class="stale-tag">源已更新</el-tag>
            <el-tag v-else-if="!row.outputs.badged" size="small" type="info" effect="plain" class="stale-tag">草稿</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生成时间" width="160">
          <template #default="{ row }">
            <TimeText :value="row.lastGeneratedAt ?? row.updatedAt" />
          </template>
        </el-table-column>
        <el-table-column label="链接" width="140" align="center">
          <template #default="{ row }">
            <!-- 用户 2026-11-18：产物列取消，改为链接 tag——类型（复制链接的来源：自身票优先→顶部前缀）+ 可访问性 -->
            <template v-if="posterLinkState(row).type">
              <el-tag size="small" :type="posterLinkState(row).type === '自身' ? 'primary' : 'warning'" effect="plain">
                {{ posterLinkState(row).type }}
              </el-tag>
              <el-tag size="small" :type="posterLinkState(row).alive ? 'success' : 'danger'" effect="plain" style="margin-left: 4px">
                {{ posterLinkState(row).alive ? '可访问' : '已失效' }}
              </el-tag>
            </template>
            <el-tag v-else size="small" type="info" effect="plain">未分享</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="right" fixed="right">
          <template #default="{ row }">
            <!-- 操作列条件化（用户 2026-11-18 定版，顺序 2026-11-18：复制链接在编辑前）；编辑/删除恒可用；复制链接有可用票才显示；
                 导出/复制代码/分享依赖 badged 产物、下载图片依赖截图产物、重新打标依赖源更新——全部条件显示。
                 （条件随行变化，TableOpsColumn 静态 actions 表达不了 per-row v-if，保持手写 op-row） -->
            <div class="op-row">
              <el-button
                v-if="posterLinkState(row).type"
                size="small" type="warning" plain
                title="优先复制本海报自己的分享链接；没有则用列表分享前缀拼本行产物路径"
                @click="copyPosterLink(row)"
              >复制链接</el-button>
              <el-button size="small" type="primary" plain @click="editPoster(row)">
                {{ row.outputs.badged ? '编辑' : '去生成' }}
              </el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onPosterCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="row.outputs.badged" command="share">分享页面</el-dropdown-item>
                    <el-dropdown-item v-if="row.outputs.badged" command="copy">复制代码</el-dropdown-item>
                    <el-dropdown-item v-if="row.outputs.badged" command="export">导出（HTML+长图）</el-dropdown-item>
                    <el-dropdown-item v-if="row.outputs.poster" command="download-png">下载图片</el-dropdown-item>
                    <el-dropdown-item v-if="sourceStates[row._id]?.stale" command="regenerate">重新打标（用新源覆盖）</el-dropdown-item>
                    <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState
        v-else
        :description="posters.length === 0 ? '还没有海报记录' : '没有符合条件的海报，试试调整筛选条件'"
        action-text="新建海报"
        @action="createPoster"
      />

      <template #footer>
        <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" :page-sizes="[10, 20, 50]" />
      </template>
    </ListPageShell>
  </div>
</template>

<style scoped>
/* 页面留白与区块间距由 ToolPageLayout .tool-page-body + .lp-page 提供，页面自身不再加 padding（规范）。
   列表布局（筛选/操作/表格/分页）CSS 全部上收 theme.css .lp-*，本页只留页面私有样式 */
.poster-list-panel { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; gap: var(--sshk-gap-sm); }
.stale-banner { flex: none; }
.stale-tag { margin-left: 6px; }
</style>
