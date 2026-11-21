<script setup lang="ts">
import { computed } from 'vue'
import ChatPage from './pages/ChatPage.vue'
import ProvidersPage from './pages/ProvidersPage.vue'
import UsagePage from './pages/UsagePage.vue'
import { toolId } from './state'

/**
 * 模型管理渲染层壳（过渡保留，P4-8 三工具退役时删除）：
 * 入口 *Page.vue 只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面（与 share-manager 壳同一约定）。
 *
 * P4-5 迁即重构：Provider/对话/用量三页由 AppAdminPage 直引复用——
 * - 壳不再包 ToolPageLayout（避免「壳标题 + 应用管理页头」双层头部与双层留白，页面自管 padding）；
 * - 壳不再代订 llm.onDelta：旧实现在壳上订阅且卸载不退订（已知泄漏），根治为 ChatPage 页内
 *   自管订阅（挂载订阅 / 卸载退订）；初始化由页面 ensureLoaded() 幂等接管，壳只注入 toolId。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''

const tab = computed(() => props.menu ?? 'chat')
const pages: Record<string, unknown> = { chat: ChatPage, providers: ProvidersPage, usage: UsagePage }
const active = computed(() => pages[tab.value] ?? ChatPage)
</script>

<template>
  <component :is="active" :menu="menu" />
</template>
