<script setup lang="ts">
/**
 * 图片库弹窗（用户需求 2026-11-16 ④⑤ / 2026-11-17 ①~⑦）：
 * - 来源：本地（应用默认目录）/ 远程 profile / 云 profile，由工具侧注入 sources()
 * - 默认来源优先级：云 → 远程 → 本地；来源/桶/多级目录设置按 stateKey 持久化，重启与切页回显
 * - 上传后不直接插入：缩略图预览（点击放大）、删除、全选/反选，仅插入已选或全部插入
 * - 切到「从图库选择」自动列图；缩略图点击放大与复选分离
 * - 目录：多级完整路径可选，也可手输不存在的目录；弹框限高，仅图片区滚动
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import type { RichTextImageItem, RichTextImageLibrary, RichTextImageSource, RichTextImageTarget } from '../types'
import { toDisplaySrc } from '../display'
import {
  defaultSourceId,
  directoriesFromKeys,
  loadSettings,
  saveSettings,
  sortSourcesByDefault,
} from '../image-library-settings'

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

const tab = ref<'upload' | 'gallery'>('upload')
const sources = ref<RichTextImageSource[]>([])
const sourceId = ref('')
const target = ref<RichTextImageTarget>({})
const loadingSources = ref(false)
/** 设置恢复完成前不写回，避免空状态覆盖已存值 */
const restored = ref(false)

const uploading = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
/** 上传结果先留在弹窗里预览，确认后才插入 */
const uploaded = ref<(RichTextImageItem & { key?: string; selected: boolean })[]>([])
/** 图片放大用：el-image-viewer 的 preview-src-list + initial-index */
const previewUrls = ref<string[]>([])
const previewIndex = ref(0)

const loadingList = ref(false)
const items = ref<RichTextImageItem[]>([])
const gallerySelected = ref<Set<string>>(new Set())
/** 目录下拉的候选 key：打开弹窗/切来源时静默列一次，避免先切图库才有多级选项 */
const dirKeys = ref<string[]>([])

const activeSource = computed(() => sources.value.find((s) => s.id === sourceId.value) ?? null)
const typeOf = computed(() => activeSource.value?.type ?? 'cloud')
const showBucket = computed(() => typeOf.value === 'cloud')
/** 目录（云前缀 / 远程路径 / 本地目录）统一用完整路径字符串，支持多级与手输 */
const dirModel = computed({
  get: () => target.value.prefix || target.value.remotePath || target.value.localDir || '',
  set: (v: string) => {
    if (typeOf.value === 'cloud') target.value = { ...target.value, prefix: v }
    else if (typeOf.value === 'remote') target.value = { ...target.value, remotePath: v }
    else target.value = { ...target.value, localDir: v }
  },
})
/** 从已列图片 key 派生的多级目录完整路径（可手输不存在的目录） */
const dirOptions = computed(() => {
  const keys: string[] = [
    ...dirKeys.value,
    ...items.value.map((i) => i.key ?? i.name ?? ''),
    ...uploaded.value.map((i) => i.key ?? i.name ?? ''),
  ]
  return directoriesFromKeys(keys.filter((k): k is string => Boolean(k)))
})

/** 列表变化时同步放大预览源，保证首击即可放大（el-image 依赖 preview-src-list 已就位） */
watch(uploaded, (list) => { if (tab.value === 'upload') previewUrls.value = list.map((i) => toDisplaySrc(i.url)) }, { deep: true })
watch(items, (list) => { if (tab.value === 'gallery') previewUrls.value = list.map((i) => toDisplaySrc(i.url)) })

const uploadedSelectedCount = computed(() => uploaded.value.filter((i) => i.selected).length)
const gallerySelectedCount = computed(() => gallerySelected.value.size)

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
    uploaded.value = []
    previewUrls.value = []
    gallerySelected.value = new Set()
    items.value = []
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
  items.value = []
  gallerySelected.value = new Set()
  dirKeys.value = []
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
  if (v === 'gallery' && props.open && restored.value) await loadGallery()
})

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
      uploaded.value.push({
        url,
        key: file.name,
        name: file.name,
        selected: true,
      })
      ok += 1
    } catch (err) {
      ElMessage.error(`「${file.name}」上传失败：${(err as Error).message}`)
    }
  }
  uploading.value = false
  if (ok > 0) ElMessage.success(`${ok} 张已上传，确认预览后再插入`)
}

function previewUploaded(index: number): void {
  previewUrls.value = uploaded.value.map((i) => toDisplaySrc(i.url))
  previewIndex.value = index
}

function previewGallery(index: number): void {
  previewUrls.value = items.value.map((i) => toDisplaySrc(i.url))
  previewIndex.value = index
}

function removeUploaded(url: string): void {
  uploaded.value = uploaded.value.filter((i) => i.url !== url)
  previewUrls.value = []
}

function selectAllUploaded(v: boolean): void {
  uploaded.value.forEach((i) => { i.selected = v })
}

function invertUploaded(): void {
  uploaded.value.forEach((i) => { i.selected = !i.selected })
}

function removeSelectedUploaded(): void {
  const removed = uploaded.value.filter((i) => i.selected)
  if (removed.length === 0) return
  uploaded.value = uploaded.value.filter((i) => !i.selected)
  previewUrls.value = []
  ElMessage.success(`已删除 ${removed.length} 张未插入图片`)
}

function insertUploaded(all: boolean): void {
  const urls = uploaded.value.filter((i) => all || i.selected).map((i) => i.url)
  insertUrls(urls)
}

async function loadGallery(): Promise<void> {
  const source = activeSource.value
  if (!source) return
  loadingList.value = true
  gallerySelected.value = new Set()
  try {
    items.value = await props.library.list(source, target.value)
  } catch (err) {
    items.value = []
    ElMessage.error(`读取图库失败：${(err as Error).message}`)
  } finally {
    loadingList.value = false
  }
}

function toggleGallery(url: string): void {
  const next = new Set(gallerySelected.value)
  if (next.has(url)) next.delete(url)
  else next.add(url)
  gallerySelected.value = next
}

function selectAllGallery(v: boolean): void {
  gallerySelected.value = v ? new Set(items.value.map((i) => i.url)) : new Set()
}

function invertGallery(): void {
  const next = new Set<string>()
  items.value.forEach((i) => { if (!gallerySelected.value.has(i.url)) next.add(i.url) })
  gallerySelected.value = next
}

function insertGallery(all: boolean): void {
  const urls = items.value.filter((i) => all || gallerySelected.value.has(i.url)).map((i) => i.url)
  insertUrls(urls)
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
        <el-select
          v-model="dirModel"
          filterable
          allow-create
          clearable
          default-first-option
          :placeholder="showBucket ? '目录前缀（选多级路径或手输，如 blog/2026）' : typeOf === 'remote' ? '远程目录（选多级路径或手输）' : '本地目录（选多级路径或手输）'"
          class="dir-select"
        >
          <el-option v-for="dir in dirOptions" :key="dir" :value="dir" :label="dir" />
        </el-select>
      </div>
      <div class="lib-row lib-row-actions">
        <span class="lib-count">
          {{ tab === 'upload' ? `已上传 ${uploaded.length} 张 · 已选 ${uploadedSelectedCount} 张` : `图库 ${items.length} 张 · 已选 ${gallerySelectedCount} 张` }}
        </span>
        <el-button size="small" @click="tab === 'upload' ? selectAllUploaded(true) : selectAllGallery(true)">全选</el-button>
        <el-button size="small" @click="tab === 'upload' ? selectAllUploaded(false) : selectAllGallery(false)">全不选</el-button>
        <el-button size="small" @click="tab === 'upload' ? invertUploaded() : invertGallery()">反选</el-button>
        <el-button v-if="tab === 'gallery'" size="small" :loading="loadingList" @click="loadGallery">刷新</el-button>
        <el-button v-else size="small" :disabled="uploadedSelectedCount === 0" @click="removeSelectedUploaded">删除所选</el-button>
        <span class="lib-action-gap" />
        <el-button size="small" @click="uploadMore">继续上传</el-button>
        <el-button
          size="small"
          type="primary"
          :disabled="tab === 'upload' ? uploadedSelectedCount === 0 : gallerySelectedCount === 0"
          @click="tab === 'upload' ? insertUploaded(false) : insertGallery(false)"
        >插入所选</el-button>
        <el-button v-if="tab === 'upload'" size="small" type="primary" :disabled="uploaded.length === 0" @click="insertUploaded(true)">全部插入</el-button>
      </div>
    </div>

    <div v-if="tab === 'upload'" class="lib-pane">
      <div class="drop-hint" :class="{ busy: uploading }" @click="pickFiles">
        <div class="drop-main">{{ uploading ? '上传中…' : '点击选择图片（可多选）' }}</div>
        <div class="drop-sub">上传后先预览、可删除/点开查看，确认无误再选择插入</div>
      </div>
      <div v-if="uploaded.length" class="thumb-grid">
        <div v-for="(item, index) in uploaded" :key="item.url" class="thumb-cell" :class="{ picked: item.selected }">
          <el-checkbox v-model="item.selected" class="thumb-check" @click.stop />
          <el-image :src="toDisplaySrc(item.url)" fit="cover" class="thumb-img" :preview-src-list="previewUrls" :initial-index="index" @click="previewUploaded(index)">
            <template #error><div class="img-err">裂图</div></template>
          </el-image>
          <div class="thumb-name">{{ item.name }}</div>
          <el-button size="small" text class="thumb-remove" @click.stop="removeUploaded(item.url)">删除</el-button>
        </div>
      </div>
      <div v-else class="gallery-empty">尚未上传；上传后在此预览，不会立即插入正文</div>
    </div>

    <div v-else class="lib-pane">
      <div v-if="items.length" class="thumb-grid">
        <div v-for="(item, index) in items" :key="item.url" class="thumb-cell" :class="{ picked: gallerySelected.has(item.url) }">
          <el-checkbox :model-value="gallerySelected.has(item.url)" class="thumb-check" @change="toggleGallery(item.url)" @click.stop />
          <el-image :src="toDisplaySrc(item.url)" fit="cover" class="thumb-img" :preview-src-list="previewUrls" :initial-index="index" @click="previewGallery(index)">
            <template #error><div class="img-err">裂图</div></template>
          </el-image>
          <div class="thumb-name">{{ item.name }}</div>
        </div>
      </div>
      <div v-else class="gallery-empty">{{ loadingList ? '读取中…' : '暂无图片，点「刷新列表」或先上传几张' }}</div>
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
.bucket-input { flex: 0 0 240px; }
.dir-select { flex: 1 1 auto; min-width: 0; }
.hidden-input { display: none; }
.lib-row-actions { flex-wrap: wrap; gap: 6px; }
.lib-count { font-size: 12px; opacity: 0.75; margin-right: 4px; }
.lib-action-gap { flex: 1 1 20px; }
.drop-hint {
  border: 1px dashed rgba(128, 128, 128, 0.45);
  border-radius: 8px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.drop-hint:hover { border-color: var(--el-color-primary); }
.drop-hint.busy { opacity: 0.6; cursor: wait; }
.drop-main { font-size: 14px; }
.drop-sub { font-size: 12px; opacity: 0.6; margin-top: 6px; }
.selection-bar { display: flex; align-items: center; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.thumb-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  text-align: center;
}
.thumb-cell.picked { border-color: var(--el-color-primary); background: rgba(64, 158, 255, 0.08); }
.thumb-check { position: absolute; top: 6px; left: 6px; z-index: 2; background: rgba(255,255,255,0.82); border-radius: 3px; }
.thumb-img { width: 100%; height: 80px; border-radius: 4px; display: block; cursor: zoom-in; }
.img-err { width: 100%; height: 80px; display: flex; align-items: center; justify-content: center; font-size: 12px; opacity: 0.5; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; }
.thumb-remove { margin-top: -4px; }
.gallery-empty { text-align: center; padding: 28px 0; font-size: 13px; opacity: 0.6; }

/* 弹框限高：工具栏/操作栏固定，只有图片网格区域滚动 */
:global(.image-library-dialog) .el-dialog__body { max-height: calc(100vh - 190px) !important; overflow: hidden !important; padding: 16px 20px !important; }
.lib-pane { max-height: calc(100vh - 310px); overflow-y: auto; padding-right: 4px; }
</style>
