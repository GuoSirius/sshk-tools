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
import type {
  RichTextImageLibrary,
  RichTextImageRule,
  RichTextUploadHook,
} from '../types'
import { toDisplayHtml, toStoredHtml } from '../display'
import {
  DEFAULT_GROUP_IMAGE_INDEX,
  IMAGE_LIBRARY_MENU_KEY,
  bindImageLibrary,
  registerImageLibraryMenu,
  unbindImageLibrary,
} from '../image-library-menu'
import ImageLibraryDialog from './ImageLibraryDialog.vue'

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
 *
 * 工具栏（用户反馈 2026-11-16）：
 *   - 取消上一版的自定义 toolbarKeys 平铺分组，恢复 wangEditor 原始默认分组顺序；
 *     仅当无上传钩子时 excludeKeys 剔除 uploadImage / uploadVideo（缺钩子的上传菜单
 *     只会走默认 ajax 上传，必失败）；有图片库时用 insertKeys 在默认 group-image 前
 *     插入「图片库」菜单，其余不动。
 *   - 图片库弹窗（用户需求 ④⑤）：本地/远程/云来源 + 桶/目录专属项 + 上传 + 列图插入。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    readonly?: boolean
    /** 工具侧注入；不传则隐藏上传菜单，降级为普通富文本 */
    onUploadImage?: RichTextUploadHook
    imageRule?: RichTextImageRule
    /** 图片库桥接（来源/上传/列图）；不传则不显示「图片库」菜单 */
    imageLibrary?: RichTextImageLibrary
  }>(),
  {
    modelValue: '',
    readonly: false,
    onUploadImage: undefined,
    imageRule: undefined,
    imageLibrary: undefined,
  },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const editorRef = shallowRef<IDomEditor>()
/** 传给 createEditor / createToolbar 的 selector：必须是 .rich 的直接子节点 */
const editorBoxEl = ref<HTMLElement | null>(null)
/** 全屏时 Teleport 到 body 的整块容器，也是 wangEditor 加 class 的节点 */
const richEl = ref<HTMLElement | null>(null)
const fullScreen = ref(false)
const libraryOpen = ref(false)
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
 * 工具栏：以 wangEditor 默认 toolbarKeys 为基线（用户拍板：保持原始默认分组顺序）。
 * - 无上传钩子：剔除 uploadImage / uploadVideo，其余默认项原样保留；
 * - 有图片库：insertKeys 在默认 group-image（下标 22，对照 5.1.23 默认数组核实）前插入本菜单。
 */
const toolbarConfig: Partial<IToolbarConfig> = {}
if (!hook) toolbarConfig.excludeKeys = ['uploadImage', 'uploadVideo']
if (props.imageLibrary) {
  registerImageLibraryMenu()
  toolbarConfig.insertKeys = { index: DEFAULT_GROUP_IMAGE_INDEX, keys: [IMAGE_LIBRARY_MENU_KEY] }
}

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

  // 图片库菜单 → 本实例弹窗（WeakMap 按编辑器实例路由，双实例互不串扰）
  if (props.imageLibrary) bindImageLibrary(editor, () => { libraryOpen.value = true })

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
  if (editorRef.value) unbindImageLibrary(editorRef.value)
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
  <ImageLibraryDialog
    v-if="imageLibrary"
    v-model:open="libraryOpen"
    :editor="editorRef ?? null"
    :library="imageLibrary"
  />
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

/**
 * 暗色根治（用户反馈 2026-11-16 B3/B6，两处「改了没生效」的真正原因）：
 * ① 变量必须挂在 html.dark 上而不是 .rich —— 工具栏悬浮 tooltip、下拉组、hoverbar、
 *    弹层有的挂在 body（不在 .rich 内），挂 .rich 的变量到不了那里；
 * ② 上一版把代码块背景变量写成了 --w-e-textarea-sight-bg-color（正确拼写是 slight），
 *    覆盖从未生效，代码块一直用默认 #f5f2f0 白底 + 浅色文字 → 「查看源码看不清」。
 * wangEditor 全部弹层/悬浮菜单都取自这一套变量，改这一处即可全局生效。
 */
:global(html.dark) {
  --w-e-toolbar-bg-color: #1f1f1f;
  --w-e-toolbar-color: #d4d4d4;
  --w-e-toolbar-active-bg-color: #3a3a3a;
  --w-e-toolbar-active-color: #e8e8e8;
  --w-e-toolbar-disabled-color: #666;
  --w-e-toolbar-border-color: #333;
  --w-e-textarea-bg-color: #181818;
  --w-e-textarea-color: #e5e5e5;
  --w-e-textarea-border-color: #333;
  --w-e-textarea-slight-bg-color: #121417;
  --w-e-textarea-slight-border-color: #333;
  --w-e-textarea-slight-color: #c9d1d9;
  --w-e-textarea-selected-border-color: #409eff;
  --w-e-textarea-handler-bg-color: #2a2a2a;
  --w-e-modal-button-bg-color: #2a2a2a;
  --w-e-modal-button-border-color: #444;
}

:global(html.dark .rich) {
  border-color: #333;
  background: #181818;
}

/* hover 提示（tooltip）与选中文字的暗色可读性：active-color 变亮后 tooltip 反转为浅底深字 */
:global(html.dark .w-e-text-container [data-slate-editor] pre>code) {
  text-shadow: none;
}

/* 代码块语法高亮 token：默认配色是给白底的，暗色下统一换成亮色系 */
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.cdata),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.comment),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.doctype),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.prolog) { color: #8b949e; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.punctuation) { color: #c9d1d9; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.boolean),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.constant),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.deleted),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.number),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.property),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.symbol),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.tag) { color: #79c0ff; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.attr-name),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.builtin),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.char),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.inserted),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.selector),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.string) { color: #a5d6ff; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.language-css .token.string),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.style .token.string),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.entity),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.operator),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.url) { color: #e3b341; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.atrule),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.attr-value),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.keyword) { color: #ff7b72; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.class-name),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.function) { color: #d2a8ff; }
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.important),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.regex),
:global(html.dark .w-e-text-container [data-slate-editor] pre>code .token.variable) { color: #ffa657; }

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
