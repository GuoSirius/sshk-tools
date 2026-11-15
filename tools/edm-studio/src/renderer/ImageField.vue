<script setup lang="ts">
import { ref } from 'vue'
import { Upload } from '@element-plus/icons-vue'
import { useToolId } from '@sshk/ui-kit'
import { createImageUploader } from './upload.js'

/**
 * 图片字段控件（R15 image / image-list）：支持「上传 + 预览 + URL 直填」。
 * B7/T7：本地文件不再转 dataURL 持久保存，改走应用级共享上传通道，
 * 回填服务端 URL（local=file://、remote=可访问地址、cloud=对象 URL）。
 * 上传未配置 / 失败时由 uploadImageFile 回退 dataURL，离线编辑不阻断。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const toolId = useToolId()

function pick(): void {
  if (props.readonly || uploading.value) return
  fileInput.value?.click()
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 重置，允许重复选同一文件
  if (!file) return
  uploading.value = true
  try {
    emit('update:modelValue', await createImageUploader(toolId.value)(file))
  } finally {
    uploading.value = false
  }
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
    <el-button v-if="!readonly" size="small" :icon="Upload" :loading="uploading" @click="pick">上传</el-button>
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
