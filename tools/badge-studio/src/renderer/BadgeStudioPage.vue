<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ToolPageLayout, ConfirmDialog, provideToolId } from '@sshk/ui-kit'
import { ArrowDown } from '@element-plus/icons-vue'
import GeneratePage from './pages/GeneratePage.vue'
import PostersPage from './pages/PostersPage.vue'
import {
  toolId, loadConfigAndRecent, loadPosters,
  hasHtml, hasStats, generating, currentPosterId, capturing, downloading,
  pickHtml, pickStats, downloadTemplate, markBeforeGenerate, generate, savePosterMeta, capturePoster, downloadPoster,
  posterName, sharePoster, stopPosterShare, shareState,
  selectedPosters, batchExportHtml, batchDeletePosters,
  currentPage, pageSize, posters, onPageChange,
  deleteOpen, deleteTarget, confirmDelete,
} from './state'

/**
 * Badge Studio 渲染层——页面壳：
 * 只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面，业务在子页面与 state。
 * 「工具配置」菜单由宿主 ToolSettingsPage 接管，不会进入本组件（pages 表无需 config）。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''
provideToolId(() => props.toolId ?? '')

const tab = computed(() => props.menu ?? 'generate')
const pages: Record<string, unknown> = { generate: GeneratePage, posters: PostersPage }
const active = computed(() => pages[tab.value] ?? GeneratePage)
const isPosters = computed(() => tab.value === 'posters')

onMounted(() => {
  void loadConfigAndRecent()
  void loadPosters()
})
</script>

<template>
  <ToolPageLayout
    title="Badge Studio"
    description="邮件 HTML + 点击统计（文件 / 粘贴 / 多图识别）→ 可编辑表格人工校对 → 注入 badge 副本 → 海报长图（原文件永不修改）"
  >
    <template #actions>
      <template v-if="!isPosters">
        <el-button size="small" @click="pickHtml">选择 HTML</el-button>
        <el-button size="small" @click="pickStats">选择数据源</el-button>
        <!-- 项4：数据源模板下载——点击主按钮直接下 Excel，右侧箭头下拉可选 CSV / JSON -->
        <el-dropdown trigger="click" @command="(cmd: string) => void downloadTemplate(cmd as 'xlsx' | 'csv' | 'json')">
          <el-button-group>
            <el-button size="small" type="success" plain @click="void downloadTemplate('xlsx')">模板下载</el-button>
            <el-button size="small" type="success" plain><el-icon><ArrowDown /></el-icon></el-button>
          </el-button-group>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="xlsx">Excel 模板（.xlsx · 默认）</el-dropdown-item>
              <el-dropdown-item command="csv">CSV 模板（.csv）</el-dropdown-item>
              <el-dropdown-item command="json">JSON 模板（.json）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button size="small" :disabled="!hasHtml || !hasStats" @click="markBeforeGenerate">批量补属性</el-button>
        <el-button type="primary" size="small" :loading="generating" :disabled="!hasHtml || !hasStats" @click="generate">
          生成海报
        </el-button>
        <el-button size="small" :disabled="!currentPosterId" @click="savePosterMeta">保存修改</el-button>
        <el-button size="small" :loading="capturing" :disabled="!currentPosterId" @click="capturePoster">截图保存 PNG</el-button>
        <el-button type="success" size="small" :loading="downloading" @click="downloadPoster">下载图片</el-button>
        <el-button v-if="!shareState.running" size="small" type="warning" plain :disabled="!currentPosterId" @click="sharePoster({ _id: currentPosterId, name: posterName || '海报' })">
          分享
        </el-button>
        <el-button v-else size="small" type="warning" plain @click="stopPosterShare">停止分享</el-button>
      </template>
      <template v-else>
        <el-button size="small" :disabled="selectedPosters.length === 0" @click="batchExportHtml">批量导出 HTML（{{ selectedPosters.length }}）</el-button>
        <el-button size="small" type="danger" :disabled="selectedPosters.length === 0" @click="batchDeletePosters">批量删除（{{ selectedPosters.length }}）</el-button>
      </template>
    </template>

    <component :is="active" :menu="menu" />

    <template #footer>
      <template v-if="isPosters">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="posters.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          small
          background
          @current-change="onPageChange"
        />
      </template>
      <span v-else class="muted">共 {{ posters.length }} 个海报 · 原 HTML 全程只读 · 产物覆盖式生成</span>
    </template>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="删除海报"
      :targets="deleteTarget ? [deleteTarget.name] : []"
      confirm-text="删除"
      @confirm="confirmDelete"
    />
  </ToolPageLayout>
</template>

<style scoped>
.muted {
  opacity: 0.6;
  font-size: 12px;
}
/* 该页面接管布局：body 不滚动（生成页左右列各自滚、海报列表自身三段式） */
.tool-page-layout :deep(.tool-page-body) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.tool-page-layout :deep(.badge-grid),
.tool-page-layout :deep(.poster-list-panel) {
  flex: 1;
  min-height: 0;
}
</style>
