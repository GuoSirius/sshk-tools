<script setup lang="ts">
/**
 * 文本编辑器弹框（P4-4 自 FileExplorerPage 拆出）：文件名 · 大小 统计信息置顶（用户 2026-11-18）。
 * 行为契约（与原页面逐字一致）：保存走父级 saveEditor（冲突检测 §四：远端已变化可覆盖保存）；
 * readonly 时禁保存；conflict 时 footer 显示可覆盖提示；主题跟随应用 themeMode。
 */
import { CodeEditor } from '@sshk/code-editor'
import { fsFormatSize } from '@sshk/shared'

export interface FsEditorState {
  open: boolean
  path: string
  name: string
  content: string
  readonly: boolean
  saving: boolean
  etag: string
  modified: number
  size: number
  conflict: boolean
}

defineProps<{
  editor: FsEditorState
  themeDark: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
}>()

const content = defineModel<string>('content', { required: true })
</script>

<template>
  <el-dialog :model-value="editor.open" width="900px" top="4vh" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-editor-dialog" @update:model-value="emit('close')">
    <template #header>
      <span class="fs-editor-title">{{ editor.name }}<span class="fs-editor-meta">{{ fsFormatSize(editor.size) }}</span></span>
    </template>
    <div class="fs-editor-body">
      <CodeEditor v-model="content" :path="editor.path" :readonly="editor.readonly" :height="'100%'" :dark="themeDark" :minimap="true" @save="!editor.readonly && !editor.saving && emit('save')" />
    </div>
    <template #footer>
      <span v-if="editor.conflict" class="fs-conflict-hint">远端已变化，可覆盖保存</span>
      <el-button @click="emit('close')">关闭</el-button>
      <el-button type="primary" :loading="editor.saving" :disabled="editor.readonly" @click="emit('save')">保存到远端</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fs-editor-body { height: 60vh; }
/* 编辑器标题行：文件名 · 大小（统计信息自 footer 移到顶部，用户 2026-11-18） */
.fs-editor-title { display: inline-flex; align-items: baseline; gap: 10px; font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.fs-editor-meta { font-size: 12px; font-weight: 400; opacity: .6; }
.fs-conflict-hint { color: var(--el-color-warning); font-size: 12px; margin-right: 12px; }
</style>
