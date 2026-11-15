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
import type { RichTextImageRule, RichTextUploadHook } from '../types'

/**
 * 共享富文本编辑器（从 edm-studio 迁入，R27 B3）。
 * F1：直接用 @wangeditor/editor 的 createEditor/createToolbar —— @wangeditor/editor-for-vue
 *     的 latest 是 Vue2 包，与本项目 Vue3 不兼容，禁止引入。
 * F2：fullScreen() 要求 toolbar 与 textarea 父节点一致，故二者用【同一容器 selector】创建；
 *     全屏时用 Vue Teleport 把整个容器挂到 body（框架级移动，不破坏虚拟树），
 *     绝不手写 appendChild 移出 Vue 虚拟树（曾致编辑器凭空消失）。
 * C2：图片上传通过 onUploadImage 回调由工具侧注入，本包不依赖 upload-core。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    readonly?: boolean
    /** 工具侧注入；不传则隐藏上传菜单，降级为普通富文本 */
    onUploadImage?: RichTextUploadHook
    imageRule?: RichTextImageRule
  }>(),
  { modelValue: '', readonly: false, onUploadImage: undefined, imageRule: undefined },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const editorRef = shallowRef<IDomEditor>()
const containerEl = ref<HTMLElement | null>(null)
/**
 * 全屏层级（复核项 9）：wangEditor 的 fullScreen() 只给容器加
 * .w-e-full-screen-container（CSS 里 position:fixed 但**没有 z-index**），
 * 容器仍留在表单 / 侧栏的局部层叠上下文里，左侧菜单和同层表单会盖在它上面。
 * 这里监听 class 变化，全屏时用 Vue Teleport 把容器提升到 body 下
 * —— 框架级移动，不 appendChild、不破坏虚拟树，编辑器实例引用仍有效。
 */
const fullScreen = ref(false)
let classObserver: MutationObserver | null = null

interface UploadImageConf {
  customUpload: (file: File, insertFn: (url: string) => void) => Promise<void>
}

const hook = props.onUploadImage
const editorConfig: Partial<IEditorConfig> = {
  placeholder: '请输入内容…',
  readOnly: props.readonly,
  onChange(editor) {
    emit('update:modelValue', editor.getHtml())
  },
}
if (hook) {
  const maxSize = props.imageRule?.maxSize ?? 0
  const conf: Record<string, UploadImageConf> = {
    uploadImage: {
      customUpload: async (file, insertFn) => {
        if (maxSize > 0 && file.size > maxSize) throw new Error(`图片超过大小上限 ${maxSize} 字节`)
        insertFn(await hook(file))
      },
    },
  }
  editorConfig.MENU_CONF = conf
}
const toolbarConfig: Partial<IToolbarConfig> = hook ? {} : { excludeKeys: ['uploadImage', 'uploadVideo'] }

onMounted(() => {
  const el = containerEl.value
  if (!el) return
  const editor = createEditor({
    selector: el,
    html: props.modelValue || '',
    config: editorConfig,
    mode: 'default',
  })
  editorRef.value = editor
  createToolbar({ editor, selector: el, config: toolbarConfig, mode: 'default' })
  classObserver = new MutationObserver(() => {
    fullScreen.value = el.classList.contains('w-e-full-screen-container')
  })
  classObserver.observe(el, { attributes: true, attributeFilter: ['class'] })
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
  classObserver?.disconnect()
  classObserver = null
  editorRef.value?.destroy()
  editorRef.value = undefined
})
</script>

<template>
  <Teleport to="body" :disabled="!fullScreen">
    <div ref="containerEl" class="rich" />
  </Teleport>
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
.rich :deep(.w-e-toolbar) { order: 0; }
.rich :deep(.w-e-text-container) { order: 1; flex: 1; min-height: 200px; }

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

/* 全屏：容器经 Teleport 挂到 body 下，已脱离应用外壳的层叠上下文；
   再补满屏定位 + 顶格 z-index，杜绝左侧菜单 / 同层表单浮在编辑器上方 */
:global(.rich.w-e-full-screen-container) {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  z-index: 2147483647 !important;
  background-color: var(--w-e-toolbar-bg-color, #fff);
  border: 0;
  border-radius: 0;
}
</style>
