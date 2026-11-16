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
import { toDisplayHtml, toStoredHtml } from '../display'

/**
 * 共享富文本编辑器（从 edm-studio 迁入，R27 B3）。
 * F1：直接用 @wangeditor/editor 的 createEditor/createToolbar —— @wangeditor/editor-for-vue
 *     的 latest 是 Vue2 包，与本项目 Vue3 不兼容，禁止引入。
 * F2：fullScreen() 要求 toolbar 与 textarea 父节点一致，故二者用【同一 selector】创建。
 * C2：图片上传通过 onUploadImage 回调由工具侧注入，本包不依赖 upload-core。
 *
 * N12 二次根治（依据 @wangeditor/core@1.1.19 实际实现，勿凭印象改）：
 *   fullScreen()   → getTextarea(editor).$box.parent().addClass('w-e-full-screen-container')
 *                    → emit('fullScreen')
 *   unFullScreen() → setTimeout 200ms → 再取一次 $box.parent().removeClass(...)
 *                    → emit('unFullScreen')
 *   $box 就是 createEditor 传入的 selector 元素本身。也就是说：
 *   ① 全屏 class 落在 selector 的【父节点】，不是我们自己这层；
 *   ② 退出时它按【当时的】父子关系重新找节点，若期间把 selector 单独 Teleport 走，
 *      class 会留在旧父节点上永远摘不掉，页面被一个空的 fixed 容器永久盖住。
 *   前两版分别踩了「class 落点猜错」和「只移动 selector 层」两个坑。
 *
 * 本版做法：刻意加一层 .rich-inner 作为 selector，使 $box.parent() 恒等于 .rich。
 *   - 全屏 class 与自有 .is-fullscreen 落在【同一个节点】，样式必定命中；
 *   - Teleport 移动的是 .rich，class 随之一起走，父子关系不变；
 *   - unFullScreen 延时里重新取 $box.parent() 仍是 .rich，能正确摘掉 class。
 * 另外 wangEditor 自带 CSS 只有 position:fixed，没有 z-index 与不透明背景，
 * 必须补上，否则左侧菜单 / 表单会从下面透出来。
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
/** 传给 createEditor / createToolbar 的 selector：必须是 .rich 的直接子节点 */
const editorBoxEl = ref<HTMLElement | null>(null)
/** 全屏时 Teleport 到 body 的整块容器，也是 wangEditor 加 class 的节点 */
const richEl = ref<HTMLElement | null>(null)
const fullScreen = ref(false)
let classObserver: MutationObserver | null = null
let detachEvents: (() => void) | null = null

interface UploadImageConf {
  customUpload: (file: File, insertFn: (url: string) => void) => Promise<void>
}

const hook = props.onUploadImage
const editorConfig: Partial<IEditorConfig> = {
  placeholder: '请输入内容…',
  readOnly: props.readonly,
  onChange(editor) {
    // 回写存储前转回 file://（编辑器内显示用 localres://，见 display.ts）
    emit('update:modelValue', toStoredHtml(editor.getHtml()))
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
/**
 * 全量工具栏（用户反馈 2026-11-16：默认配置把删除线/行内代码/上下标/清除格式/对齐/缩进
 * 折叠进「…」下拉组，窄容器下折行后看着像「最小菜单」且凌乱）——全部展开平铺，按功能分组加分隔条。
 * keys 均已对照 @wangeditor/editor 5.1.23 源码核实注册（拼错会抛 Not found menu item factory）；
 * 图片/视频保留下拉组（平铺 6 个按钮反而更乱），无上传钩子时剔除 upload 菜单降级为 URL 直填。
 */
function buildToolbarKeys(hasUpload: boolean): NonNullable<IToolbarConfig['toolbarKeys']> {
  return [
    'headerSelect', 'blockquote', '|',
    'bold', 'underline', 'italic', 'through', 'code', 'sup', 'sub', 'clearStyle', '|',
    'color', 'bgColor', '|',
    'fontSize', 'fontFamily', 'lineHeight', '|',
    'bulletedList', 'numberedList', 'todo', '|',
    'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyJustify', '|',
    'indent', 'delIndent', '|',
    'emotion', 'insertLink', '|',
    { key: 'group-image', title: '图片', menuKeys: hasUpload ? ['insertImage', 'uploadImage', 'editImage'] : ['insertImage'] },
    { key: 'group-video', title: '视频', menuKeys: hasUpload ? ['insertVideo', 'uploadVideo'] : ['insertVideo'] },
    'insertTable', '|',
    'codeBlock', 'divider', '|',
    'undo', 'redo', '|',
    'fullScreen',
  ]
}
const toolbarConfig: Partial<IToolbarConfig> = { toolbarKeys: buildToolbarKeys(Boolean(hook)) }

onMounted(() => {
  const box = editorBoxEl.value
  const rich = richEl.value
  if (!box || !rich) return
  const editor = createEditor({
    selector: box,
    html: toDisplayHtml(props.modelValue || ''),
    config: editorConfig,
    mode: 'default',
  })
  editorRef.value = editor
  createToolbar({ editor, selector: box, config: toolbarConfig, mode: 'default' })

  // 主链路：wangEditor 自带生命周期事件（core 内部 hoverbar 也监听这两个事件）。
  // 退出时 unFullScreen 先移除 class 再 emit，200ms 延时已走完，无需额外等待。
  const onEnter = (): void => { fullScreen.value = true }
  const onLeave = (): void => { fullScreen.value = false }
  editor.on('fullScreen', onEnter)
  editor.on('unFullScreen', onLeave)
  detachEvents = () => {
    editor.off('fullScreen', onEnter)
    editor.off('unFullScreen', onLeave)
  }

  // 兜底：只负责「补 true」，绝不改回 false —— 防止 class 变化与事件时序竞争导致抖动。
  // 退出一律交给 unFullScreen 事件，避免 200ms 延时里被 observer 提前抢跑。
  classObserver = new MutationObserver(() => {
    if (rich.classList.contains('w-e-full-screen-container')) fullScreen.value = true
  })
  classObserver.observe(rich, { attributes: true, attributeFilter: ['class'] })
})

// 外部值变化（切换表单/数据、回填）同步进编辑器，避免与当前内容死循环。
// 比较与回填都要经过显示层转换（编辑器内部持有 localres:// 形态，存储是 file://）
watch(
  () => props.modelValue,
  (v) => {
    const editor = editorRef.value
    if (editor && v !== toStoredHtml(editor.getHtml())) editor.setHtml(toDisplayHtml(v ?? ''))
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
  detachEvents?.()
  detachEvents = null
  editorRef.value?.destroy()
  editorRef.value = undefined
})
</script>

<template>
  <Teleport to="body" :disabled="!fullScreen">
    <div ref="richEl" class="rich" :class="{ 'is-fullscreen': fullScreen }">
      <div ref="editorBoxEl" class="rich-inner" />
    </div>
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
.rich-inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.rich-inner :deep(.w-e-toolbar) { order: 0; flex: 0 0 auto; }
.rich-inner :deep(.w-e-text-container) { order: 1; flex: 1 1 auto; min-height: 200px; }

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

/**
 * 弹层与下拉的暗色补丁（用户反馈 2026-11-16：codeBlock 查看源码 textarea 白底看不清、
 * 「选择语言」下拉 hover 配色错乱）。选择列表/弹层可能挂载到 .rich 作用域之外，
 * 故不能用 .rich 前缀的作用域变量兜底，必须在 html.dark 下全局显式配色。
 */
:global(html.dark) .w-e-modal {
  background-color: #1f1f1f;
  color: #d4d4d4;
  border-color: #333;
}
:global(html.dark) .w-e-modal textarea,
:global(html.dark) .w-e-modal input[type='text'],
:global(html.dark) .w-e-modal input[type='number'],
:global(html.dark) .w-e-modal select {
  background-color: #181818;
  color: #d4d4d4;
  border-color: #444;
}
:global(html.dark) .w-e-modal button {
  background-color: #2a2a2a;
  border-color: #444;
  color: #d4d4d4;
}
:global(html.dark) .w-e-select-list {
  background-color: #1f1f1f;
  border-color: #333;
  color: #d4d4d4;
}
:global(html.dark) .w-e-select-list li { color: #d4d4d4; }
:global(html.dark) .w-e-select-list li:hover,
:global(html.dark) .w-e-select-list li.selected {
  background-color: #333;
  color: #e5e5e5;
}

/**
 * 全屏（N12）：.rich 同时带自有 .is-fullscreen 与 wangEditor 的
 * w-e-full-screen-container，Teleport 到 body 后脱离所有局部层叠上下文。
 * 后者自带 CSS 只有 position:fixed 且背景透明，必须补 z-index 与不透明底色，
 * 否则会出现「工具栏铺满但页面表单从下面透出来」。
 */
:global(.rich.is-fullscreen) {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  z-index: 2147483647 !important;
  background-color: #fff !important;
  border: 0 !important;
  border-radius: 0 !important;
}
:global(.w-e-full-screen-container) {
  z-index: 2147483647 !important;
  background-color: #fff !important;
}
:global(html.dark .rich.is-fullscreen),
:global(html.dark .w-e-full-screen-container) {
  background-color: #181818 !important;
}
/* 全屏时编辑区撑满剩余高度，工具栏固定在顶部 */
:global(.rich.is-fullscreen .rich-inner) { flex: 1 1 auto !important; min-height: 0 !important; }
:global(.rich.is-fullscreen .w-e-text-container) { flex: 1 1 auto !important; min-height: 0 !important; }
:global(.rich.is-fullscreen .w-e-toolbar) { flex: 0 0 auto !important; }
</style>
