<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 工具与权限（P4-2 过渡版）：页头 + 直引 ToolsTab 原样渲染，Props 不变。
 * create-tool 事件逐层上抛给壳层 CreateToolWizard（P4-3 后入口留在本页原地）。
 */
import ToolsTab from '../../../components/settings/ToolsTab.vue'

const emit = defineEmits<{ 'create-tool': [] }>()
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>工具与权限</strong>
      <span class="muted" style="margin-left: 12px">启用禁用、访问密钥、分发白名单、卡片信息</span>
    </div>
    <div class="admin-subpage-body">
      <ToolsTab @create-tool="emit('create-tool')" />
    </div>
  </div>
</template>

<style scoped>
.admin-subpage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.admin-subpage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sshk-page-padding);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
