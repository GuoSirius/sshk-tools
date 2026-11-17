<script setup lang="ts">
import { computed } from 'vue'
import FileExplorerPage from './pages/FileExplorerPage.vue'
import ProfilesPage from './pages/ProfilesPage.vue'

/**
 * upload-config 渲染层壳（与 badge-studio 同一约定）：
 * 入口 *Page.vue 只负责接收宿主 menu/toolId 并分发到 pages/ 下各菜单页面；
 * pages/ 子目录的 *Page.vue 不会被 discovery 的单层 glob 命中，避免多入口互相顶替。
 * 「工具配置」菜单由宿主 ToolSettingsPage 接管，不进本组件。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
const pages: Record<string, unknown> = { files: FileExplorerPage, profiles: ProfilesPage }
const active = computed(() => pages[props.menu ?? 'files'] ?? FileExplorerPage)
</script>

<template>
  <component :is="active" />
</template>
