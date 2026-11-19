<script setup lang="ts">
/**
 * 内容编辑核心（plans/11 #8）：表单 + 富文本编辑器，dialog / page 两种壳共用同一实现，切换只换容器。
 * 上传与图片库注入收敛在核心内（C2 唯一注入点），壳只管容器与 footer。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RichTextEditor, toStoredHtml } from '@sshk/rich-text'
import { createHostImageLibrary } from '@sshk/file-picker'
import type { ContentRecord, ContentSaveInput } from '@sshk/shared'
import { host } from '../host'

const props = defineProps<{
  record: ContentRecord | null
  copySource?: ContentRecord | null
}>()
const emit = defineEmits<{ save: [input: ContentSaveInput] }>()

const TOOL_ID = 'file-manager'
const form = ref<ContentSaveInput>({ name: '', html: '', summary: '', tags: [], status: 'draft' })
const nameRef = ref<{ focus?: () => void } | null>(null)
const imageLibrary = createHostImageLibrary(TOOL_ID, host.upload)

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
        html: src.html, summary: src.summary,
        tags: [...(src.tags ?? [])],
        status: props.copySource ? 'draft' : src.status,
      }
    : { name: '', html: '', summary: '', tags: [], status: 'draft' }
  nextTick(() => nameRef.value?.focus?.())
}, { immediate: true })

const canSave = computed(() => Boolean(form.value.name.trim()))
function submit(): void {
  if (!canSave.value) return
  emit('save', { ...form.value, html: toStoredHtml(form.value.html) })
}
defineExpose({ submit, canSave })
</script>

<template>
  <div class="ce-core">
    <el-form label-width="auto" size="small" class="ce-meta">
      <el-form-item label="名称" required>
        <el-input ref="nameRef" v-model="form.name" placeholder="内容名称（必填）" clearable data-autofocus />
      </el-form-item>
      <el-form-item label="标签">
        <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入回车添加标签" style="width: 100%" />
      </el-form-item>
    </el-form>
    <div class="ce-editor">
      <RichTextEditor v-model="form.html" :on-upload-image="onUploadImage" :image-library="imageLibrary" :state-key="record?._id ?? 'new'" />
    </div>
  </div>
</template>

<style scoped>
.ce-core { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 10px; }
.ce-meta { flex: none; }
.ce-editor { flex: 1; min-height: 260px; overflow: auto; }
</style>
