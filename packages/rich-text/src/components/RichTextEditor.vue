<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage } from 'element-plus'
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
import { toDisplayHtml, toStoredHtml, toDisplaySrc } from '../display'
import {
  DEFAULT_GROUP_IMAGE_INDEX,
  IMAGE_LIBRARY_MENU_KEY,
  bindImageLibrary,
  registerImageLibraryMenu,
  unbindImageLibrary,
} from '../image-library-menu'
import {
  SOURCE_VIEW_MENU_KEY,
  bindSourceView,
  registerSourceViewMenu,
  unbindSourceView,
} from '../source-view-menu'
import {
  MARKDOWN_VIEW_MENU_KEY,
  bindMarkdownView,
  registerMarkdownViewMenu,
  unbindMarkdownView,
} from '../markdown-view-menu'
import { countText, type TextStats } from '../word-count'
import { FilePickerDialog } from '@sshk/file-picker'
import type { FilePickerItem } from '@sshk/file-picker'
import SourceViewDialog from './SourceViewDialog.vue'
import MarkdownViewDialog from './MarkdownViewDialog.vue'

/**
 * 共享富文本编辑器（从 edm-studio 迁入，R27 B3）。
 * F1：直接用 @wangeditor/editor 的 createEditor/createToolbar —— @wangeditor/editor-for-vue
 *     的 latest 是 Vue2 包，与本项目 Vue3 不兼容，禁止引入。
 * F2：fullScreen() 要求 toolbar 与 textarea 父节点一致，故二者用【同一 selector】创建。
 * C2：图片上传通过 onUploadImage 回调由工具侧注入，本包不依赖 upload-core；
 *     有 imageLibrary 桥接时工具栏「上传图片 / 上传视频」均改唤起 FilePickerDialog（#130 / #133）。
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
    /** 图片库设置隔离键：多实例各传不同值，来源/桶/目录设置互不串扰 */
    stateKey?: string
  }>(),
  {
    modelValue: '',
    readonly: false,
    onUploadImage: undefined,
    imageRule: undefined,
    imageLibrary: undefined,
    stateKey: 'default',
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
/** #133 视频选择框：与图片库分开（mode=video → 标题/accept/上传校验均按视频），插入走 wangEditor uploadVideo 的 insertFn */
const videoOpen = ref(false)
let videoInsertFn: ((url: string, poster?: string) => void) | null = null
const sourceOpen = ref(false)
const markdownOpen = ref(false)

/** 图片库确认（2026-11-17 泛化到 FilePickerDialog 后插入行为移回本组件）：拼 <img> 插入正文 */
function onLibraryConfirm(items: FilePickerItem[]): void {
  const editor = editorRef.value
  if (!editor || items.length === 0) return
  editor.focus()
  editor.dangerouslyInsertHtml(
    items.map((i) => `<img src="${String(i.url).replace(/"/g, '%22')}" alt=""/>`).join(''),
  )
  ElMessage.success(`已插入 ${items.length} 张图片`)
}
/** 视频库确认（#133）：走 wangEditor 标准 insertVideo 通道生成 <div data-w-e-type="video">，裸 <video> 编辑器不识别 */
function onVideoConfirm(items: FilePickerItem[]): void {
  const insert = videoInsertFn
  videoInsertFn = null
  const first = items[0]
  if (!insert || !first) return
  insert(toDisplaySrc(first.url)) // 存储 file:// → 编辑器显示 localres://，回写由 toStoredHtml 对称还原
  ElMessage.success('已插入视频')
}
/** 底部状态栏（Word 式字数统计） */
const stats = ref<TextStats>({ words: 0, chars: 0, charsNoSpace: 0, paragraphs: 0 })
const selectedLen = ref(0)
let classObserver: MutationObserver | null = null
let detachEvents: (() => void) | null = null
/** 双实例禁用修复的延时刷新句柄 */
let viewTimers: number[] = []

interface UploadImageConf {
  customUpload: (file: File, insertFn: (url: string) => void) => Promise<void>
  /** wangEditor 原生钩子（uploadImage exec 优先于原生文件输入）：设置后「上传图片」改调本回调（#130） */
  customBrowseAndUpload?: (insertFn: (url: string, alt?: string, href?: string) => void) => void
}
interface UploadVideoConf {
  /** uploadVideo 菜单同样支持该钩子（5.1.23 exec 实锤）：设置后「上传视频」改调本回调（#133） */
  customBrowseAndUpload?: (insertFn: (url: string, poster?: string) => void) => void
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
const conf: Record<string, UploadImageConf | UploadVideoConf> = {}
if (hook) {
  const maxSize = props.imageRule?.maxSize ?? 0
  conf.uploadImage = {
    customUpload: async (file, insertFn) => {
      if (maxSize > 0 && file.size > maxSize) throw new Error(`图片超过大小上限 ${maxSize} 字节`)
      insertFn(await hook(file))
    },
  }
}
// #130 用户拍板（2026-11-20）：有图片库桥接时，工具栏自带「上传图片」不再弹原生文件输入，
// 改唤起宿主图片选择框（FilePickerDialog）；插入走既有 onLibraryConfirm（dangerouslyInsertHtml）
if (props.imageLibrary) {
  ;(conf.uploadImage ??= { customUpload: async () => undefined }).customBrowseAndUpload = () => {
    libraryOpen.value = true
  }
  // #133 上传视频同样改唤起文件选择框：mode=video 决定标题「视频库」、accept=video/*、
  // 上传扩展名白名单 VIDEO_EXTS 与列取 kind=video；图片/视频两个弹框与状态完全隔离
  const videoConf: UploadVideoConf = {
    customBrowseAndUpload: (insertFn) => {
      videoInsertFn = insertFn
      videoOpen.value = true
    },
  }
  conf.uploadVideo = videoConf
}
if (Object.keys(conf).length > 0) editorConfig.MENU_CONF = conf

/**
 * 工具栏：以 wangEditor 默认 toolbarKeys 为基线（用户拍板：保持原始默认分组顺序）。
 * - 无上传钩子：剔除 uploadImage / uploadVideo，其余默认项原样保留；
 * - insertKeys 在默认 group-image（下标 22，对照 5.1.23 默认数组核实）前插入
 *   一个独立分组「扩展」（下拉，含「查看源码」恒有 + 「图片库」有桥接时），
 *   其余不动。（用户反馈 2026-11-17：新加的两个按钮单独放一个分组中）
 */
const toolbarConfig: Partial<IToolbarConfig> = {}
if (!hook) toolbarConfig.excludeKeys = ['uploadImage', 'uploadVideo']
registerSourceViewMenu()
// #131 Markdown 预览与「查看源码」一样恒可用（纯本地转换，不依赖上传/图片库桥接）
registerMarkdownViewMenu()
const extraKeys: string[] = [SOURCE_VIEW_MENU_KEY, MARKDOWN_VIEW_MENU_KEY]
if (props.imageLibrary) {
  registerImageLibraryMenu()
  extraKeys.push(IMAGE_LIBRARY_MENU_KEY)
}
// IToolbarConfig.insertKeys.keys 类型声明为 string[]，但实现是原样 splice 进 toolbarKeys，
// group 对象（{ key, title, iconSvg, menuKeys }）与官方自定义工具栏写法一致，可正常渲染为下拉分组
toolbarConfig.insertKeys = {
  index: DEFAULT_GROUP_IMAGE_INDEX,
  keys: [
    {
      key: 'group-sshk-extra',
      title: '扩展',
      // #131 用户嫌三点图标不好看 → FontAwesome fa-toolbox（工具箱=附加工具集，viewBox 用 FA 原生 512）
      iconSvg:
        '<svg viewBox="0 0 512 512"><path d="M176 56l0 40 160 0 0-40c0-4.4-3.6-8-8-8L184 48c-4.4 0-8 3.6-8 8zM128 96l0-40c0-30.9 25.1-56 56-56L328 0c30.9 0 56 25.1 56 56l0 40 28.1 0c12.7 0 24.9 5.1 33.9 14.1l51.9 51.9c9 9 14.1 21.2 14.1 33.9l0 76.1-136 0 0-16c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 16-144 0 0-16c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 16-136 0 0-76.1c0-12.7 5.1-24.9 14.1-33.9l51.9-51.9c9-9 21.2-14.1 33.9-14.1L128 96zM0 416l0-96 136 0 0 16c0 13.3 10.7 24 24 24s24-10.7 24-24l0-16 144 0 0 16c0 13.3 10.7 24 24 24s24-10.7 24-24l0-16 136 0 0 96c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64z"></path></svg>',
      menuKeys: extraKeys,
    } as unknown as string,
  ],
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
  // 查看源码菜单 → 本实例弹窗
  bindSourceView(editor, () => { sourceOpen.value = true })
  // Markdown 预览菜单 → 本实例弹窗
  bindMarkdownView(editor, () => { markdownOpen.value = true })

  // 双实例工具栏假死禁用修复（用户反馈 2026-11-16：切换实例后引用/代码块/网络图片变灰）。
  // 根因：工具栏禁用态只在编辑器 change 事件刷新（200ms 防抖），且 selection == null 时全禁。
  // 切到另一实例时本实例被 deselect → change → 全禁；点回本实例时若 DOM 选择与上次一致，
  // slate 同步不产生 change，工具栏就停在禁用态。此处在 focusin 后强制 updateView
  // （150ms / 500ms 双保险，晚于 slate 100ms 的 DOM 选择同步防抖），按实时 selection 重算禁用态。
  const refreshToolbar = (): void => {
    viewTimers.forEach((t) => window.clearTimeout(t))
    viewTimers = [
      window.setTimeout(() => editor.updateView(), 150),
      window.setTimeout(() => editor.updateView(), 500),
    ]
  }
  rich.addEventListener('focusin', refreshToolbar)

  // 底部状态栏字数：change 事件（含选区变化）驱动，初始算一次
  const refreshStats = (): void => {
    stats.value = countText(editor.getText())
    const sel = editor.getSelectionText()
    // 口径=「字符」字段（计空格、不含换行 = TextStats.chars），非「字数」（非空白字符数）——
    // 故状态栏文案为「已选 X 字符」（P8-3/A6 核对修正，避免与字数口径混淆）
    selectedLen.value = sel ? sel.replace(/\n/g, '').length : 0
  }
  refreshStats()
  editor.on('change', refreshStats)

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
  viewTimers.forEach((t) => window.clearTimeout(t))
  viewTimers = []
  if (editorRef.value) {
    unbindImageLibrary(editorRef.value)
    unbindSourceView(editorRef.value)
    unbindMarkdownView(editorRef.value)
  }
  editorRef.value?.destroy()
  editorRef.value = undefined
})
</script>

<template>
  <Teleport to="body" :disabled="!fullScreen">
    <div ref="richEl" class="rich" :class="{ 'is-fullscreen': fullScreen }">
      <div ref="editorBoxEl" class="rich-inner" />
      <!-- 底部状态栏（Word 式）：全屏时一并带起，随 .rich flex 布局沉底 -->
      <div class="rich-status">
        <span>字数 {{ stats.words }}</span>
        <span>字符 {{ stats.chars }}（空格 {{ stats.chars - stats.charsNoSpace }}）</span>
        <span>段落 {{ stats.paragraphs }}</span>
        <span v-if="selectedLen > 0" class="rich-status-sel">已选 {{ selectedLen }} 字符</span>
        <span v-if="readonly" class="rich-status-ro">只读</span>
      </div>
    </div>
  </Teleport>
  <FilePickerDialog
    v-if="imageLibrary"
    v-model:open="libraryOpen"
    mode="image"
    :library="imageLibrary"
    :state-key="stateKey"
    :resolve-src="toDisplaySrc"
    confirm-text="插入所选"
    @confirm="onLibraryConfirm"
  />
  <!-- #133 视频选择框：独立标题「选择视频」+ mode=video（accept=video/* / VIDEO_EXTS 校验），stateKey 后缀隔离图片选择状态 -->
  <FilePickerDialog
    v-if="imageLibrary"
    v-model:open="videoOpen"
    mode="video"
    title="选择视频"
    confirm-text="插入视频"
    :multiple="false"
    :library="imageLibrary"
    :state-key="stateKey + '::video'"
    :resolve-src="toDisplaySrc"
    @confirm="onVideoConfirm"
  />
  <SourceViewDialog v-model:open="sourceOpen" :editor="editorRef ?? null" :readonly="readonly" />
  <MarkdownViewDialog v-model:open="markdownOpen" :editor="editorRef ?? null" />
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

/** 底部状态栏（Word 式字数统计）：全屏时沉底，随 .rich 一起 Teleport */
.rich-status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end; /* #128：底部统计沉右下角 */
  gap: 14px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--sshk-text-dim, rgba(128, 128, 128, 0.9));
  background: var(--sshk-panel, #fff);
  border-top: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.3));
  border-radius: 0 0 6px 6px;
  user-select: none;
}
.rich-status-sel { color: var(--el-color-primary, #409eff); }
.rich-status-ro {
  color: var(--el-color-warning, #e6a23c);
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
}

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

/**
 * #131 扩展组下拉左对齐：wangEditor 默认 .w-e-bar-item-menus-container{left:0} 对齐的是
 * bar-item 外框（含 4px padding），面板左缘比按钮图标区偏左；改 left:4px 使面板与按钮左缘齐平，
 * 菜单项内容强制左对齐（wangEditor 的 .w-e-bar-item 默认 text-align:center）。
 */
:global(.w-e-bar-item-group .w-e-bar-item-menus-container) {
  left: 4px !important;
}
:global(.w-e-bar-item-group .w-e-bar-item-menus-container .w-e-bar-item) {
  text-align: left !important;
  justify-content: flex-start;
}

:global(html.dark .rich) {
  border-color: #333;
  background: #181818;
}

:global(html.dark .rich-status) {
  color: #8a8a8a;
  background: #1f1f1f;
  border-color: #333;
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
:global(.rich.is-fullscreen .rich-status) { border-radius: 0; }
</style>
