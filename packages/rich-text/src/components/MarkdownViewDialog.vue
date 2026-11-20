<script setup lang="ts">
/**
 * Markdown 预览弹窗（用户需求 2026-11-20 #131）：把当前正文 HTML 转成 Markdown 只读展示 + 复制。
 * 转换走包内 markdown.ts 的 htmlToMarkdown（turndown）；因 HTML→MD→HTML 往返不保真，
 * 故只读、不提供「应用回写」，仅查看/复制（与项目已确认的单向能力口径一致）。
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import { CodeEditor } from '@sshk/code-editor'
import { htmlToMarkdown } from '../markdown'
import { toStoredHtml } from '../display'

const props = defineProps<{
  open: boolean
  editor: IDomEditor | null
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const text = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const stored = props.editor ? toStoredHtml(props.editor.getHtml()) : ''
    text.value = htmlToMarkdown(stored)
  },
)

function close(): void {
  emit('update:open', false)
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    ElMessage.success('Markdown 已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败：请手动全选复制')
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    class="markdown-view-dialog"
    title="Markdown 预览"
    width="820px"
    top="6vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="md-body">
      <div class="md-tip">由当前正文 HTML 转换（Turndown）；Markdown 是富文本子集，复杂表格/嵌套样式可能简化。仅供查看与复制，不回写编辑器。</div>
      <div class="md-editor-panel">
        <div class="md-panel-title">Markdown</div>
        <div class="md-editor-wrap">
          <CodeEditor v-model="text" language="markdown" height="100%" :readonly="true" />
        </div>
      </div>
      <div class="md-footer">
        <el-button @click="copy">复制 Markdown</el-button>
        <el-button @click="close">关闭</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
:global(.markdown-view-dialog) {
  height: 75vh;
  min-height: 460px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.markdown-view-dialog .el-dialog__header) { flex: 0 0 auto; }
:global(.markdown-view-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 !important;
}
.md-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 12px; }
.md-tip { flex: 0 0 auto; font-size: 12px; opacity: 0.65; margin-bottom: 8px; }
.md-footer { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.md-editor-panel {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px; padding: 10px;
}
.md-panel-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
.md-editor-wrap { flex: 1 1 auto; min-height: 260px; position: relative; }
.md-editor-wrap > :deep(.code-editor) { position: absolute; inset: 0; height: 100% !important; }
</style>
