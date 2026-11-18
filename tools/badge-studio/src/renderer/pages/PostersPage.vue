<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { ElMessage } from 'element-plus'
import {
  posters, listLoading, pagedPosters, currentPage, pageSize,
  onSelectionChange,
  loadPosterIntoWorkspace, onPosterCommand,
  sourceStates, staleCount, copyPosterLink,
  shareDialog, refreshShareLinks, posterLinkState,
} from '../state'

/**
 * Badge Studio——海报列表页：
 * 「编辑」把海报完整载入工作区并跳回生成页（草稿海报只回显名称/配置，回路完整）；
 * 状态/批量导出/删除在 ../state，壳 actions 槽的批量按钮同样消费单例。
 * 列表级分享「分享列表」按钮在壳页 actions 槽（与批量按钮同行）。
 * 操作列条件化（用户 2026-11-18）：复制链接/导出/复制代码/下载图片/分享/重新打标
 * 均按产物与链接状态条件显示，编辑/删除恒可用。
 */
const route = useRoute()
const router = useRouter()

/** 页面内切视图：走路由（宿主菜单/高亮/URL 全同步），不再用 emit 补丁 */
function navigateToGenerate(): void {
  void router.push('/tool/' + String(route.params.toolId) + '/generate')
}

async function editPoster(row: PosterRecord): Promise<void> {
  navigateToGenerate()
  await loadPosterIntoWorkspace(row)
  ElMessage.success('已载入「' + row.name + '」到工作区，改完点「生成海报」覆盖该海报')
}

// 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
// eslint-disable-next-line no-restricted-syntax
onMounted(() => {
  void refreshShareLinks() // 链接列 tag 数据源（路由快照）
})
// 分享弹框每次关闭后刷新：新建/撤销/重新生成都会改变行链接状态
watch(() => shareDialog.open, (open) => { if (!open) void refreshShareLinks() })
</script>

<template>
  <div class="panel poster-list-panel">
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
    <div v-if="posters.length > 0" class="table-flex-wrap">
      <el-table v-loading="listLoading" :data="pagedPosters" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
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
        <el-table-column label="操作" width="220" align="center" fixed="right">
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
    </div>
    <EmptyState v-else description="还没有海报记录" />
  </div>
</template>

<style scoped>
.poster-list-panel { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.stale-banner { margin-bottom: 10px; }
.stale-tag { margin-left: 6px; }
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
  padding: 0 10px; /* 用户 2026-11-18：操作两侧留白，按钮不贴单元格边缘 */
}
.op-row .el-button + .el-button { margin-left: 0; }
</style>
