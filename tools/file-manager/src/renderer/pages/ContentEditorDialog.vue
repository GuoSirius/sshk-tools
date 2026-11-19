<script setup lang="ts">
/**
 * 内容编辑弹框壳（plans/11 §3-5 / #8）：四态控件（最小化/最大化/全屏/关闭），打开默认最大化。
 * 编辑核心在 ContentEditorCore（dialog/page 两壳共用）。
 * - 最小化：弹框隐藏，收为可拖拽悬浮条（复用 TransferPanel useDraggable 范式），点击标题栏复原
 * - 最大化：el-dialog 宽高撑满工作区；全屏：el-dialog fullscreen（浏览器层）
 * - 富文本 fullScreen() 是 @sshk/rich-text 内部 Teleport 到 body + z-index 满级，天然盖住本弹框；
 *   二者状态互不改写，各 exit 只清各自 class
 */
import { computed, ref, watch } from 'vue'
import { useDraggable } from '@vueuse/core'
import { Close, FullScreen, Minus, Rank } from '@element-plus/icons-vue'
// Close 仍用于最小化悬浮条关闭；标题栏关闭已移除（与 footer 取消重复）
import type { ContentRecord, ContentSaveInput } from '@sshk/shared'
import ContentEditorCore from './ContentEditorCore.vue'

const props = defineProps<{
  /** 编辑的记录；null = 新建；copySource 非空 = 复制另存为 */
  record: ContentRecord | null
  copySource?: ContentRecord | null
}>()
const emit = defineEmits<{ save: [input: ContentSaveInput] }>()

const visible = defineModel<boolean>('modelValue', { default: false })
type WinMode = 'maximized' | 'normal' | 'fullscreen'
const winMode = ref<WinMode>('maximized')
const minimized = ref(false)
const coreRef = ref<InstanceType<typeof ContentEditorCore> | null>(null)

const editTitle = computed(() => {
  if (props.copySource) return `复制内容：${props.copySource.name}`
  return props.record ? `编辑内容：${props.record.name}` : '新建内容'
})

watch(visible, (open) => {
  if (!open) return
  winMode.value = 'maximized'
  minimized.value = false
})

function setMode(mode: WinMode): void { winMode.value = mode; minimized.value = false }
function doMinimize(): void { minimized.value = true }
function doClose(): void { minimized.value = false; visible.value = false }
function submit(): void { coreRef.value?.submit() }

const dialogVisible = computed({
  get: () => visible.value && !minimized.value,
  set: (v: boolean) => { if (!v) doClose() },
})

const barRef = ref<HTMLElement | null>(null)
const { x, y } = useDraggable(barRef, { initialValue: { x: 120, y: 120 }, preventDefault: true, stopPropagation: true })
</script>

<template>
  <teleport to="body">
    <el-dialog
      v-model="dialogVisible"
      :show-header="false"
      :fullscreen="winMode === 'fullscreen'"
      :width="winMode === 'normal' ? '900px' : '100vw'"
      :top="winMode === 'normal' ? '6vh' : '0'"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      class="content-editor-dialog"
      :class="{ 'ce-full': winMode !== 'normal', 'ce-max': winMode === 'maximized' }"
    >
      <div class="ce-head">
        <span class="ce-title">{{ editTitle }}</span>
        <div class="ce-controls">
          <el-tooltip content="最小化" placement="bottom"><button class="ce-btn" aria-label="最小化" @click="doMinimize"><el-icon><Minus /></el-icon></button></el-tooltip>
          <el-tooltip :content="winMode === 'normal' ? '最大化' : '还原'" placement="bottom">
            <button class="ce-btn" aria-label="最大化/还原" @click="setMode(winMode === 'normal' ? 'maximized' : 'normal')"><el-icon><Rank /></el-icon></button>
          </el-tooltip>
          <el-tooltip :content="winMode === 'fullscreen' ? '退出全屏' : '全屏'" placement="bottom">
            <button class="ce-btn" aria-label="全屏" @click="setMode(winMode === 'fullscreen' ? 'maximized' : 'fullscreen')"><el-icon><FullScreen /></el-icon></button>
          </el-tooltip>
          <!-- 关闭在页内 footer「取消」已提供；弹框标题栏不再重复放关闭按钮 -->
        </div>
      </div>
      <div class="ce-body">
        <ContentEditorCore ref="coreRef" :record="record" :copy-source="copySource" @save="emit('save', $event)" />
      </div>
      <template #footer>
        <el-button size="small" @click="doClose">取消</el-button>
        <el-button size="small" type="primary" :disabled="!coreRef?.canSave" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <div v-if="minimized" ref="barRef" class="ce-mini-bar" :style="{ left: `${x}px`, top: `${y}px` }">
      <span class="ce-mini-handle" aria-hidden="true">⠿</span>
      <span class="ce-mini-title" @click="setMode('maximized')">{{ editTitle }}（已最小化 · 点击展开）</span>
      <button class="ce-btn" aria-label="关闭" @click="doClose"><el-icon><Close /></el-icon></button>
    </div>
  </teleport>
</template>

<style scoped>
/* 头部固定 + 滚动条贴弹框最右缘（用户 2026-11-19）：
   滚动层从 el-dialog__body 下移到 ce-body——头部天然不滚；dialog 右侧内缩归零让滚动条贴缘，
   16px 右留白由 ce-head/ce-core 自身 padding 补偿，视觉留白不变 */
:deep(.content-editor-dialog) { padding-right: 0; }
:deep(.content-editor-dialog .el-dialog__body) { overflow: visible; display: flex; flex-direction: column; }
.ce-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color); padding-bottom: 8px; margin-bottom: 10px; padding-right: 16px; }
.ce-title { font-weight: 600; font-size: 14px; }
.ce-controls { display: inline-flex; gap: 2px; }
.ce-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--el-text-color-regular); cursor: pointer; border-radius: 4px; }
.ce-btn:hover { background: var(--el-fill-color-light); }
.ce-close:hover { color: var(--el-color-danger); }
.ce-body { height: calc(100vh - 200px); min-height: 360px; overflow-y: auto; padding-right: 16px; }
.ce-full .ce-body { height: calc(100vh - 190px); }
.ce-mini-bar { position: fixed; z-index: 3000; display: flex; align-items: center; gap: 6px; background: var(--el-bg-color); border: 1px solid var(--el-border-color); box-shadow: var(--el-box-shadow-light); border-radius: 6px; padding: 5px 8px; }
/* 最大化铺满整个应用可视区：el-dialog 默认有 margin-top 15vh 与圆角，需清零（teleport 到 body，scoped 可用 :deep） */
:deep(.content-editor-dialog.ce-max) { margin: 0 !important; height: 100vh !important; max-height: 100vh !important; border-radius: 0 !important; }
:deep(.content-editor-dialog.ce-max .el-dialog__body) { padding-top: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; }
:deep(.content-editor-dialog.ce-max .ce-body) { flex: 1; min-height: 0; height: auto; }
:deep(.content-editor-dialog.ce-max .ce-core) { height: 100%; }
.ce-mini-handle { cursor: move; color: var(--el-text-color-placeholder); }
.ce-mini-title { cursor: pointer; font-size: 12px; }
</style>
