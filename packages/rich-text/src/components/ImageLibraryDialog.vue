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

/** 选择池条目：origin 区分本次上传（可删）与图库已有（不可删） */
interface PoolItem extends RichTextImageItem {
  key?: string
  origin: 'upload' | 'gallery'
}

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
/** 图库已列图片 */
const items = ref<RichTextImageItem[]>([])
const loadingList = ref(false)
/** 目录下拉的候选 key：打开弹窗/切来源时静默列一次，派生级联树 */
const dirKeys = ref<string[]>([])
/** 文件名搜索关键词 */
const keyword = ref('')
/** 已渲染数量（分批渲染） */
const renderedCount = ref(PAGE_SIZE)

/** 统一选择池：key = url（同一图片只算一次），跨 tab / 目录 / 来源累积 */
const pool = ref<Record<string, PoolItem>>({})
const poolCount = computed(() => Object.keys(pool.value).length)
const uploadPicked = computed(() => Object.values(pool.value).filter((i) => i.origin === 'upload').length)
const galleryPicked = computed(() => Object.values(pool.value).filter((i) => i.origin === 'gallery').length)
const isSelected = (url: string): boolean => Boolean(pool.value[url])
function addToPool(item: PoolItem): void {
  if (!item.url) return
  pool.value[item.url] = item
}
function removeFromPool(url: string): void {
  if (!pool.value[url]) return
  const next = { ...pool.value }
  delete next[url]
  pool.value = next
}
function togglePool(item: PoolItem): void {
  if (isSelected(item.url)) removeFromPool(item.url)
  else addToPool(item)
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
/** 级联目录树：从已列图片 key 派生，每层 value 为完整路径 */
const dirTree = computed<DirectoryTreeNode[]>(() => directoryTree(dirKeys.value))

/** 图库页可见项：本次上传优先（标 upload），后端列图去重补充，再按文件名过滤 */
const galleryView = computed<PoolItem[]>(() => {
  const map = new Map<string, PoolItem>()
  for (const u of uploaded.value) map.set(u.url, u)
  for (const it of items.value) if (!map.has(it.url)) map.set(it.url, { ...it, origin: 'gallery' })
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

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const source = activeSource.value
  if (!source || files.length === 0) return
  uploading.value = true
  let ok = 0
  for (const file of files) {
    try {
      const url = await props.library.upload(file, source, target.value)
      const item: PoolItem = { url, key: file.name, name: file.name, origin: 'upload' }
      uploaded.value.push(item)
      addToPool(item) // 上传即默认选中，可在预览里取消
      ok += 1
    } catch (err) {
      ElMessage.error(`「${file.name}」上传失败：${(err as Error).message}`)
    }
  }
  uploading.value = false
  if (ok > 0) ElMessage.success(`${ok} 张已上传并选中，切到图库可继续挑选，最后一并插入`)
}

function removeUploaded(url: string): void {
  uploaded.value = uploaded.value.filter((i) => i.url !== url)
  removeFromPool(url)
}

function removeSelectedUploaded(): void {
  const removed = uploaded.value.filter((i) => isSelected(i.url))
  if (removed.length === 0) return
  for (const i of removed) removeFromPool(i.url)
  uploaded.value = uploaded.value.filter((i) => !isSelected(i.url))
  ElMessage.success(`已删除 ${removed.length} 张未插入图片`)
}

/** 全选/全不选/反选作用于「当前可见集合」，不清空其他 tab / 目录已选的项 */
function selectAllVisible(v: boolean): void {
  for (const i of visible.value) {
    if (v) addToPool(i)
    else removeFromPool(i.url)
  }
}
function invertVisible(): void {
  for (const i of visible.value) togglePool(i)
}

/** 插入统一选择池中的全部图片（跨 tab / 目录 / 来源） */
function insertSelected(): void {
  const urls = Object.keys(pool.value)
  insertUrls(urls)
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
    title="图片库"
    width="820px"
    top="4vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <input ref="uploadInput" type="file" accept="image/*" multiple class="hidden-input" @change="onFilesChosen" />
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

    <div class="lib-pane" @scroll="onPaneScroll">
      <div v-if="tab === 'upload'" class="drop-hint" :class="{ busy: uploading }" @click="pickFiles">
        <div class="drop-main">{{ uploading ? '上传中…' : '点击选择图片（可多选）' }}</div>
        <div class="drop-sub">上传后先预览、可删除/点开查看；切到图库可继续挑选，最后一并插入</div>
      </div>
      <div v-if="visible.length" class="thumb-grid">
        <div v-for="item in rendered" :key="item.url" class="thumb-cell" :class="{ picked: isSelected(item.url) }">
          <el-checkbox :model-value="isSelected(item.url)" class="thumb-check" @change="togglePool(item)" @click.stop />
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
            <template #error><div class="img-err">裂图</div></template>
          </el-image>
          <div class="thumb-name">{{ item.name || item.key }}</div>
          <span v-if="item.origin === 'upload'" class="thumb-badge">本次上传</span>
          <el-button v-if="item.origin === 'upload'" size="small" text class="thumb-remove" @click.stop="removeUploaded(item.url)">删除</el-button>
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
.lib-top { border-bottom: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); padding-bottom: 10px; margin-bottom: 10px; }
.lib-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lib-row:last-child { margin-bottom: 0; }
.source-select { flex: 1 1 auto; }
.mode-tabs { flex: 0 0 auto; }
.bucket-input { flex: 0 0 220px; }
.dir-cascader { flex: 1 1 auto; min-width: 0; }
.dir-manual { flex: 0 0 150px; }
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
.img-err { width: 100%; height: 80px; display: flex; align-items: center; justify-content: center; font-size: 12px; opacity: 0.5; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; }
.thumb-badge { display: block; font-size: 10px; color: var(--el-color-primary); }
.thumb-remove { margin-top: -4px; }
.gallery-empty { text-align: center; padding: 28px 0; font-size: 13px; opacity: 0.6; }
.load-more { text-align: center; padding: 10px 0 2px; font-size: 12px; opacity: 0.6; }

/* 弹框限高：工具栏/操作栏固定，只有图片网格区域滚动 */
:global(.image-library-dialog) .el-dialog__body { max-height: calc(100vh - 190px) !important; overflow: hidden !important; padding: 16px 20px !important; }
.lib-pane { max-height: calc(100vh - 310px); overflow-y: auto; padding-right: 4px; }
</style>
