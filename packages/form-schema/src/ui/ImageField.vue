<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Picture, Search } from '@element-plus/icons-vue'
import { FilePickerDialog, copyTextToClipboard, type FilePickerLibrary } from '@sshk/file-picker'
import { toDisplaySrc } from '@sshk/rich-text'

/**
 * 图片字段控件（image / image-list 单元）——EDM 与表单设计共用的唯一实现
 * （2026-11-24 收敛：此前 EDM/tools 与 forms 各有一份 ImageField.vue，控件顺序漂移不一致）。
 * 控件顺序定版口径（用户 2026-11-24）：缩略图 → URL 直填 → 复制 → 「选择图片」。
 * 「选择图片」唤起共享 FilePickerDialog（可上传本地图片或挑已有图），确认回填 URL；
 * URL 直填兜底（离线/手输场景）与一键复制保留。
 *
 * library / stateKey 由宿主 FormFieldRenderer 经 `imageLibrary` / `imageStateKey` 转发注入：
 * stateKey 按宿主前缀隔离（edm::image-field / forms::image-field）——选择器设置持久化，
 * EDM 的 resolveLastUploadTarget（内联转存）也复用该键定位上次上传目标。
 *
 * 预览显示：file:// 资源渲染进程加载不了（Chromium 拦截），显示层统一转 localres://
 * 由主进程白名单放行；存储值保持 file://。预览失败显示图标占位（非裸裂图块）。
 *
 * 图片上传能力统一（用户 2026-11-23 口径）：图片/富文本/粘贴上传全部收敛到 FilePicker，
 * 本组件不带裸 <input type=file>；校验收敛应用级全局。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    readonly?: boolean
    /** 宿主图片库桥接（createHostImageLibrary 产物），未注入时「选择图片」禁用、URL 直填仍可用 */
    library?: FilePickerLibrary
    /** FilePicker 设置持久化键（按宿主隔离，如 edm::image-field / forms::image-field） */
    stateKey?: string
  }>(),
  { modelValue: '', readonly: false, library: undefined, stateKey: 'default' },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const previewBroken = ref(false)
const pickerOpen = ref(false)

const displaySrc = computed(() => toDisplaySrc(String(props.modelValue ?? '').trim()))

function onConfirm(items: { url: string }[]): void {
  const url = items[0]?.url
  if (url) emit('update:modelValue', url)
  pickerOpen.value = false
}

async function copyUrl(): Promise<void> {
  const url = String(props.modelValue ?? '').trim()
  if (!url) { ElMessage.warning('还没有图片 URL'); return }
  // 复制走 file-picker 的兜底实现（Clipboard API + execCommand 回退，PickerThumbGrid 同款），宿主解耦
  const ok = await copyTextToClipboard(url)
  if (ok) ElMessage.success('图片 URL 已复制')
  else ElMessage.error('复制失败：剪贴板不可用')
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
    <el-input clearable size="small"
      :model-value="modelValue"
      placeholder="图片 URL（可点「选择图片」或直填）"
      :disabled="readonly"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    />
    <el-tooltip content="复制图片 URL" placement="top">
      <el-button size="small" :icon="CopyDocument" :disabled="!modelValue" @click="copyUrl" />
    </el-tooltip>
    <el-button size="small" :icon="Search" :disabled="readonly || !library" style="margin-left: 0" @click="pickerOpen = true">选择图片</el-button>
    <FilePickerDialog
      v-if="!readonly && library"
      v-model:open="pickerOpen"
      mode="image"
      title="选择图片"
      confirm-text="使用所选图片"
      :library="library"
      :multiple="false"
      :resolve-src="toDisplaySrc"
      :state-key="stateKey"
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
