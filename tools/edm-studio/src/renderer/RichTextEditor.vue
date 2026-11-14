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
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const editorRef = shallowRef<IDomEditor>()
const toolbarEl = ref<HTMLElement | null>(null)
const editorEl = ref<HTMLElement | null>(null)

const editorConfig: Partial<IEditorConfig> = {
  placeholder: '请输入内容…',
  readOnly: props.readonly,
  onChange(editor: IDomEditor) {
    emit('update:modelValue', editor.getHtml())
  },
}

onMounted(() => {
  if (!editorEl.value || !toolbarEl.value) return
  const editor = createEditor({
    selector: editorEl.value,
    html: props.modelValue || '',
    config: editorConfig,
    mode: 'default',
  })
  editorRef.value = editor
  createToolbar({
    editor,
    selector: toolbarEl.value,
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
  <div class="rich">
    <div ref="toolbarEl" class="rich-toolbar" />
    <div ref="editorEl" class="rich-editor" />
  </div>
</template>

<style scoped>
.rich {
  border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: var(--sshk-panel, #fff);
}
.rich-toolbar {
  border-bottom: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.3));
}
.rich-editor {
  min-height: 200px;
}

/* 深色主题：覆写 wangEditor 的 --w-e-* 变量，使编辑器融入深色界面（变量从 .rich 向下级联到工具栏/编辑区） */
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
</style>
