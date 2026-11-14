<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ToolPageLayout } from '@sshk/ui-kit'
import BrandsPage from './pages/BrandsPage.vue'
import TemplatesPage from './pages/TemplatesPage.vue'
import FragmentsPage from './pages/FragmentsPage.vue'
import MailsPage from './pages/MailsPage.vue'
import { ensureLoaded } from './state'

/**
 * EDM Studio 渲染层——页面壳：
 * 只负责接收宿主 menu 并分发到 pages/ 下各页面，业务全部在子页面与 state/shared。
 * 目录约定：renderer/<Id>Page.vue 壳（宿主只发现这一个文件）、pages/ 每菜单一页、
 * state.ts 共享集合、shared.ts 类型与底层调用。
 */
const props = defineProps<{ menu?: string }>()

const tab = computed(() => props.menu ?? 'brands')
const pages: Record<string, unknown> = { brands: BrandsPage, templates: TemplatesPage, fragments: FragmentsPage, mails: MailsPage }
const active = computed(() => pages[tab.value] ?? BrandsPage)

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
