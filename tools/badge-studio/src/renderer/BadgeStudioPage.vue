<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ToolPageLayout, ConfirmDialog, provideToolId } from '@sshk/ui-kit'
import { ShareDialog } from '@sshk/share-core/ui'
import { ArrowDown } from '@element-plus/icons-vue'
import GeneratePage from './pages/GeneratePage.vue'
import PostersPage from './pages/PostersPage.vue'
import {
  toolId, loadConfigAndRecent, loadPosters,
  hasHtml, generating, currentPosterId, currentGenerated, capturing, downloading,
  pickHtml, pickStats, downloadTemplate, markBeforeGenerate, generate, savePosterMeta, capturePoster, downloadPoster,
  posterName, shareDialog, openShare,
  backToListConfirm,
  deleteOpen, deleteTarget, confirmDelete,
} from './state'

/**
 * Badge Studio 渲染层——页面壳：
 * 只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面，业务在子页面与 state。
 * 「工具配置」菜单由宿主 ToolSettingsPage 接管，不会进入本组件（pages 表无需 config）。
 * 2026-11-20 列表页规范：海报列表的批量按钮/分页已下沉到 PostersPage 自身，
 * 壳 actions 只保留生成页按钮，footer 只保留生成页说明。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''
provideToolId(() => props.toolId ?? '')

const tab = computed(() => props.menu ?? 'posters')
const pages: Record<string, unknown> = { generate: GeneratePage, posters: PostersPage }
const active = computed(() => pages[tab.value] ?? GeneratePage)
const isPosters = computed(() => tab.value === 'posters')

const router = useRouter()
const route = useRoute()
/** 返回列表（流程定版 2026-11-18）：工作区 dirty 时二次确认（保存并返回/不保存返回/留页） */
async function backToList(): Promise<void> {
  if (await backToListConfirm()) void router.push('/tool/' + String(props.toolId ?? route.params.toolId) + '/posters')
}

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
    <!-- 列表页的按钮/分页已下沉到 PostersPage：此处用条件 slot，海报页不提供 actions/footer，
         ToolPageLayout 才不会渲染空白 head/foot 横条（2026-11-20 用户截图反馈） -->
    <template v-if="!isPosters" #actions>
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
      <el-button size="small" :disabled="!hasHtml" @click="markBeforeGenerate">批量补属性</el-button>
      <el-button type="primary" size="small" :loading="generating" :disabled="!hasHtml" @click="generate">
        生成海报
      </el-button>
      <el-button size="small" @click="savePosterMeta">保存修改</el-button>
      <el-button size="small" :loading="capturing" :disabled="!currentGenerated" @click="capturePoster">截图保存 PNG</el-button>
      <el-button type="success" size="small" :loading="downloading" :disabled="!currentGenerated" @click="downloadPoster">下载图片</el-button>
      <el-button size="small" type="warning" plain :loading="shareDialog.loading" :disabled="!currentGenerated" @click="openShare({ _id: currentPosterId, name: posterName || '海报' })">
        分享
      </el-button>
      <!-- 按钮按工作流排序（用户 2026-11-18 定版；门控 2026-11-19）：返回列表 → 选源（HTML/数据源/模板/补属性）→ 生成 → 保存 → 截图/下载/分享。
           补属性/生成只要求 HTML（数据可空，无数据时二次确认）；保存只要求海报名（新海报未生成可先存草稿）；
           截图/下载/分享要求已生成（存在 badge 副本），仅保存草稿不解锁 -->
      <el-button size="small" plain @click="backToList">返回列表</el-button>
    </template>

    <component :is="active" :menu="menu" />

    <template v-if="!isPosters" #footer>
      <span class="muted">原 HTML 全程只读 · 产物覆盖式生成</span>
    </template>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="删除海报"
      :targets="deleteTarget ? [deleteTarget.name] : []"
      confirm-text="删除"
      @confirm="confirmDelete"
    />

    <!-- 统一分享对话框（plans/09 ShareHub）：创建/二维码/复制/倒计时/续期/撤销全在组件内 -->
    <ShareDialog
      v-model:open="shareDialog.open"
      :tool-id="toolId"
      :label="shareDialog.label"
      :default-root="shareDialog.root"
      :default-entry="shareDialog.entry"
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
