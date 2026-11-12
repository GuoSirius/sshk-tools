<script setup lang="ts">
/** 工具页三段式布局（数据契约 §6）：顶部操作 flex:none / 中间唯一滚动 flex:1 / 底部分页 flex:none */
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <div class="tool-page-layout">
    <div class="tool-page-head">
      <strong v-if="title">{{ title }}</strong>
      <span v-if="description" class="muted">{{ description }}</span>
      <span class="app-spacer" />
      <!-- 顶部操作区：新增 / 批量按钮等 -->
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
