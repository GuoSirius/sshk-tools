<script setup lang="ts">
/**
 * JSON 只读预览（plans/02 T1，两壳共用）。
 * 校验失败不顶掉预览内容：保留最近一次可生成的结果继续可看，错误以轻提示条展示在顶部，
 * 内容为空时显示占位说明（用户反馈 2026-11-16：异常信息进表单行内，别把预览区搞坏）。
 * 清单编辑器预览落盘结果；创建向导预览 buildSkeletonFiles 产物。
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  text: string
  error?: string
  title?: string
  hint?: string
}>()

/** 最近一次无错误时的可展示文本：出错时兜底显示，预览区永远可读 */
const lastGood = ref('')
watch(
  () => [props.text, props.error] as const,
  ([text, err]) => {
    if (!err && text) lastGood.value = text
  },
  { immediate: true },
)

const shown = (): string => props.text || lastGood.value
</script>

<template>
  <div class="json-preview-pane">
    <div v-if="title" class="pane-title">{{ title }}</div>
    <div v-if="hint" class="pane-hint">{{ hint }}</div>
    <div v-if="error" class="error-note">⚠ {{ error }}（修正后自动更新）</div>
    <pre v-if="shown()" class="preview-json">{{ shown() }}</pre>
    <div v-else class="preview-empty">完成必填项后，此处实时生成 tool.manifest.json</div>
  </div>
</template>

<style scoped>
.json-preview-pane { display: flex; flex-direction: column; min-height: 0; }
.pane-title { flex: none; font-size: 12px; font-weight: 600; opacity: .65; margin-bottom: 6px; }
.pane-hint { flex: none; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; margin-bottom: 8px; }
.error-note { flex: none; padding: 5px 8px; margin-bottom: 6px; border-radius: 6px; background: var(--el-color-danger-light-9, rgba(245, 108, 108, .08)); color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }
.preview-json { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px; border-radius: 8px; background: var(--el-fill-color-light); font-size: 11px; line-height: 1.6; white-space: pre; }
.preview-empty { flex: 1; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--el-border-color); border-radius: 8px; color: var(--el-text-color-placeholder); font-size: 12px; padding: 16px; text-align: center; line-height: 1.7; }
</style>
