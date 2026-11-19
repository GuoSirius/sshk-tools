<script setup lang="ts">
/**
 * 内容编辑核心（plans/11 #8 + 2026-11-19 布局重排）：
 * 第一行 标题（原「名称」改名，表格列同步）；第二行 标签（只占半行，右半预留）；
 * 第三行 状态 + 定时时间（状态新增「定时发布」，选中才显示到时分秒的时间选择器，仅可选当前以后）；
 * 描述 textarea（最小 3 行、最大 5 行，超出内部滚动）；最后富文本正文。
 * 上传与图片库注入收敛在核心内（C2 唯一注入点），壳只管容器与 footer。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RichTextEditor, toStoredHtml } from '@sshk/rich-text'
import { createHostImageLibrary } from '@sshk/file-picker'
import type { ContentRecord, ContentSaveInput, ContentStatus } from '@sshk/shared'
import { host } from '../host'

const props = defineProps<{
  record: ContentRecord | null
  copySource?: ContentRecord | null
}>()
const emit = defineEmits<{ save: [input: ContentSaveInput] }>()

const TOOL_ID = 'file-manager'
interface CeForm {
  _id?: string
  name: string
  html: string
  summary: string
  description: string
  tags: string[]
  status: ContentStatus
  publishAt: string // 到秒的时间串 'YYYY-MM-DD HH:mm:ss'，仅 status==='scheduled' 时有效
}
const now = () => Date.now()
const form = ref<CeForm>({ _id: undefined, name: '', html: '', summary: '', description: '', tags: [], status: 'draft', publishAt: '' })
const nameRef = ref<{ focus?: () => void } | null>(null)
const imageLibrary = createHostImageLibrary(TOOL_ID, host.upload)

// 定时发布时刻（毫秒）：el-date-picker value-format="x" 直出/直吃毫秒时间戳
const publishMs = computed({
  get: () => (form.value.publishAt ? Date.parse(form.value.publishAt) : 0),
  set: (v: number) => {
    if (!v) { form.value.publishAt = ''; return }
    form.value.publishAt = toSecString(v)
  },
})
/** 仅可选当前以后（精确到时分秒） */
const disabledDate = (d: Date): boolean => d.getTime() <= now()

function toSecString(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const onUploadImage = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  const result = await host.upload.single({ toolId: TOOL_ID, name: file.name, size: file.size, mime: file.type, dataUrl }) as { url: string }
  return result.url
}

watch(() => [props.record, props.copySource] as const, () => {
  const src = props.copySource ?? props.record
  form.value = src
    ? {
        _id: props.copySource ? undefined : src._id,
        name: props.copySource ? `${src.name}（副本）` : src.name,
        html: src.html,
        summary: src.summary ?? '',
        description: src.description ?? '',
        tags: [...(src.tags ?? [])],
        status: props.copySource ? 'draft' : src.status,
        publishAt: !props.copySource && src.status === 'scheduled' && src.publishAt ? toSecString(Number(src.publishAt)) : '',
      }
    : { _id: undefined, name: '', html: '', summary: '', description: '', tags: [], status: 'draft', publishAt: '' }
  nextTick(() => nameRef.value?.focus?.())
}, { immediate: true })

/** 标题（原「名称」）必填；定时发布还须带有效时刻 */
const canSave = computed(() => {
  if (!form.value.name.trim()) return false
  if (form.value.status === 'scheduled' && !form.value.publishAt) return false
  return true
})
function submit(): void {
  if (!canSave.value) return
  const isScheduled = form.value.status === 'scheduled'
  emit('save', {
    ...form.value,
    html: toStoredHtml(form.value.html),
    description: form.value.description || undefined,
    publishAt: isScheduled && form.value.publishAt ? Date.parse(form.value.publishAt) : undefined,
  } as ContentSaveInput)
}
defineExpose({ submit, canSave })
</script>

<template>
  <div class="ce-core">
    <!-- 第一行：标题（原「名称」） -->
    <el-form-item label="标题" required class="ce-row ce-row-title">
      <el-input ref="nameRef" v-model="form.name" placeholder="内容标题（必填）" clearable data-autofocus />
    </el-form-item>
    <!-- 第二行：标签只占半行，右半预留 -->
    <div class="ce-row ce-row-half">
      <el-form-item label="标签" class="ce-tag-item">
        <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入回车添加标签" style="width: 100%" />
      </el-form-item>
      <div class="ce-reserved" aria-hidden="true"></div>
    </div>
    <!-- 第三行：状态 + 定时时间（仅选中「定时发布」时显示，精确到时分秒、仅可选当前以后） -->
    <div class="ce-row ce-status-row">
      <el-form-item label="状态" class="ce-status-item">
        <el-select v-model="form.status" style="width: 100%">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="定时发布" value="scheduled" />
          <el-option label="已下线" value="retracted" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.status === 'scheduled'" label="定时时间" class="ce-publishat-item">
        <el-date-picker
          v-model="publishMs"
          type="datetime"
          :disabled-date="disabledDate"
          format="YYYY-MM-DD HH:mm:ss"
          value-format="x"
          placeholder="选择发布时间（当前以后，精确到秒）"
          style="width: 100%"
        />
      </el-form-item>
    </div>
    <!-- 描述 textarea：最小 3 行、最大 5 行，超出内部滚动 -->
    <el-form-item label="描述" class="ce-row">
      <el-input
        v-model="form.description"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 5 }"
        placeholder="内容描述（可选）"
      />
    </el-form-item>
    <!-- 正文：富文本 -->
    <div class="ce-editor">
      <RichTextEditor v-model="form.html" :on-upload-image="onUploadImage" :image-library="imageLibrary" :state-key="record?._id ?? 'new'" />
    </div>
  </div>
</template>

<style scoped>
.ce-core { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: var(--sshk-gap-md); }
.ce-row-title { flex: none; }
.ce-row-half { flex: none; display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--sshk-gap-lg); align-items: start; }
.ce-tag-item { min-width: 0; }
.ce-reserved { min-width: 0; }
/* 状态 + 定时时间：状态固定宽，定时时间占其余 */
.ce-status-row { flex: none; display: grid; grid-template-columns: 200px 1fr; column-gap: var(--sshk-gap-lg); align-items: start; }
.ce-status-item { min-width: 0; }
.ce-publishat-item { min-width: 0; }
.ce-editor { flex: 1; min-height: 520px; display: flex; flex-direction: column; }
.ce-editor > :deep(.rich) { flex: 1; min-height: 0; }
</style>
