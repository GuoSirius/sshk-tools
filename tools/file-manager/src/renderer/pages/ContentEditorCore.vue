<script setup lang="ts">
/**
 * 内容编辑核心（plans/11 #8 + 2026-11-20 布局定版）：
 * 第一行 标题 + 状态（两列）；第二行 标签（只占半行，右半预留）；
 * 第三行 定时时间（仅状态=定时发布时展示，精确到时分秒，仅可选当前以后）；
 * 描述 textarea（最小 3 行、最大 5 行，超出内部滚动）；最后富文本正文。
 * 上传与图片库注入收敛在核心内（C2 唯一注入点），壳只管容器与 footer。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RichTextEditor, toStoredHtml } from '@sshk/rich-text'
import { createHostImageLibrary } from '@sshk/file-picker'
import type { ContentRecord, ContentSaveInput, ContentStatus } from '@sshk/shared'
import { format, ISO_WITH_OFFSET } from '@sshk/shared'
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
/** 仅可选今天及以后（disabledDate 按日粒度判定，具体到秒的「当前以后」在提交时由主进程校验兜底） */
const disabledDate = (d: Date): boolean => {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  return d.getTime() < start.getTime()
}

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
        publishAt: !props.copySource && src.status === 'scheduled' && src.publishAt ? toSecString(Date.parse(src.publishAt)) : '',
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
  // publishAt 契约：ISO 带 +08:00 字符串（与 ContentSaveInput 类型一致，勿发数字毫秒）
  const publishMsNum = isScheduled && form.value.publishAt ? Date.parse(form.value.publishAt) : 0
  emit('save', {
    ...form.value,
    html: toStoredHtml(form.value.html),
    description: form.value.description || undefined,
    publishAt: publishMsNum ? format(publishMsNum, ISO_WITH_OFFSET) : undefined,
  } as ContentSaveInput)
}
defineExpose({ submit, canSave })
</script>

<template>
  <div class="ce-core">
    <el-form label-width="auto" size="small" class="ce-meta">
      <!-- 第一行：标题 + 状态（两列，用户 2026-11-20 定版） -->
      <div class="ce-row ce-row-2">
        <el-form-item label="标题" required>
          <el-input ref="nameRef" v-model="form.name" placeholder="内容标题（必填）" clearable data-autofocus />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="定时发布" value="scheduled" />
            <el-option label="已下线" value="retracted" />
          </el-select>
        </el-form-item>
      </div>
      <!-- 第二行：标签只占半行，右半预留 -->
      <div class="ce-row ce-row-2">
        <el-form-item label="标签">
          <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入回车添加标签" style="width: 100%" />
        </el-form-item>
        <div class="ce-reserved" aria-hidden="true"></div>
      </div>
      <!-- 第三行：定时时间（仅状态=定时发布时展示，两列栅格与整体对齐；仅可选当前以后，精确到时分秒） -->
      <div v-if="form.status === 'scheduled'" class="ce-row ce-row-2">
        <el-form-item label="定时时间">
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
        <div class="ce-reserved" aria-hidden="true"></div>
      </div>
      <!-- 描述：最小 3 行、最大 5 行，超出内部滚动 -->
      <el-form-item label="描述">
        <el-input
          v-model="form.description"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="内容描述（可选）"
        />
      </el-form-item>
    </el-form>
    <!-- 正文：富文本 -->
    <div class="ce-editor">
      <RichTextEditor v-model="form.html" :on-upload-image="onUploadImage" :image-library="imageLibrary" :state-key="record?._id ?? 'new'" />
    </div>
  </div>
</template>

<style scoped>
.ce-core { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: var(--sshk-gap-md); }
.ce-meta { flex: none; }
/* 两列栅格行：多列布局遵守页面留白与间距规范（gap 用统一 token） */
.ce-row-2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--sshk-gap-lg); align-items: start; }
.ce-reserved { min-width: 0; }
.ce-editor { flex: 1; min-height: 520px; display: flex; flex-direction: column; }
.ce-editor > :deep(.rich) { flex: 1; min-height: 0; }
</style>
