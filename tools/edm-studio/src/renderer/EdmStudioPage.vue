<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ToolPageLayout } from '@sshk/ui-kit'
import LibraryPage from './pages/LibraryPage.vue'
import MailsPage from './pages/MailsPage.vue'
import SystemPage from './pages/SystemPage.vue'
import { ensureLoaded } from './state'

/**
 * EDM Studio 渲染层——页面壳：
 * 只负责接收宿主 menu 并分发到 pages/ 下各页面，业务全部在子页面与 state/shared。
 * 目录约定：renderer/<Id>Page.vue 壳（宿主只发现这一个文件）、pages/ 每菜单一页、
 * state.ts 共享集合、shared.ts 类型与底层调用。
 * R22：品牌/模板/片段三菜单合并为「自定义内容库」（旧 id 兼容映射到对应 tab）。
 */
const props = defineProps<{ menu?: string }>()

const tab = computed(() => props.menu ?? 'library')
const pages: Record<string, unknown> = {
  library: LibraryPage, brands: LibraryPage, templates: LibraryPage, fragments: LibraryPage,
  mails: MailsPage, system: SystemPage,
}
const active = computed(() => pages[tab.value] ?? LibraryPage)

onMounted(() => { void ensureLoaded() })
</script>

<template>
  <ToolPageLayout title="EDM Studio" description="品牌 → 模板/片段（版本不可变）→ 邮件三阶段产物 → 导出与分享">
    <component :is="active" :menu="menu" />
    <template #footer>
      <span class="muted">版本不可变（D8）· 覆盖式产物（D19）· 黑名单优先（D14）· 北京时间（D22）</span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.muted { opacity: 0.6; font-size: 12px; }
</style>
