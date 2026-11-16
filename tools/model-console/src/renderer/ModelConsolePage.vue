<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ToolPageLayout } from '@sshk/ui-kit'
import ChatPage from './pages/ChatPage.vue'
import ProvidersPage from './pages/ProvidersPage.vue'
import UsagePage from './pages/UsagePage.vue'
import { toolId, load, appendDelta } from './state'

/**
 * 模型控制台渲染层——页面壳：
 * 只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面，业务全部在子页面与 state。
 *
 * onDelta（流式分片）注册在壳上而非 ChatPage：切到 Provider 页时 ChatPage 被卸载，
 * 壳持续把分片追加进 messages 单例，切回对话页内容完整（滚动由 ChatPage 的 watch 处理）。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''

const tab = computed(() => props.menu ?? 'chat')
const pages: Record<string, unknown> = { chat: ChatPage, providers: ProvidersPage, usage: UsagePage }
const active = computed(() => pages[tab.value] ?? ChatPage)

onMounted(() => {
  void load()
  // 流式分片：交给 state.appendDelta（D-V3-2 打字平滑开关裁决入队或直追加）
  // 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
  // eslint-disable-next-line no-restricted-syntax
  window.api.llm.onDelta((delta) => appendDelta(delta))
})
</script>

<template>
  <ToolPageLayout
    title="模型控制台"
    description="内置常用模型预设，填一个 Key 即可使用；模型名可下拉选择（真实查询 /models）；apiKey 单独加密存储"
  >
    <component :is="active" :menu="menu" />
    <template #footer>
      <span class="panel-title">apiKey 单独加密存储（safeStorage）· 测试与试聊走 llm 网关</span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.panel-title { font-size: 12px; opacity: .7; }
</style>
