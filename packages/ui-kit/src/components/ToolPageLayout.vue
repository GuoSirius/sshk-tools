<script setup lang="ts">
/** 工具页三段式布局（数据契约 §6）：顶部操作 flex:none / 中间唯一滚动 flex:1 / 底部分页 flex:none */
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <div class="tool-page-layout">
    <!-- 页面标题/描述与侧栏工具名重复，统一只保留侧栏；head 仅承载右侧操作区 -->
    <div class="tool-page-head">
      <span class="app-spacer" />
      <div class="tool-page-actions">
        <slot name="actions" />
      </div>
    </div>

    <div class="tool-page-body">
      <slot />
    </div>

    <div class="tool-page-foot muted">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.tool-page-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-page-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}
.tool-page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.tool-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.tool-page-foot {
  flex: none;
  font-size: 12px;
}
.muted {
  opacity: 0.65;
}
</style>
