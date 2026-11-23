<script setup lang="ts">
/**
 * 轻量「上传目标选择框」（#43，2026-11-23）：只保留 FilePicker 头部的
 * 来源下拉 + 桶/目录级联/手输，用于富文本粘贴图片时确认「传到哪里」。
 * - 复用 useDirPicker 的全部目录能力（懒加载/归一化/校验/持久化按 stateKey），零重复实现；
 * - 不列文件、不选文件、不上传——图片已在剪贴板，确认后由调用方静默上传；
 * - 与 FilePickerDialog 共用 stateKey 存储，选中目标会被主弹框回显（体验一致）。
 */
import { ref, watch } from 'vue'
import type { CascaderInstance } from 'element-plus'
import { useDirPicker, type PickerTab } from '../composables/useDirPicker'
import type { FilePickerLibrary, FilePickerSource, FilePickerTarget } from '../types'

const props = withDefaults(
  defineProps<{
    open: boolean
    library: FilePickerLibrary
    stateKey?: string
    defaultTarget?: FilePickerTarget
    title?: string
  }>(),
  { stateKey: 'default', defaultTarget: undefined, title: '选择上传位置' },
)
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', payload: { source: FilePickerSource; target: FilePickerTarget }): void
}>()

// 目标选择框没有页签/列表，onSourceChanged/onTargetChanged 传空回调即可（持久化仍由 useDirPicker 负责）
const tab = ref<PickerTab>('upload')
const cascaderRef = ref<CascaderInstance | null>(null)
const dirPicker = useDirPicker(props, {
  tab,
  cascaderRef,
  onSourceChanged: () => {},
  onTargetChanged: () => {},
})
const {
  sources, sourceId, target, loadingSources, restored,
  typeOf, showBucket, dirError, dirPanelKey, dirCascaderPicked,
  cascaderProps, dirModel, dirManualFocused, dirManualDisplay,
  commitDirInput, onDirChange, dirValidation, activeSource,
  restoreSettings, finishRestore,
} = dirPicker

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await restoreSettings()
    await finishRestore()
  },
)

function doClose(): void {
  emit('update:open', false)
}

function confirm(): void {
  if (dirValidation.value.level === 'error') return // 非法目录不提交
  const source = activeSource.value
  if (!source) return
  emit('confirm', { source, target: { ...target.value } })
  doClose()
}
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="560px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="target-body">
      <div class="target-row">
        <span class="target-label">来源</span>
        <el-select v-model="sourceId" placeholder="选择来源（默认优先云）" :loading="loadingSources" class="source-select">
          <el-option v-for="s in sources" :key="s.id" :value="s.id" :label="s.label" />
        </el-select>
      </div>
      <div class="target-row">
        <span class="target-label">目标位置</span>
        <el-input v-if="showBucket" v-model="target.bucket" clearable placeholder="桶 / 容器（留空用 profile 默认）" class="bucket-input" />
        <el-cascader
          ref="cascaderRef"
          :key="dirPanelKey"
          v-model="dirModel"
          :props="cascaderProps"
          separator="/"
          clearable
          class="dir-cascader"
          :class="{ 'is-root-selected': dirCascaderPicked === '' }"
          popper-class="fp-dir-cascader-popper"
          :placeholder="showBucket ? '目录前缀（逐级选或手输）' : typeOf === 'remote' ? '远程目录（逐级选或手输）' : '本地目录（逐级选或手输）'"
          @change="onDirChange"
        />
      </div>
      <div class="target-row">
        <span class="target-label">或手输</span>
        <el-input
          v-model="dirManualDisplay"
          clearable
          class="dir-manual"
          :class="{ 'dir-invalid': dirValidation.level === 'error' }"
          placeholder="直接输入目录"
          @focus="dirManualFocused = true"
          @blur="dirManualFocused = false; commitDirInput()"
          @change="commitDirInput"
        />
      </div>
      <div v-if="dirValidation.level !== 'ok'" class="dir-validation" :class="`dir-validation--${dirValidation.level}`">
        {{ dirValidation.message }}
      </div>
      <div v-if="dirError" class="dir-validation dir-validation--warning">目录列表加载失败：{{ dirError }}（仍可手输目录）</div>
    </div>
    <template #footer>
      <el-button size="small" @click="doClose">取消</el-button>
      <el-button size="small" type="primary" :disabled="!restored || !activeSource || dirValidation.level === 'error'" @click="confirm">上传到此处</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.target-body { display: flex; flex-direction: column; gap: 10px; }
.target-row { display: flex; align-items: center; gap: 8px; }
.target-label { flex: none; width: 68px; text-align: right; font-size: 12px; color: var(--el-text-color-secondary); }
.source-select { flex: 1; min-width: 0; }
.bucket-input { flex: 1; min-width: 0; }
.dir-cascader, .dir-manual { flex: 1; min-width: 0; }
.dir-validation { font-size: 12px; padding-left: 76px; }
.dir-validation--warn, .dir-validation--warning { color: var(--el-color-warning); }
.dir-validation--error { color: var(--el-color-danger); }
.dir-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
</style>
