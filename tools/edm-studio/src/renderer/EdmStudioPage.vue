<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ToolPageLayout, provideToolId } from '@sshk/ui-kit'
import ContentManagePage from './pages/ContentManagePage.vue'
import MailsPage from './pages/MailsPage.vue'
import UploadProgressToast from './components/UploadProgressToast.vue'
import { ensureLoaded } from './state'
import { subscribeUploadProgress } from './upload-progress'

/**
 * EDM Studio 渲染层——页面壳：
 * 只负责接收宿主 menu 并分发到 pages/ 下各页面，业务全部在子页面与 state/shared。
 * 目录约定：renderer/<Id>Page.vue 壳（宿主只发现这一个文件）、pages/ 每菜单一页、
 * state.ts 共享集合、shared.ts 类型与底层调用。
 * R24：原「系统内容」「自定义内容」两菜单合并为「内容管理」单页（双顶层树：自定义在上 / 系统自带在下），
 * 逻辑 100% 一致，仅 source（读写根与编辑门控）不同（详见 docs/.../EDM系统内容页改造与内容管理统一规划_v6.md §十一）。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 唯一来源 = 宿主注入的 manifest.id；深层组件经 provide/inject 取用，杜绝字面量重复
provideToolId(() => props.toolId ?? '')

const tab = computed(() => props.menu ?? 'mails')
const pages: Record<string, unknown> = {
  content: ContentManagePage,
  mails: MailsPage,
}
const active = computed(() => pages[tab.value] ?? MailsPage)

onMounted(() => {
  void ensureLoaded()
  subscribeUploadProgress()
})
</script>

<template>
  <ToolPageLayout title="EDM Studio" description="品牌 → 模板/片段（版本不可变）→ 邮件三阶段产物 → 导出与分享">
    <component :is="active" :menu="menu" />
    <UploadProgressToast />
  </ToolPageLayout>
</template>

<style scoped>
.muted { opacity: 0.6; font-size: 12px; }
</style>
