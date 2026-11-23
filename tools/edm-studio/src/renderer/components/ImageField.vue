<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Picture, Search } from '@element-plus/icons-vue'
import { FilePickerDialog } from '@sshk/file-picker'
import { useToolId } from '@sshk/ui-kit'
import { toDisplaySrc } from '@sshk/rich-text'
import { createImageLibrary } from '../upload.js'
import { host } from '../host'

/**
 * 图片字段控件（R15 image / image-list）：统一走共享 FilePickerDialog（图片库）。
 * 单图：点「选择图片」唤起 FilePicker，可上传本地图片或挑已有图；确认回填服务端 URL。
 * 保留 URL 直填兜底（离线/手输场景）与一键复制。
 *
 * 预览显示：file:// 资源渲染进程加载不了（Chromium 拦截），显示层统一转 localres://
 * 由主进程白名单放行；存储值保持 file://。预览失败显示图标占位（非裸 FAILED 裂图块）。
 *
 * 图片上传能力统一（用户 2026-11-23 口径）：图片/富文本/粘贴上传全部收敛到 FilePicker，
 * 本组件不再自带裸 <input type=file> + createImageUploader（那条路径依赖工具级上传配置，待删）。
 */
const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean }>(),
  { modelValue: '', readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const previewBroken = ref(false)
const toolId = useToolId()
const library = computed(() => createImageLibrary(toolId.value))
const pickerOpen = ref(false)

const displaySrc = computed(() => toDisplaySrc(String(props.modelValue ?? '').trim()))

function onConfirm(items: { url: string }[]): void {
  const url = items[0]?.url
  if (url) emit('update:modelValue', url)
  pickerOpen.value = false
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
    <el-button size="small" :icon="Search" :disabled="readonly" @click="pickerOpen = true">选择图片</el-button>
    <el-input clearable size="small"
      :model-value="modelValue"
      placeholder="图片 URL（可点「选择图片」或直填）"
      :disabled="readonly"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    />
    <el-tooltip content="复制图片 URL" placement="top">
      <el-button size="small" :icon="CopyDocument" :disabled="!modelValue" @click="copyUrl" />
    </el-tooltip>
    <FilePickerDialog
      v-if="!readonly"
      v-model:open="pickerOpen"
      mode="image"
      title="选择图片"
      confirm-text="使用所选图片"
      :library="library"
      :multiple="false"
      :resolve-src="toDisplaySrc"
      state-key="edm::image-field"
      @confirm="onConfirm"
    />
  </div>
</template>

<style scoped>
.image-field { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0; }
/* 全行统一默认高度（控件由 theme.css 统一拉平），thumb 36px 视觉居中 */
.image-field :deep(.el-input) { flex: 1; min-width: 0; }
.thumb { flex: none; width: 36px; height: 36px; border-radius: 4px; border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); }
.thumb-error { display: flex; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); background: var(--el-fill-color-light, rgba(128, 128, 128, 0.1)); font-size: 16px; }
</style>
