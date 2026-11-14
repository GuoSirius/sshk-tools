<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { ElMessage } from 'element-plus'
import {
  posters, listLoading, pagedPosters, currentPage, pageSize,
  onSelectionChange,
  loadPosterIntoWorkspace, onPosterCommand, exportPosterHtml,
} from '../state'

/**
 * Badge Studio——海报列表页：
 * 「编辑」把海报完整载入工作区并跳回生成页（回路完整）；
 * 状态/批量导出/删除在 ../state，壳 actions 槽的批量按钮同样消费单例。
 */
const route = useRoute()
const router = useRouter()
/** 页面内切视图：走路由（宿主菜单/高亮/URL 全同步），不再用 emit 补丁 */
function navigateToGenerate(): void {
  void router.push('/tool/' + String(route.params.toolId) + '/generate')
}

async function editPoster(row: PosterRecord): Promise<void> {
  if (!row.source.htmlPath) return
  navigateToGenerate()
  await loadPosterIntoWorkspace(row)
  ElMessage.success('已载入「' + row.name + '」到工作区，改完点「生成海报」覆盖该海报')
}
</script>

<template>
  <div class="panel poster-list-panel">
    <div v-if="posters.length > 0" class="table-flex-wrap">
      <el-table v-loading="listLoading" :data="pagedPosters" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="生成时间" width="160">
          <template #default="{ row }">
            <TimeText :value="row.lastGeneratedAt ?? row.updatedAt" />
          </template>
        </el-table-column>
        <el-table-column label="产物" min-width="220">
          <template #default="{ row }">
            <span class="muted">{{ row.outputs.badged ?? '—' }}</span>
            <span v-if="row.outputs.poster" class="ok"> / {{ row.outputs.poster }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <!-- 操作列约定：实体按钮 ≤3（常用优先），其余一律进「更多」下拉；新增操作先入下拉，确认高频才提升为按钮。宽度随内容同步调整 -->
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="editPoster(row)">编辑</el-button>
              <el-button size="small" type="success" plain @click="exportPosterHtml(row)">导出</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onPosterCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="copy">复制代码</el-dropdown-item>
                    <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <EmptyState v-else description="还没有海报记录" />
  </div>
</template>

<style scoped>
.poster-list-panel { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.table-flex-wrap { flex: 1; min-height: 0; }
.panel {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 10px;
}
.op-row {
  display: flex;
  gap: 6px;
  justify-content: center;
  align-items: center;
}
.op-row .el-button + .el-button { margin-left: 0; }
.muted { opacity: 0.6; font-size: 12px; }
.ok { color: var(--el-color-success); font-size: 12px; margin-top: 6px; }
</style>
