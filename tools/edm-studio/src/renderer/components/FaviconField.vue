<script setup lang="ts">
/**
 * 四级元数据 favicon 字段（2026-11-23 定版）：
 * - 走共享 FilePickerDialog（图片库，允许所有可当图标的图片类型，含 ico/png/svg/webp/avif）
 * - 保留 URL 直填兜底（沿用 ImageField 的既有范式）
 * - 旧 logo 字段不兼容读取：只读写 favicon
 * - 空值时按 版本 → 族 → 类型 → 品牌 继承（继承提示由调用方传入）
 */
import { computed, ref } from 'vue'
import { FilePickerDialog } from '@sshk/file-picker'
import { FormHint, useToolId } from '@sshk/ui-kit'
import { toDisplaySrc } from '@sshk/rich-text'
import { FAVICON_EXTS } from '../../core/meta-contract'
import { createImageLibrary } from '../upload'

const props = withDefaults(
  defineProps<{ modelValue?: string; readonly?: boolean; inheritHint?: string; inheritedValue?: string }>(),
  { modelValue: '', readonly: false, inheritHint: '', inheritedValue: '' },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const toolId = useToolId()
const library = computed(() => createImageLibrary(toolId.value))
const pickerOpen = ref(false)
const displaySrc = computed(() => toDisplaySrc(String(props.modelValue ?? '').trim()))
const inheritedSrc = computed(() => toDisplaySrc(String(props.inheritedValue ?? '').trim()))

function onConfirm(items: { url: string }[]): void {
  const url = items[0]?.url
  if (url) emit('update:modelValue', url)
  pickerOpen.value = false
}
</script>

<template>
  <div class="favicon-field">
    <div class="favicon-row">
      <el-image
        v-if="modelValue"
        :key="displaySrc"
        :src="displaySrc"
        fit="contain"
        class="favicon-thumb"
        :preview-src-list="[displaySrc]"
        preview-teleported
      >
        <template #error>
          <div class="favicon-broken" title="预览失败，存储值仍有效">?</div>
        </template>
      </el-image>
      <div v-else-if="inheritedSrc" class="favicon-inherited" :title="`继承上级图标：${inheritedSrc}`">
        <el-image :src="inheritedSrc" fit="contain" class="favicon-thumb is-inherited" />
        <span>继承</span>
      </div>
      <el-button size="small" :disabled="readonly" @click="pickerOpen = true">选择图标</el-button>
      <el-input
        clearable
        size="small"
        :model-value="modelValue"
        placeholder="图片 URL（可直填），留空则继承上级"
        :disabled="readonly"
        @update:model-value="(v: string) => emit('update:modelValue', v)"
      />
    </div>
    <FormHint v-if="inheritHint">{{ inheritHint }}</FormHint>
    <FilePickerDialog
      v-if="!readonly"
      v-model:open="pickerOpen"
      mode="image"
      title="选择 favicon"
      confirm-text="使用所选图标"
      :library="library"
      :allowed-exts="[...FAVICON_EXTS]"
      :multiple="false"
      :resolve-src="toDisplaySrc"
      @confirm="onConfirm"
    />
  </div>
</template>

<style scoped>
.favicon-field { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.favicon-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.favicon-row :deep(.el-input) { flex: 1; min-width: 0; }
.favicon-thumb { flex: none; width: 28px; height: 28px; border: 1px solid var(--sshk-border, rgba(128,128,128,.25)); border-radius: 4px; background: var(--el-fill-color-light); }
.favicon-thumb.is-inherited { border-style: dashed; opacity: .7; }
.favicon-inherited { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
.favicon-broken { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: var(--el-text-color-placeholder); }
</style>
