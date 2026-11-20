<script setup lang="ts">
/**
 * Markdown 预览弹窗（用户需求 2026-11-20 #131 / #132 双视图）：把当前正文 HTML 转成 Markdown，
 * 可在「源码预览」（Monaco markdown 只读）与「渲染预览」（marked 渲染成 HTML）间切换。
 * 转换走包内 markdown.ts 的 htmlToMarkdown（turndown）；因 HTML→MD→HTML 往返不保真，
 * 故只读、不提供「应用回写」，仅查看/复制（与项目已确认的单向能力口径一致）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import { CodeEditor } from '@sshk/code-editor'
import { htmlToMarkdown, markdownToHtml } from '../markdown'
import { toDisplayHtml, toStoredHtml } from '../display'

const props = defineProps<{
  open: boolean
  editor: IDomEditor | null
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const text = ref('')
type ViewMode = 'source' | 'rendered'
const viewMode = ref<ViewMode>('source')
/** 渲染视图：MD→HTML 后走 toDisplayHtml 换显示协议（file://→localres://），避免 Chromium 拦 file:// 裂图；复制出去的 text 仍是存储契约 */
const renderedHtml = computed(() => toDisplayHtml(markdownToHtml(text.value)))

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
      <div class="md-toolbar">
        <div class="md-tip" title="由当前正文 HTML 转换（Turndown）；Markdown 是富文本子集，复杂表格/嵌套样式可能简化。仅供查看与复制，不回写编辑器。">由当前正文 HTML 转换；仅供查看与复制，不回写编辑器。</div>
        <el-radio-group v-model="viewMode" size="small" class="md-mode-switch">
          <el-radio-button value="source">源码预览</el-radio-button>
          <el-radio-button value="rendered">渲染预览</el-radio-button>
        </el-radio-group>
      </div>
      <div v-show="viewMode === 'source'" class="md-editor-panel">
        <div class="md-panel-title">Markdown 源码</div>
        <div class="md-editor-wrap">
          <CodeEditor v-model="text" language="markdown" height="100%" :readonly="true" />
        </div>
      </div>
      <div v-show="viewMode === 'rendered'" class="md-render-panel">
        <div class="md-panel-title">渲染效果</div>
        <div class="md-render-content" v-html="renderedHtml"></div>
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
.md-toolbar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.md-tip { flex: 1 1 auto; min-width: 0; font-size: 12px; opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.md-mode-switch { flex: none; white-space: nowrap; }
.md-render-panel {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px; padding: 10px;
}
.md-render-content {
  flex: 1 1 auto; min-height: 260px; overflow: auto; padding: 4px 8px 12px;
  font-size: 14px; line-height: 1.75; color: var(--el-text-color-primary, #1f2430);
  background: var(--el-bg-color, #fff);
}
/* v-html 内容不带 scoped 属性，必须用 :deep() */
.md-render-content :deep(h1), .md-render-content :deep(h2), .md-render-content :deep(h3) { margin: 16px 0 8px; line-height: 1.4; }
.md-render-content :deep(p) { margin: 8px 0; }
.md-render-content :deep(img) { max-width: 100%; height: auto; }
.md-render-content :deep(pre) { overflow: auto; background: var(--el-fill-color-light, #f5f6f8); padding: 12px; border-radius: 6px; }
.md-render-content :deep(code) { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px; }
.md-render-content :deep(blockquote) { border-left: 3px solid var(--el-color-primary, #409eff); margin: 8px 0; padding-left: 12px; color: var(--el-text-color-secondary, #666); }
.md-render-content :deep(table) { border-collapse: collapse; max-width: 100%; }
.md-render-content :deep(th), .md-render-content :deep(td) { border: 1px solid var(--el-border-color, #ddd); padding: 6px 10px; }
.md-render-content :deep(a) { color: var(--el-color-primary, #409eff); }
.md-render-content :deep(hr) { border: none; border-top: 1px solid var(--el-border-color, #ddd); margin: 16px 0; }
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
