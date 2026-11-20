<script setup lang="ts">
import { computed } from 'vue'
import { provideToolId } from '@sshk/ui-kit'
import FileExplorerPage from './pages/FileExplorerPage.vue'
import ProfilesPage from './pages/ProfilesPage.vue'
import ContentsPage from './pages/ContentsPage.vue'

/**
 * file-manager（文件管理，原上传管理 upload-manager / 上传配置 upload-config）渲染层壳（与 badge-studio 同一约定）：
 * 入口 *Page.vue 只负责接收宿主 menu/toolId 并分发到 pages/ 下各菜单页面；
 * pages/ 子目录的 *Page.vue 不会被 discovery 的单层 glob 命中，避免多入口互相顶替。
 * 「工具配置」菜单由宿主 ToolSettingsPage 接管，不进本组件。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// 工具 id 单一来源（#129 铁律）：宿主注入 → provide，深层 useToolId() inject，禁字面量
provideToolId(() => props.toolId ?? '')
const pages: Record<string, unknown> = { files: FileExplorerPage, profiles: ProfilesPage, contents: ContentsPage }
const active = computed(() => pages[props.menu ?? 'files'] ?? FileExplorerPage)
</script>

<template>
  <component :is="active" />
</template>
