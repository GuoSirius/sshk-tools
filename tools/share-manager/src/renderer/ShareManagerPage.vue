<script setup lang="ts">
import { computed } from 'vue'
import RoutesPage from './pages/RoutesPage.vue'
import LogsPage from './pages/LogsPage.vue'
import ServicePage from './pages/ServicePage.vue'
import MountsPage from './pages/MountsPage.vue'
import ProxiesPage from './pages/ProxiesPage.vue'

/**
 * share-manager（分享管理）渲染层壳（与 file-manager 同一约定）：
 * 入口 *Page.vue 只负责接收宿主 menu/toolId 并分发到 pages/ 下各菜单页面；
 * pages/ 子目录的 *Page.vue 不会被 discovery 的单层 glob 命中。
 * 服务配置/挂载/代理以菜单页承载（框架 configPages 仅支持声明式表单，自定义 UI 走菜单页，file-manager profiles 先例）。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
const pages: Record<string, unknown> = { routes: RoutesPage, logs: LogsPage, service: ServicePage, mounts: MountsPage, proxies: ProxiesPage }
const active = computed(() => pages[props.menu ?? 'routes'] ?? RoutesPage)
</script>

<template>
  <component :is="active" />
</template>
