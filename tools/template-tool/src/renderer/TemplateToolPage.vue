<script setup lang="ts">
import { computed } from 'vue'
import { ToolPageLayout } from '@sshk/ui-kit'
import HomePage from './pages/HomePage.vue'
import ConfigPage from './pages/ConfigPage.vue'
import { toolId } from './state'

/**
 * 模板工具渲染层（builtin 契约）——页面壳：
 * 只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面，业务全部在子页面。
 *
 * 目录约定（适用于所有内建工具）：
 *   src/renderer/<Id>Page.vue   壳：menu 分发 + ToolPageLayout（宿主只发现这一个文件）
 *   src/renderer/pages/         每个菜单一个页面组件
 *   src/renderer/components/    私有子组件
 *   src/renderer/state.ts       共享状态/通道调用（单例）
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''

const tab = computed(() => props.menu ?? 'home')
const pages: Record<string, unknown> = { home: HomePage, config: ConfigPage }
const active = computed(() => pages[tab.value] ?? HomePage)
</script>

<template>
  <ToolPageLayout :title="tab === 'config' ? '工具配置' : '能力演示'">
    <component :is="active" :menu="menu" :tool-id="toolId" />
  </ToolPageLayout>
</template>
