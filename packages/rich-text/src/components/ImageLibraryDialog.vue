<script setup lang="ts">
/**
 * 图片库弹窗（用户需求 2026-11-16 ④⑤ / 2026-11-17 ①~⑦ + 三轮追加）：
 * - 来源：本地 / 远程 profile / 云 profile；默认云→远程→本地；设置按 stateKey 持久化，多实例隔离
 * - 统一选择池：上传项与图库项共用一份「已选」，跨 tab / 跨目录 / 跨来源累积，最后一并插入
 * - 上传图片并入图库页可见（按 url 去重，标「本次上传」）；切页/重列不清空已选
 * - 图库一次拉足（桥接层提高 limit）+ 前端分批渲染 + 图片懒加载，避免图片过多撑爆
 * - 文件名搜索（name/key/url）；目录级联逐层选择、任意层级可选，也可手输不存在目录
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import type { RichTextImageItem, RichTextImageLibrary, RichTextImageSource, RichTextImageTarget } from '../types'
import { toDisplaySrc } from '../display'
import {
  defaultSourceId,
  directoryTree,
  loadSettings,
  matchImageKeyword,
  saveSettings,
  sortSourcesByDefault,
} from '../image-library-settings'
import type { DirectoryTreeNode } from '../image-library-settings'

/** 选择池条目：origin 区分本次上传（可删）与图库已有（不可删）；scope 记录来源/桶/目录归属 */
interface PoolItem extends RichTextImageItem {
  key?: string
  origin: 'upload' | 'gallery'
  /** 归属作用域：sourceId|bucket|目录，跨源/桶/目录的同名图片互不串扰 */
  scope: string
}

/** 上传任务：逐项跟踪进度/状态，失败可重试或删除；成功项同时并入 uploaded 与选择池 */
interface UploadTask {
  id: number
  file: File
  name: string
  status: 'uploading' | 'success' | 'failed'
  /** 0–100；Provider 无 byte 级上报时由 UI 爬升动画推进到 90，成功置 100，失败停在当时值 */
  percent: number
  error?: string
  url?: string
  /** 本地预览 objectURL（web-uploader 风格缩略图），卸载/删除时 revoke */
  previewUrl?: string
  /** 缩略图加载失败（CSP 拦截/损坏文件/不支持格式）时改用占位，不显示浏览器裂图 */
  previewFailed?: boolean
  size: number
  scope: string
  source: RichTextImageSource
  target: RichTextImageTarget
}

/**
 * 选择池键：url 唯一标识一张图。不同源/桶的对象 URL 本身就不同，无需把 scope 拼进 key；
 * 这样上传选中后切到图库（同 url）仍保持选中，切目录/源亦然，且计数不重复。
 * scope 只记录来源用于清单展示，不参与去重。
 */
const itemKey = (i: { url: string }): string => i.url

const props = withDefaults(
  defineProps<{
    open: boolean
    editor: IDomEditor | null
    library: RichTextImageLibrary
    /** 多实例隔离键：不同富文本实例各存各的来源/目录设置 */
    stateKey?: string
  }>(),
  { stateKey: 'default' },
)
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

/** 一批渲染的图片数：一次拉全但分批挂 DOM，滚动到底再追加 */
const PAGE_SIZE = 48
/** 一次向后端拉取的图片上限（各云 SDK 单页上限 ≥ 500；前端再分批渲染/懒加载） */
const FETCH_LIMIT = 500

const tab = ref<'upload' | 'gallery'>('upload')
const sources = ref<RichTextImageSource[]>([])
const sourceId = ref('')
const target = ref<RichTextImageTarget>({})
const loadingSources = ref(false)
/** 设置恢复完成前不写回，避免空状态覆盖已存值 */
const restored = ref(false)

const uploading = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
/** 本次上传的图片（未插入前可删除）；图库页也会合并展示 */
const uploaded = ref<PoolItem[]>([])
/** 上传任务队列（含进行中/成功/失败），用于总体与单项进度、失败重试/删除 */
const uploadTasks = ref<UploadTask[]>([])
let uploadSeq = 0
/** 进行中任务总数（总体进度分母） */
const uploadTotal = computed(() => uploadTasks.value.length)
const uploadDone = computed(() => uploadTasks.value.filter((t) => t.status !== 'uploading').length)
const uploadSucceeded = computed(() => uploadTasks.value.filter((t) => t.status === 'success').length)
const uploadFailed = computed(() => uploadTasks.value.filter((t) => t.status === 'failed').length)
/** 总体进度：已完成任务按 100% 计，进行中按其 percent 计 */
const overallPercent = computed(() => {
  const all = uploadTasks.value
  if (all.length === 0) return 0
  const sum = all.reduce((acc, t) => acc + (t.status === 'success' ? 100 : t.percent), 0)
  return Math.min(100, Math.round(sum / all.length))
})
/** 有活动上传任务时显示总体进度条 */
const uploadInProgress = computed(() => uploadTasks.value.some((t) => t.status === 'uploading'))
/** 上传中/失败的任务：以缩略图卡片形式并入图片网格（成功项走 uploaded 卡片），受文件名搜索过滤 */
const activeUploadTasks = computed(() =>
  uploadTasks.value.filter((t) => t.status !== 'success' && (!keyword.value || t.name.toLowerCase().includes(keyword.value.toLowerCase()))),
)
/** 图库已列图片 */
const items = ref<RichTextImageItem[]>([])
const loadingList = ref(false)
/** 目录下拉的候选 key：打开弹窗/切来源时静默列一次，派生级联树 */
const dirKeys = ref<string[]>([])
/** 文件名搜索关键词 */
const keyword = ref('')
/** 已渲染数量（分批渲染） */
const renderedCount = ref(PAGE_SIZE)

/** 统一选择池：key = 作用域+url，跨 tab / 目录 / 源 / 桶累积，同名图片不串扰 */
const pool = ref<Record<string, PoolItem>>({})
const poolList = computed(() => Object.values(pool.value))
const poolCount = computed(() => poolList.value.length)
const uploadPicked = computed(() => poolList.value.filter((i) => i.origin === 'upload').length)
const galleryPicked = computed(() => poolList.value.filter((i) => i.origin === 'gallery').length)
const isSelected = (item: PoolItem): boolean => Boolean(pool.value[itemKey(item)])
function addToPool(item: PoolItem): void {
  if (!item.url) return
  pool.value[itemKey(item)] = item
}
function removeFromPool(item: PoolItem): void {
  const k = itemKey(item)
  if (!pool.value[k]) return
  const next = { ...pool.value }
  delete next[k]
  pool.value = next
}
function togglePool(item: PoolItem): void {
  if (isSelected(item)) removeFromPool(item)
  else addToPool(item)
}
/** 按作用域 key 移除（用于跨源清单，item 可能来自已切换的旧源） */
function removePoolKey(k: string): void {
  const next = { ...pool.value }
  delete next[k]
  pool.value = next
}
function clearPool(): void {
  pool.value = {}
}
/** 已选清单放大预览源（含全部来源） */
const previewPoolUrls = computed(() => poolList.value.map((i) => toDisplaySrc(i.url)))
const poolExpanded = ref(false)
/** 作用域中文标签，用于跨源已选清单 */
function scopeLabel(scope: string): string {
  const [sid = '', bucket = '', dir = ''] = scope.split('|')
  const src = sources.value.find((s) => s.id === sid)
  const base = src?.label ?? sid
  const extra = [bucket, dir].filter(Boolean).join(' / ')
  return extra ? `${base} · ${extra}` : base
}

const activeSource = computed(() => sources.value.find((s) => s.id === sourceId.value) ?? null)
const typeOf = computed(() => activeSource.value?.type ?? 'cloud')
const showBucket = computed(() => typeOf.value === 'cloud')
/** 目录（云前缀 / 远程路径 / 本地目录）统一完整路径字符串，支持级联选择与手输 */
const dirModel = computed({
  get: () => target.value.prefix || target.value.remotePath || target.value.localDir || '',
  set: (v: string) => {
    if (typeOf.value === 'cloud') target.value = { ...target.value, prefix: v }
    else if (typeOf.value === 'remote') target.value = { ...target.value, remotePath: v }
    else target.value = { ...target.value, localDir: v }
  },
})
/** 当前来源+桶+目录的作用域串，构造图库项/上传项时固化进 pool key */
const currentScope = computed(() => [sourceId.value, target.value.bucket ?? '', dirModel.value].join('|'))
/** 级联目录树：从已列图片 key 派生，每层 value 为完整路径 */
const dirTree = computed<DirectoryTreeNode[]>(() => directoryTree(dirKeys.value))

/** 图库页可见项：本次上传（含旧源上传的）优先，当前源列图按作用域+url 去重补充，再按文件名过滤 */
const galleryView = computed<PoolItem[]>(() => {
  const map = new Map<string, PoolItem>()
  for (const u of uploaded.value) map.set(itemKey(u), u)
  const scope = currentScope.value
  for (const it of items.value) {
    const wrapped: PoolItem = { ...it, origin: 'gallery', scope }
    if (!map.has(itemKey(wrapped))) map.set(itemKey(wrapped), wrapped)
  }
  return [...map.values()].filter((i) => matchImageKeyword(i, keyword.value))
})
/** 上传页可见项（同样支持文件名搜索） */
const uploadView = computed<PoolItem[]>(() => uploaded.value.filter((i) => matchImageKeyword(i, keyword.value)))
const visible = computed<PoolItem[]>(() => (tab.value === 'upload' ? uploadView.value : galleryView.value))
const rendered = computed<PoolItem[]>(() => visible.value.slice(0, renderedCount.value))

/** 放大预览源始终取「当前可见全集」（非仅已渲染），可左右翻看；initial-index 用全集下标 */
const previewUrls = computed(() => visible.value.map((i) => toDisplaySrc(i.url)))

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function persist(): void {
  if (!restored.value) return
  saveSettings(storage(), props.stateKey, {
    sourceId: sourceId.value,
    targets: { ...(targetCache[props.stateKey] ?? {}), [sourceId.value]: { ...target.value } },
    tab: tab.value,
  })
  targetCache[props.stateKey] = { ...(targetCache[props.stateKey] ?? {}), [sourceId.value]: { ...target.value } }
}

/** 模块内只做缓存镜像；真正持久化在 localStorage，按 stateKey 隔离 */
const targetCache: Record<string, Record<string, RichTextImageTarget>> = {}

async function loadSources(): Promise<void> {
  loadingSources.value = true
  try {
    const list = await props.library.sources()
    sources.value = sortSourcesByDefault(list)
  } catch (err) {
    ElMessage.error(`读取图床来源失败：${(err as Error).message}`)
  } finally {
    loadingSources.value = false
  }
}

async function loadDirKeys(): Promise<void> {
  const source = activeSource.value
  if (!source) return
  try {
    // 不传专属项：拿到来源根路径的多级目录结构；失败静默（手输仍可用）
    dirKeys.value = (await props.library.list(source, {})).map((i) => i.key ?? i.name ?? '')
  } catch {
    dirKeys.value = []
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    restored.value = false
    // 每次重新打开是新一轮会话：重置上传缓存与选择池
    uploaded.value = []
    for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
    uploadTasks.value = []
    stopProgressTimer()
    pool.value = {}
    items.value = []
    keyword.value = ''
    renderedCount.value = PAGE_SIZE
    await loadSources()
    const saved = loadSettings(storage(), props.stateKey)
    targetCache[props.stateKey] = saved?.targets ?? {}
    sourceId.value = defaultSourceId(sources.value, saved?.sourceId)
    target.value = { ...(targetCache[props.stateKey]?.[sourceId.value] ?? {}) }
    tab.value = saved?.tab ?? 'upload'
    // 设置恢复后再打开写回监听，防止空值落盘覆盖
    await nextTick()
    restored.value = true
    void loadDirKeys()
    if (tab.value === 'gallery') await loadGallery()
  },
)

let sourceWatchBusy = false
watch(sourceId, async (id) => {
  if (!restored.value || sourceWatchBusy) return
  target.value = { ...(targetCache[props.stateKey]?.[id] ?? {}) }
  items.value = [] // 仅清当前列表；统一选择池保留，跨来源累积
  dirKeys.value = []
  renderedCount.value = PAGE_SIZE
  persist()
  void loadDirKeys()
  if (tab.value === 'gallery') await loadGallery()
})

/** 图库页改桶/目录后自动重列（防抖，避免逐字输入时反复请求） */
let galleryReloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleGalleryReload(): void {
  if (!props.open || !restored.value || tab.value !== 'gallery') return
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  galleryReloadTimer = setTimeout(() => { galleryReloadTimer = null; void loadGallery() }, 300)
}

watch(target, () => {
  persist()
  scheduleGalleryReload()
}, { deep: true })
watch(tab, async (v) => {
  persist()
  renderedCount.value = PAGE_SIZE
  if (v === 'gallery' && props.open && restored.value) await loadGallery()
})
watch(keyword, () => { renderedCount.value = PAGE_SIZE })

function close(): void {
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  galleryReloadTimer = null
  emit('update:open', false)
}

onBeforeUnmount(() => {
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  stopProgressTimer()
  for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
})

function esc(url: string): string {
  return url.replace(/"/g, '%22')
}

/** 插入图片：显示层用 localres（本地 file:// 预览契约），回写存储由 onChange 统一转回 */
function insertUrls(urls: string[]): void {
  const editor = props.editor
  if (!editor || urls.length === 0) return
  editor.focus()
  editor.dangerouslyInsertHtml(urls.map((u) => `<img src="${esc(toDisplaySrc(u))}" alt=""/>`).join(''))
  pool.value = {}
  uploaded.value = []
  close()
  ElMessage.success(`已插入 ${urls.length} 张图片`)
}

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

/** 进度爬升定时器：Provider 无 byte 级上报，上传中让百分比平滑推进到 90，完成由回调置 100 */
let progressTimer: ReturnType<typeof setInterval> | null = null
function ensureProgressTimer(): void {
  if (progressTimer) return
  progressTimer = setInterval(() => {
    for (const t of uploadTasks.value) {
      if (t.status === 'uploading' && t.percent < 90) t.percent = Math.min(90, t.percent + 3)
    }
  }, 220)
}
function stopProgressTimer(): void {
  if (!progressTimer) return
  clearInterval(progressTimer)
  progressTimer = null
}

/** 执行一次上传任务：更新单项状态/进度，成功后并入 uploaded 与选择池；失败留给 UI 重试/删除 */
async function runUpload(task: UploadTask): Promise<boolean> {
  task.status = 'uploading'
  task.percent = 0
  task.error = undefined
  ensureProgressTimer()
  try {
    const url = await props.library.upload(task.file, task.source, task.target, (p) => {
      if (p.status === 'success') task.percent = 100
    })
    task.url = url
    task.percent = 100
    task.status = 'success'
    const item: PoolItem = { url, key: task.name, name: task.name, origin: 'upload', scope: task.scope }
    uploaded.value.push(item)
    addToPool(item) // 上传即默认选中，可在预览里取消
    return true
  } catch (err) {
    task.status = 'failed'
    task.error = (err as Error).message || String(err)
    return false
  }
}

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const source = activeSource.value
  if (!source || files.length === 0) return
  const scope = currentScope.value
  for (const file of files) {
    const task: UploadTask = {
      id: ++uploadSeq, file, name: file.name, status: 'uploading', percent: 0,
      size: file.size, previewUrl: URL.createObjectURL(file),
      scope, source, target: { ...target.value },
    }
    uploadTasks.value.push(task)
  }
  uploading.value = true
  const results = await Promise.all(uploadTasks.value.filter((t) => t.status === 'uploading').map((t) => runUpload(t)))
  uploading.value = false
  stopProgressTimer()
  const ok = results.filter(Boolean).length
  const failed = results.length - ok
  if (ok > 0) ElMessage.success(`${ok} 张已上传并选中，切到图库可继续挑选，最后一并插入`)
  if (failed > 0) ElMessage.warning(`${failed} 张上传失败，可在上传列表中重试或删除`)
}

/** 重试单个失败任务（沿用原文件与来源/目录） */
async function retryUpload(task: UploadTask): Promise<void> {
  const ok = await runUpload(task)
  if (!uploadInProgress.value) stopProgressTimer()
  if (ok) ElMessage.success(`「${task.name}」已重新上传并选中`)
  else ElMessage.error(`「${task.name}」重试失败：${task.error}`)
}

/** 删除单个任务：成功的同步从上传列表/选择池移除，失败的直接移出任务列表 */
function removeUploadTask(task: UploadTask): void {
  if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
  uploadTasks.value = uploadTasks.value.filter((t) => t.id !== task.id)
  if (task.status === 'success' && task.url) {
    uploaded.value = uploaded.value.filter((i) => itemKey(i) !== task.url)
    removePoolKey(task.url!)
  }
  if (!uploadInProgress.value) stopProgressTimer()
}

function removeUploaded(item: PoolItem): void {
  const k = itemKey(item)
  uploaded.value = uploaded.value.filter((i) => itemKey(i) !== k)
  removePoolKey(k)
}

/** 只删除「本次上传且已选」的项，未选中的上传图保留 */
function removeSelectedUploaded(): void {
  const removed = uploaded.value.filter(isSelected)
  if (removed.length === 0) return
  for (const i of removed) removePoolKey(itemKey(i))
  const keys = new Set(removed.map(itemKey))
  uploaded.value = uploaded.value.filter((i) => !keys.has(itemKey(i)))
  ElMessage.success(`已删除 ${removed.length} 张未插入图片`)
}

/** 全选/全不选/反选作用于「当前可见集合」，不清空其他 tab / 目录 / 源已选的项 */
function selectAllVisible(v: boolean): void {
  for (const i of visible.value) {
    if (v) addToPool(i)
    else removeFromPool(i)
  }
}
function invertVisible(): void {
  for (const i of visible.value) togglePool(i)
}

/** 插入统一选择池中的全部图片（跨 tab / 目录 / 源 / 桶） */
function insertSelected(): void {
  insertUrls(poolList.value.map((i) => i.url))
}

async function loadGallery(): Promise<void> {
  const source = activeSource.value
  if (!source) return
  loadingList.value = true
  renderedCount.value = PAGE_SIZE
  try {
    // 不清空 pool：重选目录得到新列表后，此前已选仍保留，可继续累积
    items.value = await props.library.list(source, target.value, FETCH_LIMIT)
  } catch (err) {
    items.value = []
    ElMessage.error(`读取图库失败：${(err as Error).message}`)
  } finally {
    loadingList.value = false
  }
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
    class="image-library-dialog"
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
        <span class="lib-title">图片库</span>
        <div class="lib-top">
          <div class="lib-row lib-row-source">
            <el-select v-model="sourceId" placeholder="选择图床来源（默认优先云）" class="source-select" :loading="loadingSources">
              <el-option v-for="s in sources" :key="s.id" :value="s.id" :label="s.label" />
            </el-select>
            <el-radio-group v-model="tab" class="mode-tabs">
              <el-radio-button value="upload">上传图片</el-radio-button>
              <el-radio-button value="gallery">从图库选择</el-radio-button>
            </el-radio-group>
          </div>
          <div class="lib-row lib-row-target">
            <el-input v-if="showBucket" v-model="target.bucket" placeholder="桶 / 容器（留空用 profile 默认）" class="bucket-input" />
            <el-cascader
              v-model="dirModel"
              :options="dirTree"
              :props="{ checkStrictly: true, emitPath: false, expandTrigger: 'hover' }"
              filterable
              clearable
              class="dir-cascader"
              :placeholder="showBucket ? '目录前缀（逐级选或手输）' : typeOf === 'remote' ? '远程目录（逐级选或手输）' : '本地目录（逐级选或手输）'"
            />
            <el-input v-model="dirModel" clearable class="dir-manual" placeholder="或手输目录" />
          </div>
          <div class="lib-row lib-row-actions">
            <span class="lib-count">已选 {{ poolCount }} 张（上传 {{ uploadPicked }} · 图库 {{ galleryPicked }}）</span>
            <el-input v-model="keyword" clearable class="search-input" placeholder="搜索文件名" />
            <el-button size="small" @click="selectAllVisible(true)">全选本页</el-button>
            <el-button size="small" @click="selectAllVisible(false)">全不选</el-button>
            <el-button size="small" @click="invertVisible">反选本页</el-button>
            <el-button v-if="tab === 'gallery'" size="small" :loading="loadingList" @click="loadGallery">刷新</el-button>
            <el-button v-else size="small" :disabled="uploadPicked === 0" @click="removeSelectedUploaded">删除所选</el-button>
            <span class="lib-action-gap" />
            <el-button size="small" @click="uploadMore">继续上传</el-button>
            <el-button size="small" type="primary" :disabled="poolCount === 0" @click="insertSelected">插入所选{{ poolCount ? ` ${poolCount} 张` : '' }}</el-button>
          </div>
        </div>
      </div>
    </template>
    <input ref="uploadInput" type="file" accept="image/*" multiple class="hidden-input" @change="onFilesChosen" />

    <!-- 跨 tab / 源 / 桶 / 目录的已选总清单：切走后仍能查看与移除任一项 -->
    <div v-if="poolCount" class="pool-summary">
      <div class="pool-summary-head" @click="poolExpanded = !poolExpanded">
        <span class="pool-caret">{{ poolExpanded ? '▾' : '▸' }}</span>
        <span>已选清单 · {{ poolCount }} 张（跨源/桶/目录累积，均为待插入）</span>
        <el-button size="small" text type="danger" @click.stop="clearPool">清空</el-button>
      </div>
      <div v-if="poolExpanded" class="pool-items">
        <div v-for="(item, k) in pool" :key="k" class="pool-item">
          <el-image :src="toDisplaySrc(item.url)" fit="cover" class="pool-thumb" loading="lazy" :preview-src-list="previewPoolUrls" :initial-index="poolList.findIndex((p) => itemKey(p) === k)" :preview-teleported="true">
            <template #error>
              <div class="img-fallback" title="图片加载失败">
                <svg class="img-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15.5 16 11 7 20" />
                  <path d="M4 4 20 20" class="img-fallback-slash" />
                </svg>
                <span class="img-fallback-text">图片不可用</span>
              </div>
            </template>
          </el-image>
          <div class="pool-meta">
            <div class="pool-name">{{ item.name || item.key || item.url }}</div>
            <div class="pool-scope">{{ scopeLabel(item.scope) }}</div>
          </div>
          <el-button size="small" text class="pool-remove" @click="removePoolKey(k)">移除</el-button>
        </div>
      </div>
    </div>

    <div class="lib-pane" @scroll="onPaneScroll">
      <!-- 上传总体进度：任务数 + 成功/失败 + 汇总进度条 -->
      <div v-if="uploadTotal" class="upload-progress-bar">
        <div class="up-summary">
          <span>上传进度 {{ uploadDone }}/{{ uploadTotal }} · 成功 {{ uploadSucceeded }} · 失败 {{ uploadFailed }}</span>
          <el-button size="small" text @click="uploadTasks = uploadTasks.filter((t) => t.status === 'uploading')">清除已完成</el-button>
        </div>
        <el-progress :percentage="overallPercent" :status="uploadFailed && !uploadInProgress ? 'exception' : uploadDone === uploadTotal ? 'success' : undefined" :stroke-width="8" />
      </div>
      <div v-if="tab === 'upload'" class="drop-hint" :class="{ busy: uploading }" @click="pickFiles">
        <div class="drop-main">{{ uploading ? '上传中…' : '点击选择图片（可多选）' }}</div>
        <div class="drop-sub">上传后先预览、可删除/点开查看；切到图库可继续挑选，最后一并插入</div>
      </div>
      <div v-if="visible.length || (tab === 'upload' && activeUploadTasks.length)" class="thumb-grid">
        <!-- 上传中/失败任务：缩略图上叠进度/状态，卡片底部放重试与删除 -->
        <div
          v-for="task in activeUploadTasks"
          :key="'task-' + task.id"
          class="thumb-cell task-cell"
          :class="'st-' + task.status"
          :title="task.status === 'failed' ? task.error : task.name"
        >
          <div class="task-thumb">
            <img
              v-if="task.previewUrl && !task.previewFailed"
              :src="task.previewUrl"
              :alt="task.name"
              @error="task.previewFailed = true"
            />
            <span v-else class="task-thumb-ph" title="图片预览不可用">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15.5 16 11 7 20" />
              </svg>
            </span>
            <span v-if="task.status === 'failed'" class="task-thumb-state">!</span>
            <el-progress
              v-if="task.status === 'uploading'"
              class="task-thumb-progress"
              :percentage="task.percent"
              :stroke-width="4"
              :show-text="false"
            />
          </div>
          <div class="thumb-name">{{ task.name }}</div>
          <div class="task-meta">
            <span class="task-status" :class="'st-' + task.status">
              {{ task.status === 'uploading' ? `上传中 ${task.percent}%` : '上传失败' }}
            </span>
          </div>
          <div class="task-ops">
            <el-button v-if="task.status === 'failed'" size="small" type="primary" link @click="retryUpload(task)">重试</el-button>
            <el-button size="small" type="danger" link @click="removeUploadTask(task)">删除</el-button>
          </div>
        </div>
        <div v-for="item in rendered" :key="itemKey(item)" class="thumb-cell" :class="{ picked: isSelected(item) }">
          <el-checkbox :model-value="isSelected(item)" class="thumb-check" @change="togglePool(item)" @click.stop />
          <el-image
            :src="toDisplaySrc(item.url)"
            fit="cover"
            loading="lazy"
            class="thumb-img"
            :preview-src-list="previewUrls"
            :initial-index="visible.indexOf(item)"
            :preview-teleported="true"
            @click.stop
          >
            <template #error>
              <div class="img-fallback" title="图片加载失败">
                <svg class="img-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15.5 16 11 7 20" />
                  <path d="M4 4 20 20" class="img-fallback-slash" />
                </svg>
                <span class="img-fallback-text">图片不可用</span>
              </div>
            </template>
          </el-image>
          <div class="thumb-name">{{ item.name || item.key }}</div>
          <span v-if="item.origin === 'upload'" class="thumb-badge">本次上传</span>
          <el-button v-if="item.origin === 'upload'" size="small" text class="thumb-remove" @click.stop="removeUploaded(item)">删除</el-button>
        </div>
      </div>
      <div v-else class="gallery-empty">
        {{ tab === 'upload'
          ? (keyword ? '无匹配图片' : '尚未上传；上传后在此预览，不会立即插入正文')
          : (loadingList ? '读取中…' : (keyword ? '无匹配图片' : '暂无图片，点「刷新列表」或先上传几张')) }}
      </div>
      <div v-if="renderedCount < visible.length" class="load-more">已显示 {{ rendered.length }} / {{ visible.length }}，滚动继续加载</div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 工具栏已移入 header：标题 + 三行高频操作区，结构上不随内容滚动 */
.lib-header { padding-right: 28px; }
.lib-title { display: block; font-size: 18px; font-weight: 600; line-height: 24px; margin-bottom: 12px; }
.lib-top { border-bottom: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); padding-bottom: 10px; }
.lib-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lib-row:last-child { margin-bottom: 0; }
.source-select { flex: 1 1 auto; }
.mode-tabs { flex: 0 0 auto; }
.bucket-input { flex: 0 0 220px; }
.dir-cascader { flex: 0 1 240px; min-width: 0; }
.dir-manual { flex: 1 1 auto; min-width: 0; }
.search-input { flex: 0 0 150px; }
.hidden-input { display: none; }
.lib-row-actions { flex-wrap: wrap; gap: 6px; }
.lib-count { font-size: 12px; opacity: 0.75; margin-right: 2px; }
.lib-action-gap { flex: 1 1 12px; }
.drop-hint {
  border: 1px dashed rgba(128, 128, 128, 0.45);
  border-radius: 8px;
  padding: 16px 14px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 10px;
}
.drop-hint:hover { border-color: var(--el-color-primary); }
.drop-hint.busy { opacity: 0.6; cursor: wait; }
/* 上传总体进度条 */
.upload-progress-bar { border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
.up-summary { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
/* 上传中/失败任务卡片：与成功缩略图同网格，进度直接叠在图片上 */
.task-cell { border-color: var(--sshk-border, rgba(128, 128, 128, 0.3)); }
.task-cell.st-failed { border-color: var(--el-color-danger); }
.task-thumb { position: relative; width: 100%; height: 80px; border-radius: 4px; overflow: hidden; background: rgba(128, 128, 128, 0.1); }
.task-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.task-thumb-ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--el-text-color-placeholder); opacity: 0.4; }
.task-thumb-state { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; display: grid; place-items: center; font-size: 12px; color: #fff; background: var(--el-color-danger); border-radius: 50%; }
.task-thumb-progress { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 3px 3px; }
.task-meta { margin-top: 2px; }
.task-status { font-size: 10px; }
.task-status.st-uploading { color: var(--el-color-primary); }
.task-status.st-failed { color: var(--el-color-danger); }
.task-ops { display: flex; justify-content: center; gap: 4px; margin-top: 2px; }
.task-ops .el-button { padding: 2px 4px; height: auto; font-size: 11px; }
.pool-summary { flex: 0 1 auto; min-height: 0; max-height: 38%; display: flex; flex-direction: column; border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); border-radius: 6px; margin-bottom: 10px; }
.pool-summary-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.pool-caret { opacity: 0.7; }
.pool-summary-head > span:nth-child(2) { flex: 1 1 auto; }
.pool-items { flex: 1 1 auto; min-height: 0; overflow-y: auto; border-top: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.2)); padding: 6px 10px; }
.pool-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.pool-thumb { width: 42px; height: 34px; border-radius: 3px; flex: 0 0 auto; cursor: zoom-in; }
.pool-meta { flex: 1 1 auto; min-width: 0; }
.pool-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pool-scope { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pool-remove { flex: 0 0 auto; }
.drop-main { font-size: 14px; }
.drop-sub { font-size: 12px; opacity: 0.6; margin-top: 5px; }
.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.thumb-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  text-align: center;
}
.thumb-cell.picked { border-color: var(--el-color-primary); background: rgba(64, 158, 255, 0.08); }
.thumb-check { position: absolute; top: 6px; left: 6px; z-index: 2; background: rgba(255, 255, 255, 0.82); border-radius: 3px; }
.thumb-img { width: 100%; height: 80px; border-radius: 4px; display: block; cursor: zoom-in; }
/* 图片加载失败：统一柔和占位（替代 Element Plus 默认 FAILED 与生硬的「裂图」文案） */
.img-fallback {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px;
  color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
.img-fallback-icon { width: 26px; height: 26px; opacity: 0.7; }
.img-fallback-slash { opacity: 0.45; }
.img-fallback-text { font-size: 11px; line-height: 1; }
.pool-thumb .img-fallback-icon { width: 18px; height: 18px; }
.pool-thumb .img-fallback-text { display: none; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; }
.thumb-badge { display: block; font-size: 10px; color: var(--el-color-primary); }
.thumb-remove { margin-top: -4px; }
.gallery-empty { text-align: center; padding: 28px 0; font-size: 13px; opacity: 0.6; }
.load-more { text-align: center; padding: 10px 0 2px; font-size: 12px; opacity: 0.6; }

/* 整个弹框（含 header 工具栏 + footer）占应用视口约 75%，body 用 flex 吃掉 header 之外的剩余 */
:global(.image-library-dialog) {
  height: 75vh;
  min-height: 460px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.image-library-dialog .el-dialog__header) { flex: 0 0 auto; }
:global(.image-library-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px !important;
}
:global(.image-library-dialog .el-dialog__footer) { flex: 0 0 auto; }
/* 缩略图区占满剩余高度并单独滚动；已选清单用 flex-basis 受自身 max-height 约束后单独滚动 */
.lib-pane { flex: 1 1 auto; min-height: 120px; padding-right: 4px; }
</style>
