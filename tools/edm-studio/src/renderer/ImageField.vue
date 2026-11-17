<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Picture, Upload } from '@element-plus/icons-vue'
import { useToolId } from '@sshk/ui-kit'
import { toDisplaySrc } from '@sshk/rich-text'
import { createImageUploader } from './upload.js'
import { host } from './host'

/**
 * 图片字段控件（R15 image / image-list）：支持「上传 + 预览 + URL 直填」。
 * B7/T7：本地文件不再转 dataURL 持久保存，改走应用级共享上传通道，
 * 回填服务端 URL（local=file://、remote=可访问地址、cloud=对象 URL）。
 * 上传未配置 / 失败时由 uploadImageFile 回退 dataURL，离线编辑不阻断。
 *
 * 预览显示（2026-11-16）：file:// 资源渲染进程加载不了（Chromium 拦截），
 * 显示层统一转 localres:// 由主进程白名单放行；存储值保持 file://。
 * 预览失败时显示图标占位 + 悬浮提示（不再是裸 FAILED 裂图块）。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const previewBroken = ref(false)
const toolId = useToolId()

const displaySrc = computed(() => toDisplaySrc(String(props.modelValue ?? '').trim()))

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

/** 复核项 4：URL 已自动回填，这里再给一键复制，彻底替代 oss-browser 手工复制链接 */
async function copyUrl(): Promise<void> {
  const url = String(props.modelValue ?? '').trim()
  if (!url) { ElMessage.warning('还没有图片 URL'); return }
  try {
    await host.os.clipboardWrite(url)
    ElMessage.success('图片 URL 已复制')
  } catch (err) {
    ElMessage.error(`复制失败：${(err as Error).message}`)
  }
}
</script>

<template>
  <div class="image-field">
    <el-image
      v-if="modelValue"
      :key="displaySrc"
      :src="displaySrc"
      fit="cover"
      class="thumb"
      :preview-src-list="previewBroken ? [] : [displaySrc]"
      preview-teleported
      @error="previewBroken = true"
      @load="previewBroken = false"
    >
      <template #error>
        <div class="thumb thumb-error" title="预览加载失败：本地路径需上传目录白名单内才可预览（存储值仍有效）">
          <el-icon><Picture /></el-icon>
        </div>
      </template>
    </el-image>
    <el-button v-if="!readonly" :icon="Upload" :loading="uploading" @click="pick">上传</el-button>
    <el-input
      :model-value="modelValue"
      placeholder="图片 URL，或点「上传」选本地图片"
      :disabled="readonly"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    />
    <el-tooltip content="复制图片 URL" placement="top">
      <el-button :icon="CopyDocument" :disabled="!modelValue" @click="copyUrl" />
    </el-tooltip>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
  </div>
</template>

<style scoped>
.image-field { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0; }
/* 全行统一默认高度（控件由 theme.css 统一拉平，现为 24px），thumb 36px 视觉居中 */
.image-field :deep(.el-input) { flex: 1; min-width: 0; }
.thumb { flex: none; width: 36px; height: 36px; border-radius: 4px; border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); }
.thumb-error { display: flex; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); background: var(--el-fill-color-light, rgba(128, 128, 128, 0.1)); font-size: 16px; }
</style>
