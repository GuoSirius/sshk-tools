<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText, useToolId } from '@sshk/ui-kit'
import { inMsRange } from '@sshk/shared'
import {
  posters, listLoading, currentPage, pageSize,
  onSelectionChange, onPageChange,
  loadPosterIntoWorkspace, onPosterCommand,
  sourceStates, staleCount, copyPosterLink,
  shareDialog, refreshShareLinks, posterLinkState,
  selectedPosters, batchExportHtml, batchDeletePosters, openListShare,
  startNewPosterConfirm,
} from '../state'

/**
 * Badge Studio——海报列表页：
 * 「编辑」把海报完整载入工作区并跳回生成页（草稿海报只回显名称/配置，回路完整）；
 * 状态/批量导出/删除在 ../state，删除确认弹框在壳页 actions 外统一挂载。
 * 操作列条件化（用户 2026-11-18）：复制链接/导出/复制代码/下载图片/分享/重新打标
 * 均按产物与链接状态条件显示，编辑/删除恒可用。
 *
 * 2026-11-20 列表页规范改造：壳 actions/footer 的批量按钮与分页下沉到页面内，
 * 形成 筛选栏 → 操作栏 → 表格 → 分页 的固定顺序；新增筛选与本地分页（草稿态/生效态分离）。
 */
const route = useRoute()
const router = useRouter()
const toolId = useToolId()

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

/** 批量删除（危险操作二次确认：禁遮罩禁 ESC） */
async function doBatchDelete(): Promise<void> {
  const rows = selectedPosters.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的海报'); return }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${rows.length} 个海报？记录将归档（产物文件保留）。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
    )
  } catch { return }
  await batchDeletePosters()
}

// ── 列表筛选（2026-11-20 规范：控件=草稿态，点查询才生效；重置=清空并立即生效）──
const kw = ref('')
const stateFilter = ref('all')
const dateRange = ref<[string, string] | null>(null)
const applied = ref({ kw: '', state: 'all', dateRange: null as [string, string] | null })
function doSearch(): void {
  applied.value = { kw: kw.value.trim(), state: stateFilter.value, dateRange: dateRange.value }
  currentPage.value = 1
  onPageChange()
}
function resetFilters(): void {
  kw.value = ''
  stateFilter.value = 'all'
  dateRange.value = null
  doSearch()
}
function posterState(row: PosterRecord): 'stale' | 'draft' | 'generated' {
  if (sourceStates.value[row._id]?.stale) return 'stale'
  return row.outputs.badged ? 'generated' : 'draft'
}
const filteredPosters = computed(() => {
  const f = applied.value
  const k = f.kw.toLowerCase()
  return posters.value.filter((row) => {
    if (k && !row.name.toLowerCase().includes(k)) return false
    if (f.state !== 'all' && posterState(row) !== f.state) return false
    // 时间范围：毫秒闭区间（shared 统一封装，规范精确到秒）
    if (!inMsRange(row.lastGeneratedAt ?? row.updatedAt, f.dateRange?.[0], f.dateRange?.[1])) return false
    return true
  })
})
const pagedRows = computed(() => filteredPosters.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

// 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
// eslint-disable-next-line no-restricted-syntax
onMounted(() => {
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

    <!-- 筛选栏：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置 -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="kw" size="small" clearable placeholder="名称" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">状态</span>
        <el-select v-model="stateFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="已生成" value="generated" />
          <el-option label="草稿" value="draft" />
          <el-option label="源已更新" value="stale" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">生成时间</span>
        <el-date-picker
          v-model="dateRange"
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
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：单独一行居右，紧凑口径 -->
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="createPoster">新建海报</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="warning" plain :disabled="selectedPosters.length === 0" @click="batchExportHtml">批量导出（{{ selectedPosters.length }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selectedPosters.length === 0" @click="doBatchDelete">批量删除（{{ selectedPosters.length }}）</el-button>
      <el-button size="small" type="success" plain :loading="shareDialog.loading" @click="openListShare">分享列表</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-if="filteredPosters.length > 0" v-loading="listLoading" :data="pagedRows" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
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
                 导出/复制代码/分享依赖 badged 产物、下载图片依赖截图产物、重新打标依赖源更新——全部条件显示 -->
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
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredPosters.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        size="small"
        background
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<style scoped>
/* 页面留白与区块间距由宿主 .tool-page-body 提供，页面自身不再加 padding（规范） */
.poster-list-panel { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; gap: var(--sshk-gap-sm); }
.stale-banner { flex: none; }
.stale-tag { margin-left: 6px; }
.filter-bar { flex: none; display: flex; gap: var(--sshk-gap-sm); align-items: center; flex-wrap: wrap; }
.filter-bar .el-button + .el-button { margin-left: 0; }
.filter-bar > .el-button:first-of-type { margin-left: 16px; }
.f-item { display: inline-flex; gap: var(--sshk-gap-sm); align-items: center; white-space: nowrap; }
.f-label { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
/* 操作栏紧凑口径：gap 4px + 归零 EP 兄弟 margin + padding 8px */
.toolbar { flex: none; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.toolbar .el-button + .el-button, .toolbar .el-button + .el-divider, .toolbar .el-divider + .el-button { margin-left: 0; }
.toolbar .el-button { padding-left: 8px; padding-right: 8px; }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; justify-content: flex-end; }
.op-row { display: flex; gap: 4px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
</style>
