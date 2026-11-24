<script setup lang="ts">
import { CodeEditor } from '@sshk/code-editor'

/**
 * AI 润色预览弹框（EDM SampleForm 与表单设计 FormsManagePage 共用唯一实现，2026-11-24 收敛）：
 * 润色前/后 HTML 并排只读展示，接受才写回、放弃零改动。
 */
withDefaults(defineProps<{ open: boolean; label?: string; before: string; after: string }>(), { label: '' })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'accept'): void }>()
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="`AI 润色预览 · ${label}（接受才写回）`"
    width="720px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="diff-grid">
      <div>
        <div class="diff-cap">润色前</div>
        <CodeEditor :model-value="before" language="html" height="240px" readonly />
      </div>
      <div>
        <div class="diff-cap">润色后</div>
        <CodeEditor :model-value="after" language="html" height="240px" readonly />
      </div>
    </div>
    <template #footer>
      <el-button size="small" @click="emit('update:open', false)">放弃</el-button>
      <el-button size="small" type="primary" @click="emit('accept')">接受并写回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.diff-cap { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
</style>
