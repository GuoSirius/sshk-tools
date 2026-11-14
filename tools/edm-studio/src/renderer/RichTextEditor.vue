<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  createEditor,
  createToolbar,
  type IDomEditor,
  type IEditorConfig,
  type IToolbarConfig,
} from '@wangeditor/editor'

/**
 * 富文本编辑器（R15 richtext）：直接用 wangEditor core 的 createEditor / createToolbar 接入，
 * 绕开 @wangeditor/editor-for-vue（其 latest 是 Vue2 包，与本项目的 Vue3 不兼容）。
 * v-model 走 modelValue / update:modelValue；只读态动态 disable。
 *
 * 全屏适配（修复「点全屏无反应 / 报错」）：
 *  - wangEditor 的 fullScreen() 要求「toolbar 与 textarea 的父节点一致」，否则抛
 *    "不能设置全屏，因为 toolbar DOM 父节点和 textarea DOM 父节点不一致"。
 *    故 toolbar 与编辑器用【同一容器 selector】创建，二者父节点一致，全屏校验通过。
 *  - wangEditor 给容器加 .w-e-full-screen-container（position:fixed 但无 z-index），
 *    用 CSS 补 z-index 使其压过应用外壳；不手动搬移 DOM 节点（会破坏 Vue 虚拟 DOM 导致编辑器丢失）。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const editorRef = shallowRef<IDomEditor>()
const containerEl = ref<HTMLElement | null>(null)

const editorConfig: Partial<IEditorConfig> = {
  placeholder: '请输入内容…',
  readOnly: props.readonly,
  onChange(editor: IDomEditor) {
    emit('update:modelValue', editor.getHtml())
  },
}

onMounted(() => {
  if (!containerEl.value) return
  // toolbar 与编辑器共用同一容器 selector：二者父节点一致，fullScreen 校验通过
  const editor = createEditor({
    selector: containerEl.value,
    html: props.modelValue || '',
    config: editorConfig,
    mode: 'default',
  })
  editorRef.value = editor
  createToolbar({
    editor,
    selector: containerEl.value,
    config: {} as Partial<IToolbarConfig>,
    mode: 'default',
  })
})

// 外部值变化（切换表单/数据、回填）同步进编辑器，避免与当前内容死循环
watch(
  () => props.modelValue,
  (v) => {
    const editor = editorRef.value
    if (editor && v !== editor.getHtml()) editor.setHtml(v ?? '')
  },
)

watch(
  () => props.readonly,
  (ro) => {
    const editor = editorRef.value
    if (!editor) return
    if (ro) editor.disable()
    else editor.enable()
  },
)

onBeforeUnmount(() => {
  editorRef.value?.destroy()
  editorRef.value = undefined
})
</script>

<template>
  <div ref="containerEl" class="rich" />
</template>

<style scoped>
.rich {
  display: flex;
  flex-direction: column;
  min-height: 240px;
  border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: var(--sshk-panel, #fff);
}
/* toolbar 在文本区之上（用 order 兜底，避免 wangEditor 插入顺序差异） */
.rich :deep(.w-e-toolbar) { order: 0; }
.rich :deep(.w-e-text-container) { order: 1; flex: 1; min-height: 200px; }

/* 深色主题：覆写 wangEditor 的 --w-e-* 变量，使编辑器融入深色界面（变量从 .rich 向下级联） */
:global(html.dark) .rich {
  border-color: #333;
  background: #181818;
  --w-e-toolbar-bg-color: #1f1f1f;
  --w-e-toolbar-color: #d4d4d4;
  --w-e-toolbar-active-bg-color: #333;
  --w-e-toolbar-border-color: #333;
  --w-e-textarea-bg-color: #181818;
  --w-e-textarea-color: #e5e5e5;
  --w-e-textarea-border-color: #333;
  --w-e-textarea-sight-bg-color: #2a2a2a;
  --w-e-selection-bg-color: rgba(64, 158, 255, 0.25);
  --w-e-border-color: #333;
  --w-e-modal-bg-color: #1f1f1f;
  --w-e-modal-color: #d4d4d4;
  --w-e-modal-button-bg-color: #2a2a2a;
  --w-e-modal-button-border-color: #444;
}

/* 全屏：wangEditor 只给 position:fixed（无 z-index），补 z-index 压过应用外壳 */
.rich.w-e-full-screen-container {
  z-index: 9999 !important;
  background-color: var(--w-e-toolbar-bg-color);
}
</style>
