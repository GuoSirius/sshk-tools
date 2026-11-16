<script setup lang="ts">
/**
 * 源码查看弹窗（用户需求 2026-11-16 ③）：
 * - 展示存储形态 HTML（file:// 形态，与回写存储一致，非编辑器内的 localres 预览形态）
 * - 可编辑，「应用」经 setHtml 写回（setHtml 官方 API 自带焦点/选区恢复处理）
 * - 只读编辑器只展示，不给「应用」按钮
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import { toDisplayHtml, toStoredHtml } from '../display'

const props = defineProps<{
  open: boolean
  editor: IDomEditor | null
  readonly?: boolean
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const text = ref('')
const dirty = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    text.value = props.editor ? toStoredHtml(props.editor.getHtml()) : ''
    dirty.value = false
  },
)

function close(): void {
  emit('update:open', false)
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    ElMessage.success('源码已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败：请手动全选复制')
  }
}

function apply(): void {
  const editor = props.editor
  if (!editor || props.readonly) return
  editor.setHtml(toDisplayHtml(text.value))
  close()
  ElMessage.success('已应用源码修改')
}

function onInput(): void {
  dirty.value = true
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="查看源码"
    width="760px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="src-tip">
      存储形态 HTML（图片为 file:// 资源路径）。{{ readonly ? '只读内容，仅可查看与复制。' : '可直接修改后「应用」写回编辑器。' }}
    </div>
    <el-input
      v-model="text"
      type="textarea"
      :rows="18"
      :readonly="readonly"
      class="src-area"
      spellcheck="false"
      @input="onInput"
    />
    <template #footer>
      <el-button @click="copy">复制源码</el-button>
      <el-button v-if="!readonly" type="primary" :disabled="!dirty" @click="apply">应用修改</el-button>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.src-tip { font-size: 12px; opacity: 0.65; margin-bottom: 8px; }
.src-area :deep(textarea) { font-family: Consolas, 'Courier New', monospace; font-size: 12px; line-height: 1.6; }
</style>
