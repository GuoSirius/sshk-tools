<script setup lang="ts">
/**
 * 图片库弹窗（用户需求 2026-11-16 ④⑤）：
 * - 来源：本地（应用默认目录）/ 远程 profile / 云 profile，由工具侧注入 sources()
 * - 专属项：按来源类型露出 桶 / 前缀目录 / 远程路径 / 本地目录，留空走 profile 默认
 * - 两个动作：上传新图（可多选）→ 逐张插入；从图库列图 → 勾选插入
 * 弹窗挂在组件树内（非 body），跟随宿主暗色主题；本地 file:// 缩略图经 toDisplaySrc 转 localres。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { IDomEditor } from '@wangeditor/editor'
import type { RichTextImageItem, RichTextImageLibrary, RichTextImageSource, RichTextImageTarget } from '../types'
import { toDisplaySrc } from '../display'

const props = defineProps<{
  open: boolean
  editor: IDomEditor | null
  library: RichTextImageLibrary
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const tab = ref<'upload' | 'gallery'>('upload')
const sources = ref<RichTextImageSource[]>([])
const sourceId = ref('')
const target = ref<RichTextImageTarget>({})
const loadingSources = ref(false)

const uploading = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)

const loadingList = ref(false)
const items = ref<RichTextImageItem[]>([])
const selected = ref<Set<string>>(new Set())

const activeSource = computed(() => sources.value.find((s) => s.id === sourceId.value) ?? null)
const typeOf = computed(() => activeSource.value?.type ?? 'local')
const showRemotePath = computed(() => typeOf.value === 'remote')
const showBucket = computed(() => typeOf.value === 'cloud')

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    tab.value = 'upload'
    target.value = {}
    selected.value = new Set()
    items.value = []
    if (sources.value.length === 0) {
      loadingSources.value = true
      try {
        sources.value = await props.library.sources()
      } catch (err) {
        ElMessage.error(`读取图床来源失败：${(err as Error).message}`)
      } finally {
        loadingSources.value = false
      }
    }
    sourceId.value = sources.value[0]?.id ?? ''
  },
)

// 切来源即重置专属项与图库列表
watch(sourceId, () => {
  target.value = {}
  items.value = []
  selected.value = new Set()
})

function close(): void {
  emit('update:open', false)
}

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

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const source = activeSource.value
  if (!source || files.length === 0) return
  uploading.value = true
  const urls: string[] = []
  try {
    for (const file of files) {
      urls.push(await props.library.upload(file, source, target.value))
    }
  } catch (err) {
    ElMessage.error(`上传失败：${(err as Error).message}`)
  } finally {
    uploading.value = false
  }
  if (urls.length > 0) insertUrls(urls)
}

async function loadGallery(): Promise<void> {
  const source = activeSource.value
  if (!source) return
  loadingList.value = true
  selected.value = new Set()
  try {
    items.value = await props.library.list(source, target.value)
  } catch (err) {
    items.value = []
    ElMessage.error(`读取图库失败：${(err as Error).message}`)
  } finally {
    loadingList.value = false
  }
}

function togglePick(url: string): void {
  const next = new Set(selected.value)
  if (next.has(url)) next.delete(url)
  else next.add(url)
  selected.value = next
}

function insertSelected(): void {
  const urls = items.value.map((i) => i.url).filter((u) => selected.value.has(u))
  insertUrls(urls)
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="图片库"
    width="720px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="lib-toolbar">
      <el-select v-model="sourceId" placeholder="选择图床来源" style="width: 320px" :loading="loadingSources">
        <el-option v-for="s in sources" :key="s.id" :value="s.id" :label="s.label" />
      </el-select>
      <el-radio-group v-model="tab">
        <el-radio-button value="upload">上传图片</el-radio-button>
        <el-radio-button value="gallery">从图库选择</el-radio-button>
      </el-radio-group>
    </div>

    <div class="lib-target">
      <template v-if="showBucket">
        <el-input v-model="target.bucket" placeholder="桶 / 容器（留空用 profile 默认）" style="width: 220px" />
        <el-input v-model="target.prefix" placeholder="目录前缀（如 blog/2026，留空用默认）" style="width: 220px" />
      </template>
      <el-input v-else-if="showRemotePath" v-model="target.remotePath" placeholder="远程目录（留空用 profile 默认）" style="width: 460px" />
      <el-input v-else v-model="target.localDir" placeholder="本地目录（留空用应用默认上传目录）" style="width: 460px" />
    </div>

    <div v-if="tab === 'upload'" class="lib-upload">
      <input ref="uploadInput" type="file" accept="image/*" multiple class="hidden-input" @change="onFilesChosen" />
      <div class="drop-hint" :class="{ busy: uploading }" @click="pickFiles">
        <div class="drop-main">{{ uploading ? '上传中…' : '点击选择图片（可多选）' }}</div>
        <div class="drop-sub">上传成功后自动插入正文；失败会提示原因，不影响已编辑内容</div>
      </div>
    </div>

    <div v-else class="lib-gallery">
      <div class="gallery-bar">
        <el-button size="small" :loading="loadingList" @click="loadGallery">刷新列表</el-button>
        <span class="gallery-count">{{ items.length }} 张 · 已选 {{ selected.size }} 张</span>
        <el-button size="small" type="primary" :disabled="selected.size === 0" @click="insertSelected">插入所选</el-button>
      </div>
      <div v-if="items.length" class="gallery-grid">
        <div
          v-for="item in items"
          :key="item.url"
          class="gallery-cell"
          :class="{ picked: selected.has(item.url) }"
          @click="togglePick(item.url)"
        >
          <el-image :src="toDisplaySrc(item.url)" fit="cover" loading="lazy" class="gallery-img">
            <template #error><div class="img-err">裂图</div></template>
          </el-image>
          <div class="img-name">{{ item.name }}</div>
        </div>
      </div>
      <div v-else class="gallery-empty">{{ loadingList ? '读取中…' : '暂无图片，点「刷新列表」或先上传几张' }}</div>
    </div>
  </el-dialog>
</template>

<style scoped>
.lib-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.lib-target { display: flex; gap: 8px; margin-bottom: 12px; }
.hidden-input { display: none; }
.drop-hint {
  border: 1px dashed rgba(128, 128, 128, 0.45);
  border-radius: 8px;
  padding: 28px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.drop-hint:hover { border-color: var(--el-color-primary); }
.drop-hint.busy { opacity: 0.6; cursor: wait; }
.drop-main { font-size: 14px; }
.drop-sub { font-size: 12px; opacity: 0.6; margin-top: 6px; }
.gallery-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.gallery-count { flex: 1; font-size: 12px; opacity: 0.65; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; max-height: 320px; overflow-y: auto; }
.gallery-cell {
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
  text-align: center;
}
.gallery-cell.picked { border-color: var(--el-color-primary); background: rgba(64, 158, 255, 0.08); }
.gallery-img { width: 100%; height: 72px; border-radius: 4px; display: block; }
.img-err { width: 100%; height: 72px; display: flex; align-items: center; justify-content: center; font-size: 12px; opacity: 0.5; }
.img-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; }
.gallery-empty { text-align: center; padding: 40px 0; font-size: 13px; opacity: 0.6; }
</style>
