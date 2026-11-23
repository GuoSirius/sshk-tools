<script setup lang="ts">
/**
 * 通用文件选择弹框（自 rich-text ImageLibraryDialog 2026-11-17 泛化抽取）：
 * - 模式（=内容类别）：image 图片库 / document 文档库 / code 代码库 / all 文件库（全部文件）；标题/文案/默认 accept 按类别推导，应用方可覆盖
 * - 来源：本地 / 远程 profile / 云 profile；默认云→远程→本地；设置全局一份持久化（D58，2026-11-23）
 * - 统一选择池：上传项与已有项共用一份「已选」，跨 tab / 跨目录 / 跨来源累积，确认时一并交付
 * - 上传项并入列表可见（按 url 去重，标「本次上传」）；切页/重列不清空已选
 * - 列表一次拉足（桥接层提高 limit）+ 前端分批渲染 + 懒加载；文件名搜索支持跨页全量扫描
 * - 定制面：accept / allowedExts / maxSize / maxUploads / maxCount / multiple / naming / conflict /
 *   confirmText / initialTab / defaultTarget / resolveSrc；确认行为完全交给应用方（@confirm 交付条目，不替应用方拼接）
 *
 * P6-3 拆分（读码后真实结构）：本组件收缩为壳（tab 切换 + 公共状态编排）——
 * - composables/useDirPicker：来源/桶/目录 + 级联懒加载 + 设置持久化
 * - composables/useUploadPool：统一选择池 + 上传任务队列（拦截/去重/进度/二次确认移除）
 * - composables/useGalleryList：图库列表 + 游标续拉 + 搜索跨页扫描
 * - components/PickerThumbGrid：三页签共享的条目网格；components/UploadTaskCards：上传页拖拽卡+任务卡
 * 行为零变化（upload-dedupe / picker-settings 单测为回归锚）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { CascaderInstance } from 'element-plus'
import type { FilePickerConflict, FilePickerItem, FilePickerLibrary, FilePickerMode, FilePickerNaming, FilePickerTarget } from '../types'
import { matchFileKeyword } from '../picker-settings'
import { FILE_KIND_ACCEPT, FILE_KIND_LABELS } from '@sshk/shared'
import { PAGE_SIZE, useGalleryList } from '../composables/useGalleryList'
import { useUploadPool, type PoolItem } from '../composables/useUploadPool'
import { useDirPicker, type PickerTab } from '../composables/useDirPicker'
import PickerThumbGrid from './PickerThumbGrid.vue'
import UploadTaskCards from './UploadTaskCards.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    library: FilePickerLibrary
    /** 内容类别（图片/文档/代码/全部文件）：影响默认标题、页签文案、卡片渲染、默认 accept 与上传类别校验 */
    mode?: FilePickerMode
    /** 文件选择框 accept（如 'image/*'、'.pdf,.docx'、'video/*'）；优先级 accept > allowedExts 推导 > kind 类别默认 */
    accept?: string
    /**
     * 自定义扩展名白名单（如 ['.md', '.pdf']）：非空时**替代** kind 类别白名单，
     * 作为上传拦截（含拖拽）与列表前端过滤的双重强制口径；accept 缺省时由它推导文件选择框过滤。
     */
    allowedExts?: string[]
    /** 是否允许一次确认多个；false 时等价 maxCount=1（新选替换旧选） */
    multiple?: boolean
    /** 最大可选数量；0 / 缺省 = 不限制；=1 时单选替换 */
    maxCount?: number
    /** 本次打开弹框期间累计上传文件数上限（0 / 缺省 = 不限制）；与 maxCount 独立，可分别控制上传量与选择量 */
    maxUploads?: number
    /** 单文件字节上限（组件侧快速拦截；0 / 缺省 = 不限制，真正的校验在 Upload Service 侧） */
    maxSize?: number
    /** 上传存储命名：hash=内容寻址名（默认，现状逻辑）；original=保留原文件名 */
    naming?: FilePickerNaming
    /** original 命名时同名不同内容的处理：hash=追加 -hash8（默认，不覆盖）；overwrite=直接覆盖 */
    conflict?: FilePickerConflict
    /** 确认按钮文案；缺省 image→「插入所选」、其余类别→「确认选择」 */
    confirmText?: string
    /** 弹框标题；缺省按类别：「图片库」「文档库」「代码库」「视频库」「文件库」 */
    title?: string
    /** 打开时默认页签（无已保存设置时生效） */
    initialTab?: PickerTab
    /** 无已保存设置时的预设桶/目录（打开即定位；已保存的设置优先） */
    defaultTarget?: FilePickerTarget
    /** 预览 URL 解析钩子（rich-text 传 localres 显示形态转换；其他应用可不传） */
    resolveSrc?: (url: string) => string
  }>(),
  {
    mode: 'image',
    accept: undefined,
    allowedExts: undefined,
    multiple: true,
    maxCount: 0,
    maxUploads: 0,
    maxSize: 0,
    naming: 'hash',
    conflict: 'hash',
    confirmText: undefined,
    title: undefined,
    initialTab: 'upload',
    defaultTarget: undefined,
    resolveSrc: undefined,
  },
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 确认：交付已选条目（url/name/size/key），用途由应用方定义 */
  (e: 'confirm', items: FilePickerItem[]): void
}>()

/** 生效的展示文案与默认值（mode 推导 + props 覆盖） */
const isImage = computed(() => props.mode === 'image')
const kindLabel = computed(() => FILE_KIND_LABELS[props.mode] ?? '文件')
const dialogTitle = computed(() => props.title ?? `${kindLabel.value}库`)
/** 生效扩展名白名单：归一化（去空白/小写/补点），空列表视为未设置返回 null */
const effectiveExts = computed<string[] | null>(() => {
  const list = (props.allowedExts ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  return list.length > 0 ? list : null
})
/** 扩展名是否在白名单内；白名单未设置时恒 true，无文件名时按「宁缺勿滥」拒绝 */
function extAllowed(name?: string): boolean {
  if (!effectiveExts.value) return true
  if (!name) return false
  const lower = name.toLowerCase()
  return effectiveExts.value.some((e) => lower.endsWith(e))
}
const acceptAttr = computed(() => props.accept ?? effectiveExts.value?.join(',') ?? FILE_KIND_ACCEPT[props.mode] ?? '')
const confirmLabel = computed(() => props.confirmText ?? (props.mode === 'image' ? '插入所选' : '确认选择'))
/** 上传 input 的多选：跟随 multiple */
const uploadMultiple = computed(() => props.multiple)
/** 生效最大可选数：multiple=false 视为 1（新选替换旧选） */
const effectiveMax = computed(() => (props.multiple ? (props.maxCount || 0) : 1))

const tab = ref<PickerTab>('upload')
/** 文件名搜索关键词 */
const keyword = ref('')
/** 已渲染数量（分批渲染） */
const renderedCount = ref(PAGE_SIZE)

/** ── 目录/来源域（composable）── */
function onSourceChanged(): void {
  cancelPending() // 搜索中切源：立即作废在途列表/扫描，旧源结果不再混入
  gallery.items.value = [] // 仅清当前列表；统一选择池保留，跨来源累积
  renderedCount.value = PAGE_SIZE
  scheduleReload() // 防抖后重新列取（带关键词时 loadGallery 末尾自动续扫）
}
function onTargetChanged(): void {
  cancelPending() // 搜索中切桶/目录：立即作废在途列表/扫描
  scheduleReload()
}
const cascaderRef = ref<CascaderInstance | null>(null)
const dirPicker = useDirPicker(props, { tab, cascaderRef, onSourceChanged, onTargetChanged })
const {
  sources, sourceId, target, loadingSources, restored,
  typeOf, showBucket, dirError, dirPanelKey, dirCascaderPicked,
  cascaderProps, dirModel, dirManualFocused, dirManualDisplay,
  commitDirInput, onDirChange, dirValidation, currentScope,
} = dirPicker

/** ── 图库列表域（composable）── */
const gallery = useGalleryList(props, {
  activeSource: dirPicker.activeSource,
  target: dirPicker.target,
  keyword,
  renderedCount,
})
const { items, loadingList, galleryCursor, loadingMore, scanning, scanTotal, scanCapped, cancelScan, cancelPending, loadGallery, loadMoreGallery } = gallery

/** ── 统一选择池 + 上传队列域（composable）── */
const uploadPool = useUploadPool(props, {
  currentScope,
  activeSource: dirPicker.activeSource,
  target: dirPicker.target,
  effectiveExts,
  extAllowed,
  effectiveMax,
  kindLabel,
  keyword,
  onBatchUploaded: () => { dirPanelKey.value++ }, // 上传成功后重挂级联：清掉懒加载缓存，下次展开即可看到新目录
})
const {
  uploaded, uploadTotal, uploadInProgressCount, uploadSucceeded, uploadFailed,
  overallPercent, uploadInProgress, activeUploadTasks,
  poolList, poolCount, uploadPicked, existingPicked,
  isSelected, addToPool, removeFromPool, togglePool, removePoolKey, clearPool,
  handleFiles, retryUpload, removeUploadTask, clearFinishedTasks, removeUploaded, removeSelectedUploaded,
  dispose: disposeUploadPool,
} = uploadPool

/** 统一选择池键：url 唯一标识一个文件（与 useUploadPool 同口径） */
const itemKey = (i: { url: string }): string => i.url

/** ── 三页签可见视图（壳层编排：上传池 + 图库列表合并）── */
/** 列表页可见项：本次上传（含旧源上传的）优先，当前源列文件按作用域+url 去重补充，再按文件名过滤 */
const galleryView = computed<PoolItem[]>(() => {
  const map = new Map<string, PoolItem>()
  for (const u of uploaded.value) map.set(itemKey(u), u)
  const scope = currentScope.value
  for (const it of items.value) {
    // 自定义扩展名白名单时前端同步过滤列取结果（kind 只支持五类，无法表达任意扩展名组合）
    if (!extAllowed(it.name ?? it.key)) continue
    const wrapped: PoolItem = { ...it, origin: 'existing', scope }
    if (!map.has(itemKey(wrapped))) map.set(itemKey(wrapped), wrapped)
  }
  return [...map.values()].filter((i) => matchFileKeyword(i, keyword.value))
})
/** 上传页可见项（同样支持文件名搜索） */
const uploadView = computed<PoolItem[]>(() => {
  // 按 url 去重兜底（上传前已按内容 hash 去重，这里防历史/异常数据重复卡片）
  const map = new Map<string, PoolItem>()
  for (const i of uploaded.value) map.set(itemKey(i), i)
  return [...map.values()].filter((i) => matchFileKeyword(i, keyword.value))
})
/** 已选择 tab：展示统一选择池（跨 tab/源/桶/目录累积），同样支持文件名搜索 */
const selectedView = computed<PoolItem[]>(() => poolList.value.filter((i) => matchFileKeyword(i, keyword.value)))
const visible = computed<PoolItem[]>(() =>
  tab.value === 'upload' ? uploadView.value : tab.value === 'selected' ? selectedView.value : galleryView.value,
)
const rendered = computed<PoolItem[]>(() => {
  // 仍在任务卡片里展示进度的成功项先不在普通缩略图重复渲染，窗口过后自然回归（仅上传 tab 有任务卡片）
  const inTaskCard = new Set(
    tab.value === 'upload'
      ? activeUploadTasks.value.filter((t) => t.status === 'success' && t.url).map((t) => t.url!)
      : [],
  )
  return visible.value.filter((i) => !inTaskCard.has(i.url)).slice(0, renderedCount.value)
})

/** 放大预览源始终取「当前可见全集」（非仅已渲染），可左右翻看；initial-index 用全集下标 */
const previewUrls = computed(() => visible.value.map((i) => resolveSrcOf(i.url)))
function resolveSrcOf(url: string): string {
  return props.resolveSrc ? props.resolveSrc(url) : url
}

/** 作用域中文标签，用于「已选择」tab 卡片标注来源 */
function scopeLabel(scope: string): string {
  const [sid = '', bucket = '', dir = ''] = scope.split('|')
  const src = sources.value.find((s) => s.id === sid)
  const base = src?.label ?? sid
  const extra = [bucket, dir].filter(Boolean).join(' / ')
  return extra ? `${base} · ${extra}` : base
}

/** 拖拽上传卡片主文案：与文件卡片同尺寸，只放短词；完整规则走 title 悬浮（2026-11-20 合并布局） */
const uploadHint = computed<string>(() => {
  if (uploadInProgress.value) return `上传中 ${uploadInProgressCount.value} 项…`
  return `点击或拖拽${kindLabel.value}`
})
/** 拖拽上传卡片悬浮说明：长说明不进卡片（行内只一两个词，长说明走悬浮提示） */
const uploadDropTip = computed<string>(() =>
  `点击或拖拽${kindLabel.value}到此处${uploadMultiple.value ? '（可多选）' : ''}；上传后先预览、可删除/点开查看，切到列表页可继续挑选，最后一并确认`,
)
/** 网格内是否有内容卡（upload 页签恒渲染添加卡，此值只供 gallery/selected 空态判断） */
const hasCards = computed(() => visible.value.length > 0 || (tab.value === 'upload' && activeUploadTasks.value.length > 0))

/** 空态文案：按页签与模式推导（模板表达式里不写嵌套模板字符串，vue-tsc 解析不稳） */
const emptyStateText = computed<string>(() => {
  if (tab.value === 'upload') {
    return keyword.value ? '无匹配文件' : `尚未上传；上传后在此预览，不会立即${isImage.value ? '插入正文' : '交付'}`
  }
  if (tab.value === 'selected') {
    if (keyword.value) return '无匹配文件'
    return poolCount.value ? '无匹配文件' : '尚未选择；在「上传」或「从库选择」里勾选，会汇总到这里'
  }
  if (loadingList.value) return '读取中…'
  return keyword.value ? '无匹配文件' : `暂无${kindLabel.value}，点「刷新」或先上传${isImage.value ? '几张' : '几个'}`
})

/** ── 打开/关闭编排（与原实现逐行对齐）── */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    // 每次重新打开是新一轮会话：重置上传缓存与选择池
    uploadPool.resetSession()
    items.value = []
    keyword.value = ''
    renderedCount.value = PAGE_SIZE
    const savedTab = await dirPicker.restoreSettings()
    tab.value = savedTab ?? props.initialTab ?? 'upload'
    // 设置恢复后再打开写回监听，防止空值落盘覆盖（finishRestore 内部 nextTick + restored=true）
    await dirPicker.finishRestore()
    if (tab.value === 'gallery') await loadGallery()
  },
)

/** 上下文变化（切源/桶/目录/搜索条件）统一防抖重列：取消入口由调用方先行 cancelPending，本函数只负责延迟触发 */
let reloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReload(): void {
  if (!props.open || !restored.value || tab.value !== 'gallery') return
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => { reloadTimer = null; void loadGallery() }, 300)
}

watch(tab, async (v) => {
  renderedCount.value = PAGE_SIZE
  if (v === 'gallery' && props.open && restored.value) await loadGallery()
})
watch(keyword, (kw) => {
  renderedCount.value = PAGE_SIZE
  cancelPending() // 搜索条件变化：立即作废在途列表/扫描（不等防抖，避免旧结果混入）
  if (!kw) return // 清空关键词：回到分页浏览，loadGallery 只拉首页不再续扫
  // 仅列表 tab 需要跨页扫描（上传/已选择数据全在内存）；防抖 400ms 避免逐字触发
  if (tab.value !== 'gallery') return
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    // 重新列首页再续扫：保证新关键词覆盖「已加载页 + 后续页」，且旧扫描已被 cancelPending 作废
    void loadGallery()
  }, 400)
})

function close(): void {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = null
  cancelPending() // 关闭即作废在途请求，避免关闭后旧结果回写
  emit('update:open', false)
}

onBeforeUnmount(() => {
  if (reloadTimer) clearTimeout(reloadTimer)
  cancelPending()
  disposeUploadPool()
})

/** 确认：交付已选条目给应用方；弹框只收尾（清池、清上传缓存、关闭），不决定用途 */
function confirmSelected(): void {
  const picked = poolList.value
  if (picked.length === 0) return
  emit('confirm', picked.map((i) => ({ url: i.url, name: i.name, size: i.size, key: i.key, modified: i.modified })))
  clearPool()
  uploaded.value = []
  close()
  ElMessage.success(`已选择 ${picked.length} 个文件`)
}

const uploadInput = ref<HTMLInputElement | null>(null)
function pickFiles(): void {
  uploadInput.value?.click()
}

async function uploadMore(): Promise<void> {
  if (tab.value !== 'upload') {
    tab.value = 'upload'
    await nextTick()
  }
  pickFiles()
}

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await handleFiles(files)
}

/** 拖拽投放上传：与点击选择走同一入口（dataTransfer.files）；拖拽高亮态在 UploadTaskCards 内部 */
async function onDrop(e: DragEvent): Promise<void> {
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  await handleFiles(files)
}

/** 全选/全不选/反选作用于「当前可见集合」，不清空其他 tab / 目录 / 源已选的项 */
function selectAllVisible(v: boolean): void {
  for (const i of visible.value) {
    if (v) {
      if (!addToPool(i)) break // 达到上限即止（addToPool 已提示）
    } else removeFromPool(i)
  }
}
function invertVisible(): void {
  for (const i of visible.value) togglePool(i)
}

/** 滚动到底追加下一批（一次性拉全，分批挂 DOM；图片本身再走 loading=lazy） */
function onPaneScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80 && renderedCount.value < visible.value.length) {
    renderedCount.value += PAGE_SIZE
  }
}

</script>

<template>
  <el-dialog
    :model-value="open"
    class="file-picker-dialog"
    :title="dialogTitle"
    width="820px"
    top="4vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <!-- 高频工具栏放 header：结构上脱离内容滚动区，滚动时始终可见 -->
    <template #header>
      <div class="lib-header">
        <span class="lib-title">{{ dialogTitle }}</span>
        <div class="lib-top">
          <div class="lib-row lib-row-source">
            <el-select v-model="sourceId" placeholder="选择来源（默认优先云）" class="source-select" :loading="loadingSources">
              <el-option v-for="s in sources" :key="s.id" :value="s.id" :label="s.label" />
            </el-select>
            <el-radio-group v-model="tab" class="mode-tabs">
              <el-radio-button value="upload">上传{{ kindLabel }}</el-radio-button>
              <el-radio-button value="gallery">从{{ kindLabel }}库选择</el-radio-button>
              <el-radio-button value="selected">已选择{{ poolCount ? ` ${poolCount}` : '' }}</el-radio-button>
            </el-radio-group>
          </div>
          <div class="lib-row lib-row-target">
            <el-input clearable v-if="showBucket" v-model="target.bucket" placeholder="桶 / 容器（留空用 profile 默认）" class="bucket-input" />
            <el-cascader
              ref="cascaderRef"
              :key="dirPanelKey"
              v-model="dirModel"
              :props="cascaderProps"
              separator="/"
              clearable
              class="dir-cascader"
              :class="{ 'is-root-selected': dirCascaderPicked === '' }"
              popper-class="fp-dir-cascader-popper"
              :placeholder="showBucket ? '目录前缀（逐级选或手输）' : typeOf === 'remote' ? '远程目录（逐级选或手输）' : '本地目录（逐级选或手输）'"
              @change="onDirChange"
            />
            <el-input
              v-model="dirManualDisplay"
              clearable
              class="dir-manual"
              :class="{ 'dir-invalid': dirValidation.level === 'error' }"
              placeholder="或手输目录"
              @focus="dirManualFocused = true"
              @blur="dirManualFocused = false; commitDirInput()"
              @change="commitDirInput"
            />
          </div>
          <div v-if="dirValidation.level !== 'ok'" class="dir-validation" :class="`dir-validation--${dirValidation.level}`">
            {{ dirValidation.message }}
          </div>
          <!-- 目录懒加载失败：透出原因，仍可手输 -->
          <div v-if="dirError" class="dir-validation dir-validation--warning">目录列表加载失败：{{ dirError }}（仍可手输目录）</div>
          <div class="lib-row lib-row-actions">
            <span class="lib-count">
              已选 {{ poolCount }}{{ effectiveMax > 0 ? ` / ${effectiveMax}` : '' }}（上传 {{ uploadPicked }} · 库选 {{ existingPicked }}）
            </span>
            <el-input v-model="keyword" clearable class="search-input" placeholder="搜索文件名" />
            <el-button size="small" type="primary" plain @click="selectAllVisible(true)">全选本页</el-button>
            <el-button size="small" type="info" plain @click="selectAllVisible(false)">全不选</el-button>
            <el-button size="small" type="info" plain @click="invertVisible">反选本页</el-button>
            <el-button v-if="tab === 'gallery'" size="small" type="success" plain :loading="loadingList" @click="loadGallery">刷新</el-button>
            <el-button v-else-if="tab === 'selected'" size="small" type="danger" plain :disabled="poolCount === 0" @click="clearPool">清空</el-button>
            <el-button v-else size="small" type="danger" plain :disabled="uploadPicked === 0" @click="removeSelectedUploaded">删除所选</el-button>
          </div>
        </div>
        <!-- 上传总体进度固定在 header，滚动区只放纯文件列表 -->
        <div v-if="uploadTotal" class="upload-progress-bar">
          <div class="up-summary">
            <span>已结束 {{ uploadSucceeded + uploadFailed }}/{{ uploadTotal }} · 成功 {{ uploadSucceeded }} · 失败 {{ uploadFailed }} · 上传中 {{ uploadInProgressCount }}</span>
            <el-button size="small" text type="info" :disabled="!uploadSucceeded && !uploadFailed" @click="clearFinishedTasks">清除已结束</el-button>
          </div>
          <el-progress :percentage="overallPercent" :status="uploadFailed && !uploadInProgress ? 'exception' : uploadInProgressCount === 0 && uploadFailed === 0 ? 'success' : undefined" :stroke-width="8" />
        </div>
      </div>
    </template>
    <input
      ref="uploadInput"
      type="file"
      :accept="acceptAttr"
      :multiple="uploadMultiple"
      class="hidden-input"
      @change="onFilesChosen"
    />

    <div class="lib-pane" @scroll="onPaneScroll">
      <div v-if="tab === 'upload' || hasCards" class="thumb-grid">
        <!-- 上传页专属：拖拽添加卡 + 任务卡（多根 fragment，直接作为网格单元参与布局） -->
        <UploadTaskCards
          v-if="tab === 'upload'"
          :is-image="isImage"
          :tasks="activeUploadTasks"
          :upload-in-progress="uploadInProgress"
          :upload-hint="uploadHint"
          :upload-drop-tip="uploadDropTip"
          :upload-multiple="uploadMultiple"
          @pick="pickFiles"
          @drop="onDrop"
          @retry="retryUpload"
          @remove-task="removeUploadTask"
        />
        <!-- 三页签共享条目网格：角标与右上角按钮随 tab 条件渲染 -->
        <PickerThumbGrid
          :tab="tab"
          :items="rendered"
          :visible-items="visible"
          :preview-urls="previewUrls"
          :is-image="isImage"
          :is-selected="isSelected"
          :resolve-src="resolveSrcOf"
          :scope-label="scopeLabel"
          @toggle="togglePool"
          @remove-key="removePoolKey"
          @remove-uploaded="removeUploaded"
        />
      </div>
      <div v-else class="gallery-empty">{{ emptyStateText }}</div>
      <div v-if="scanning" class="load-more load-more--action">
        正在搜索全部文件：已扫描 {{ scanTotal }} 个…
        <el-button size="small" type="danger" plain @click="cancelScan">取消</el-button>
      </div>
      <div v-else-if="scanCapped" class="load-more">已扫描 {{ scanTotal }} 个（达扫描上限，更深的文件未纳入搜索）</div>
      <div v-else-if="renderedCount < visible.length" class="load-more">已显示 {{ rendered.length }} / {{ visible.length }}，滚动继续加载</div>
      <div v-else-if="galleryCursor && tab === 'gallery'" class="load-more load-more--action">
        已加载 {{ items.length }} 个，来源侧可能还有更多
        <el-button size="small" type="primary" plain :loading="loadingMore" @click="loadMoreGallery">加载更多</el-button>
      </div>
    </div>

    <template #footer>
      <!-- 确认动作沉底：继续上传 / 插入所选与关闭同行，关闭固定最右（2026-11-17 用户反馈） -->
      <el-button type="primary" plain @click="uploadMore">继续上传</el-button>
      <el-button type="primary" :disabled="poolCount === 0" @click="confirmSelected">
        {{ confirmLabel }}{{ poolCount ? ` ${poolCount} 个` : '' }}
      </el-button>
      <el-button type="info" plain @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 工具栏已移入 header：标题 + 三行高频操作区，结构上不随内容滚动 */
.lib-title { display: block; font-size: 18px; font-weight: 600; line-height: 24px; margin-bottom: 8px; padding-right: 32px; }
.lib-top { border-bottom: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); padding-bottom: 8px; }
.lib-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.lib-row:last-child { margin-bottom: 0; }
.source-select { flex: 1 1 auto; }
.mode-tabs { flex: 0 0 auto; }
.bucket-input { flex: 0 0 220px; }
.dir-cascader { flex: 0 1 240px; min-width: 0; }
.dir-manual { flex: 1 1 auto; min-width: 0; }
.dir-validation { font-size: 12px; line-height: 1.4; margin-top: -2px; }
.dir-validation--warn { color: var(--el-color-warning); }
.dir-validation--warning { color: var(--el-color-warning); }
.dir-validation--error { color: var(--el-color-danger); }
.dir-validation--info { color: var(--el-text-color-secondary); }
.dir-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.search-input { flex: 0 0 150px; }
.hidden-input { display: none; }
.lib-row-actions { flex-wrap: wrap; gap: 6px; }
.lib-count { font-size: 12px; opacity: 0.75; margin-right: 2px; }
/* 上传总体进度条 */
.upload-progress-bar { border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); border-radius: 6px; padding: 8px 10px; margin-top: 10px; margin-bottom: 0; }
.up-summary { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.gallery-empty { text-align: center; padding: 28px 0; font-size: 13px; opacity: 0.6; }
.load-more { text-align: center; padding: 10px 0 2px; font-size: 12px; opacity: 0.6; }
.load-more--action { display: flex; align-items: center; justify-content: center; gap: 10px; }

/* 整个弹框（含 header 工具栏 + footer）占应用视口约 75%，body 用 flex 吃掉 header 之外的剩余 */
:global(.file-picker-dialog) {
  height: 75vh;
  min-height: 460px;
  max-height: 92vh;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.file-picker-dialog .el-dialog__header) { flex: 0 0 auto; padding: 0 !important; margin-right: 0 !important; }
:global(.file-picker-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 0 0 !important;
}
:global(.file-picker-dialog .el-dialog__footer) { flex: 0 0 auto; padding: 12px 0 16px !important; }
/* 缩略图区占满剩余高度并单独滚动；已选清单用 flex-basis 受自身 max-height 约束后单独滚动 */
.lib-pane { flex: 1 1 0; min-height: 120px; overflow-y: auto; padding-right: 6px; }
</style>

<!-- 非 scoped：根目录回显规则（2026-11-19 定版，与文件管理页 fs-dir-cascader-popper 同一套）。
     根 label='' 守「子级回显 /a/b 不双斜杠」（pathLabels=['','a','b'].join('/')=/a/b）；
     代价是只选根时 join 结果为空 → 输入框/面板根节点都空，此处补显示，不改 label 机制。
     popper 经 teleport 挂 body、el-input 内部元素不带 scope 属性，均需全局选择器。 -->
<style>
/* 面板首列（根列）首节点补 /：根列是第一个 .el-cascader-menu 且只含根节点；
   子级 menu 非 first-child 不受影响（不用 :empty——空文本节点会让它匹配失败） */
.fp-dir-cascader-popper .el-cascader-menu:first-child .el-cascader-node:first-child .el-cascader-node__label::before { content: '/'; }
/* 只选根时，级联输入框在占位层补 / 并隐藏空值+占位文字，视觉等同正常回显。
   placeholder 由 ::placeholder 伪元素渲染，必须单独透明化，否则「/」与占位文字叠字 */
.dir-cascader.is-root-selected .el-input__inner,
.dir-cascader.is-root-selected .el-input__inner::placeholder { color: transparent; }
.dir-cascader.is-root-selected .el-input__wrapper { position: relative; }
.dir-cascader.is-root-selected .el-input__wrapper::after {
  content: '/';
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--el-text-color-regular);
  font-size: 13px;
  pointer-events: none;
}
</style>
