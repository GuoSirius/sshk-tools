<script setup lang="ts">
/**
 * JSON 只读预览（plans/02 T1，两壳共用）：错误态红框 / 正常态等宽滚动块。
 * 清单编辑器预览落盘结果；创建向导预览 buildSkeletonFiles 产物。
 */
defineProps<{
  text: string
  error?: string
  title?: string
  hint?: string
}>()
</script>

<template>
  <div class="json-preview-pane">
    <div v-if="title" class="pane-title">{{ title }}</div>
    <div v-if="hint" class="pane-hint">{{ hint }}</div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <pre v-else class="preview-json">{{ text }}</pre>
  </div>
</template>

<style scoped>
.json-preview-pane { display: flex; flex-direction: column; min-height: 0; }
.pane-title { flex: none; font-size: 12px; font-weight: 600; opacity: .65; margin-bottom: 6px; }
.pane-hint { flex: none; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; margin-bottom: 8px; }
.error-box { padding: 8px 10px; border-radius: 6px; background: rgba(245, 108, 108, .08); color: var(--el-color-danger); font-size: 12px; line-height: 1.8; white-space: pre-wrap; }
.preview-json { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px; border-radius: 8px; background: var(--el-fill-color-light); font-size: 11px; line-height: 1.6; white-space: pre; }
</style>
