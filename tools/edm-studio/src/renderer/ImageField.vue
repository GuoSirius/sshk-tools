<script setup lang="ts">
import { ref } from 'vue'
import { Upload } from '@element-plus/icons-vue'

/**
 * 图片字段控件（R15 image / image-list）：支持「本地上传 + 预览 + URL 直填」。
 * - 上传：隐藏的 <input type=file> 触发 FileReader 读为 dataURL，回填 modelValue，可离线预览、随表单 JSON 持久化。
 * - 预览：el-image 缩略图 + 点击放大（preview-src-list）。
 * - URL 直填：上传通道（local/云）接入后，可改为真实上传并回填服务端 URL，本控件向后兼容。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const fileInput = ref<HTMLInputElement | null>(null)

function pick(): void {
  if (props.readonly) return
  fileInput.value?.click()
}

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = () => emit('update:modelValue', String(reader.result))
    reader.readAsDataURL(file)
  }
  input.value = '' // 重置，允许重复选同一文件
}
</script>

<template>
  <div class="image-field">
    <el-image
      v-if="modelValue"
      :src="modelValue"
      fit="cover"
      class="thumb"
      :preview-src-list="[modelValue]"
      preview-teleported
    />
    <el-button v-if="!readonly" size="small" :icon="Upload" @click="pick">上传</el-button>
    <el-input
      :model-value="modelValue"
      placeholder="图片 URL，或点「上传」选本地图片"
      :disabled="readonly"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    />
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
  </div>
</template>

<style scoped>
.image-field { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0; }
.thumb { flex: none; width: 44px; height: 44px; border-radius: 4px; border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); }
</style>
