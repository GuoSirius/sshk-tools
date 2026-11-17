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
import { CodeEditor } from '@sshk/code-editor'
import { toDisplayHtml, toStoredHtml } from '../display'
import { compactHtml, formatHtml } from '../source-format'

const props = defineProps<{
  open: boolean
  editor: IDomEditor | null
  readonly?: boolean
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const text = ref('')
const dirty = ref(false)
const formatting = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    const stored = props.editor ? toStoredHtml(props.editor.getHtml()) : ''
    // 默认格式化展示（wangEditor getHtml 返回压缩串）：只影响弹窗文本，不写回编辑器
    formatting.value = true
    text.value = await formatHtml(stored)
    formatting.value = false
    dirty.value = false
  },
)

function markDirty(): void {
  dirty.value = true
}

async function doFormat(): Promise<void> {
  formatting.value = true
  text.value = await formatHtml(text.value)
  formatting.value = false
  markDirty()
}

function doCompact(): void {
  text.value = compactHtml(text.value)
  markDirty()
}

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

</script>

<template>
  <el-dialog
    :model-value="open"
    class="source-view-dialog"
    title="查看源码"
    width="820px"
    top="6vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="src-body">
      <div class="src-tip">
        存储形态 HTML（图片为 file:// 资源路径）。{{ readonly ? '只读内容，仅可查看与复制。' : '默认格式化展示；可直接修改，或格式化/压缩后「应用修改」写回编辑器。' }}
      </div>
      <!-- 与 badge-studio 同款：编辑器包在带标题的卡片面板中，高度跟随弹框剩余空间 -->
      <div class="src-editor-panel">
        <div class="src-panel-title">HTML 源码</div>
        <div class="src-editor-wrap">
          <CodeEditor
            v-model="text"
            language="html"
            height="100%"
            :readonly="readonly"
            @update:model-value="markDirty"
          />
          <!-- 说明：编辑器高度由 .src-editor-wrap 绝对定位填满，见下方样式 -->
        </div>
      </div>
      <!-- 操作栏放 body 内底部、flex-shrink:0 固定：不依赖 dialog #footer，避免弹框 flex 高度布局下被挤出 -->
      <div class="src-footer">
        <div class="src-footer-group">
          <el-button size="small" :loading="formatting" :disabled="readonly" @click="doFormat">格式化</el-button>
          <el-button size="small" :disabled="readonly" @click="doCompact">压缩</el-button>
        </div>
        <div class="src-footer-group">
          <el-button @click="copy">复制源码</el-button>
          <el-button v-if="!readonly" type="primary" :disabled="!dirty" @click="apply">应用修改</el-button>
          <el-button @click="close">关闭</el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* 与图片库同口径：整个弹框占视口 75%，header 固定，body 吃满剩余；编辑器填满 body 剩余、操作栏固定在底部 */
:global(.source-view-dialog) {
  height: 75vh;
  min-height: 460px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.source-view-dialog .el-dialog__header) { flex: 0 0 auto; }
:global(.source-view-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 全局口径（2026-11-17）：body 左右/下归零，弹框本体 16px 侧内缩是唯一内缩层 */
  padding: 0 !important;
}
.src-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 12px; }
.src-tip { flex: 0 0 auto; font-size: 12px; opacity: 0.65; margin-bottom: 8px; }
.src-footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.src-footer-group { display: flex; align-items: center; gap: 8px; }
.src-editor-panel {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px; padding: 10px;
}
.src-panel-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
/* Monaco 的 height:100% 在 flex 链里算不出具体高度会坍塌；用相对/绝对定位给它确定尺寸 */
.src-editor-wrap { flex: 1 1 auto; min-height: 260px; position: relative; }
.src-editor-wrap > :deep(.code-editor) { position: absolute; inset: 0; height: 100% !important; }
</style>
