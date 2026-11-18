<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EmptyState, TimeText, useToolId } from '@sshk/ui-kit'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import {
  posters, listLoading, pagedPosters, currentPage, pageSize,
  onSelectionChange,
  loadPosterIntoWorkspace, onPosterCommand, exportPosterHtml,
  sourceStates, staleCount, openListShare, copyPosterLink,
} from '../state'
import { host } from '../host'

/**
 * Badge Studio——海报列表页：
 * 「编辑」把海报完整载入工作区并跳回生成页（回路完整）；
 * 状态/批量导出/删除在 ../state，壳 actions 槽的批量按钮同样消费单例。
 *
 * B8：第二个接入应用级上传能力的工具。选本地产物 → upload:batch，
 * profile / 覆盖项 / 密钥全在 main 进程解析，本页零重复配置。
 */
const route = useRoute()
const router = useRouter()
const uploading = ref(false)
const lastUpload = ref('')
const toolId = useToolId()

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

async function uploadArtifacts(): Promise<void> {
  const files = await host.os.pickFile({
    multi: true,
    filters: [{ name: '海报 / HTML 产物', extensions: ['png', 'jpg', 'html', 'htm'] }],
  })
  if (!files.length) return
  uploading.value = true
  batchProgress.active = true
  batchProgress.total = files.length
  batchProgress.percent = 0
  batchProgress.succeeded = 0
  batchProgress.failed = 0
  batchProgress.current = ''
  try {
    const results = (await host.upload.batch(files.map((file: string) => ({
      toolId: toolId.value,
      name: file.split(/[\\/]/).pop() ?? file,
      size: 0,
      source: file,
    })))) as { url: string; name?: string }[]
    lastUpload.value = results.map((r) => r.url).join(' · ')
    ElMessage.success(`已上传 ${results.length} 个产物文件`)
  } catch (err) {
    ElMessage.error(`上传失败：${(err as Error).message}`)
  } finally {
    uploading.value = false
    batchProgress.percent = 100
    setTimeout(() => { batchProgress.active = false }, 2000)
  }
}

// ── E-T2 上传进度事件消费：upload:progress 按名聚合为汇总条 ──
const batchProgress = reactive({ active: false, total: 0, percent: 0, succeeded: 0, failed: 0, current: '' })
function onUploadProgressEvent(p: { name: string; percent: number; status: string; error?: string }): void {
  if (!batchProgress.active) return
  batchProgress.current = p.name
  if (p.status === 'success') batchProgress.succeeded++
  else if (p.status === 'failed') batchProgress.failed++
  // 已完成文件计 100，进行中的取事件百分比；简化：完成数/总数 × 100 + 当前进行中的粗略占比
  const doneFiles = batchProgress.succeeded + batchProgress.failed
  batchProgress.percent = Math.min(100, Math.round((doneFiles / batchProgress.total) * 100))
}
// 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
// eslint-disable-next-line no-restricted-syntax
onMounted(() => { window.api.upload.onProgress(onUploadProgressEvent) })
onBeforeUnmount(() => { batchProgress.active = false })
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
    <div class="upload-bar">
      <el-button size="small" :icon="Upload" :loading="uploading" @click="uploadArtifacts">上传产物文件</el-button>
      <span class="muted" :title="lastUpload">{{ lastUpload ? `最近上传：${lastUpload}` : '复用应用级「上传配置」的全局 profile，本工具只覆盖少量非固定信息' }}</span>
      <el-progress
        v-if="batchProgress.active"
        class="upload-progress"
        :percentage="batchProgress.percent"
        :stroke-width="8"
        :status="batchProgress.failed > 0 ? 'exception' : undefined"
      />
      <span v-if="batchProgress.active" class="muted">
        {{ batchProgress.current }}（{{ batchProgress.succeeded }}/{{ batchProgress.total }}）
      </span>
      <!-- 列表级分享（右上角，2026-11-18）：整目录分享出链接前缀，行「复制链接」用它拼各行真实链接；
           顶部分享适合长时效/永久（对话框内时长可调，0=永久），行级单独分享（更多 → 分享页面）优先生效 -->
      <el-button size="small" type="warning" plain @click="openListShare">分享列表</el-button>
    </div>
    <div v-if="posters.length > 0" class="table-flex-wrap">
      <el-table v-loading="listLoading" :data="pagedPosters" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="sourceStates[row._id]?.stale" size="small" type="warning" class="stale-tag">源已更新</el-tag>
          </template>
        </el-table-column>
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
        <el-table-column label="操作" width="280" align="center" fixed="right">
          <template #default="{ row }">
            <!-- 操作列约定（用户 2026-11-18 定版）：编辑/复制链接/导出高频外显；分享/复制代码/下载图片/重新打标/删除进「更多」 -->
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="editPoster(row)">编辑</el-button>
              <el-button size="small" type="warning" plain title="优先复制本海报自己的分享链接；没有则用列表分享前缀拼本行产物路径" @click="copyPosterLink(row)">复制链接</el-button>
              <el-button size="small" type="success" plain @click="exportPosterHtml(row)">导出</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onPosterCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="share">分享页面</el-dropdown-item>
                    <el-dropdown-item command="copy">复制代码</el-dropdown-item>
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
.upload-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.upload-bar .muted { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
