<script setup lang="ts">
/**
 * 内容编辑弹框壳（plans/11 §3-5 / #8）：四态控件（最小化/最大化/全屏），打开默认最大化。
 * 编辑核心在 ContentEditorCore（dialog/page 两壳共用）。
 * - 最小化：弹框隐藏，收为可拖拽悬浮条（复用 TransferPanel useDraggable 范式），点击标题栏复原
 * - 最大化：铺满整个应用可视区（100vw×100vh、margin 0）
 * - 富文本 fullScreen() 是 @sshk/rich-text 内部 Teleport 到 body + z-index 满级，天然盖住本弹框
 *
 * ⚠️ 弹框节点样式必须放非 scoped 全局块（项目已知坑：teleport 到 body 的节点上没有本组件
 *   的 data-v 属性，:deep() 打不进去）；本模板自绘元素（.ce-head/.ce-body 等）可走 scoped。
 * 滚动口径（用户 2026-11-19）：滚动层 = .ce-body，头部/脚部不随内容滚；
 * 弹框自身 padding 归零，滚动条贴弹框最右缘，留白由 .ce-head/.ce-content 自身 padding 补偿。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDraggable } from '@vueuse/core'
import { Close, Expand, FullScreen, Minus, Rank } from '@element-plus/icons-vue'
// Close 仍用于最小化悬浮条关闭；标题栏关闭已移除（与 footer 取消重复）
import type { ContentRecord, ContentSaveInput } from '@sshk/shared'
import ContentEditorCore from './ContentEditorCore.vue'

const props = defineProps<{
  /** 编辑的记录；null = 新建；copySource 非空 = 复制另存为 */
  record: ContentRecord | null
  copySource?: ContentRecord | null
}>()
/** minimize-state 变化：父组件据此在用户尝试其它编辑类操作时二次确认（task 9） */
const emit = defineEmits<{
  save: [input: ContentSaveInput]
  /** minimized=true 时父组件须介入提示 */
  'update:minimized': [minimized: boolean]
}>()

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
/** 由父组件触发复原（用户选择「继续编辑」时） */
function restore(): void { minimized.value = false; winMode.value = 'maximized' }
function doClose(): void { minimized.value = false; visible.value = false }
function submit(): void { coreRef.value?.submit() }
defineExpose({ submit, canSave: () => Boolean(coreRef.value?.canSave), restore, isMinimized: () => minimized.value })

// 向上同步最小化态，父组件据此在其它编辑操作触发时二次确认
watch(minimized, (m) => { if (visible.value) emit('update:minimized', m) })

const dialogVisible = computed({
  get: () => visible.value && !minimized.value,
  set: (v: boolean) => { if (!v) doClose() },
})

const barRef = ref<HTMLElement | null>(null)
const { x, y } = useDraggable(barRef, {
  initialValue: { x: 40, y: 90 },
  preventDefault: true,
  stopPropagation: true,
  // 悬浮条 fixed 定位在视口左上（40,90），可拖拽；始终在可视区内
})
// 最小化悬浮条渲染后把 draggable 的 x/y 同步到初始位置（fixed 左上，可见且可拖）
watch(minimized, async (m) => {
  if (!m) return
  await nextTick()
  if (barRef.value) {
    // 若 useDraggable 尚未拿到 ref，手动初始化
    x.value = 40; y.value = 90
  }
})
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
      :class="{ 'ce-fullmode': winMode !== 'normal' }"
    >
      <div class="ce-head">
        <span class="ce-title">{{ editTitle }}</span>
        <div class="ce-controls">
          <el-tooltip content="最小化" placement="bottom"><button class="ce-btn" aria-label="最小化" @click="doMinimize"><el-icon><Minus /></el-icon></button></el-tooltip>
          <el-tooltip :content="winMode === 'normal' ? '最大化' : '还原'" placement="bottom">
            <button class="ce-btn" aria-label="最大化/还原" @click="setMode(winMode === 'normal' ? 'maximized' : 'normal')">
              <el-icon><component :is="winMode === 'normal' ? Expand : Rank" /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip :content="winMode === 'fullscreen' ? '退出全屏' : '全屏'" placement="bottom">
            <button class="ce-btn" aria-label="全屏" @click="setMode(winMode === 'fullscreen' ? 'maximized' : 'fullscreen')"><el-icon><FullScreen /></el-icon></button>
          </el-tooltip>
          <!-- 关闭在页内 footer「取消」已提供；弹框标题栏不再重复放关闭按钮 -->
        </div>
      </div>
      <div class="ce-body" :class="{ 'ce-body-normal': winMode === 'normal' }">
        <div class="ce-content">
          <ContentEditorCore ref="coreRef" :record="record" :copy-source="copySource" @save="emit('save', $event)" />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="doClose">取消</el-button>
        <el-button size="small" type="primary" :disabled="!coreRef?.canSave" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <div v-if="minimized" ref="barRef" class="ce-mini-bar" :style="{ left: `${x}px`, top: `${y}px` }">
      <span class="ce-mini-handle" aria-hidden="true"><el-icon><Rank /></el-icon></span>
      <span class="ce-mini-title" @click="restore()"><el-icon class="mini-expand"><Expand /></el-icon>{{ editTitle }}（已最小化 · 点击展开）</span>
      <button class="ce-btn" aria-label="关闭" @click="doClose"><el-icon><Close /></el-icon></button>
    </div>
  </teleport>
</template>

<style scoped>
/* 本模板自绘元素（带 data-v）走 scoped；.el-dialog 节点覆盖见下方全局块 */
.ce-head { flex: none; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color); padding: 12px 16px 10px; }
.ce-title { font-weight: 600; font-size: 14px; }
.ce-controls { display: inline-flex; gap: 2px; }
.ce-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--el-text-color-regular); cursor: pointer; border-radius: 4px; }
.ce-btn:hover { background: var(--el-fill-color-light); }
/* 唯一滚动层：滚动条贴弹框最右缘（弹框 padding 已在全局块归零）；头部/脚部在此层之外，不随内容滚 */
.ce-body { flex: 1; min-height: 0; overflow-y: auto; }
.ce-content { padding: 12px 16px 0; min-height: 0; display: flex; flex-direction: column; height: 100%; }
/* normal 态：el-dialog 非 flex 上下文，用固定高度约束滚动层；max/full 由全局块的 flex:1 撑满 */
.ce-body-normal { height: min(calc(100vh - 200px), calc(86vh - 70px)); min-height: 360px; }
.ce-mini-bar { position: fixed; z-index: 3000; display: flex; align-items: center; gap: 6px; background: var(--el-bg-color); border: 1px solid var(--el-border-color); box-shadow: var(--el-box-shadow-light); border-radius: 6px; padding: 5px 8px; max-width: 360px; }
.ce-mini-handle { cursor: move; color: var(--el-text-color-placeholder); display: inline-flex; align-items: center; padding: 2px; }
.ce-mini-title { cursor: pointer; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.mini-expand { flex: none; }
</style>

<!-- 非 scoped 全局块：el-dialog 节点 teleport 到 body，无本组件 data-v 属性，:deep() 打不进（项目已知坑） -->
<style>
/* 弹框自身 padding 归零 → 滚动条贴弹框边缘；留白由 .ce-head/.ce-content 自身 padding 提供 */
.content-editor-dialog { padding: 0 !important; }
.content-editor-dialog .el-dialog__header { display: none; }
/* 最大化/全屏：铺满整个应用可视区（用户 2026-11-19），弹框成 flex 列，body 弹性滚动、header/footer 固定 */
.content-editor-dialog.ce-fullmode { display: flex; flex-direction: column; margin: 0 !important; width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0 !important; overflow: hidden; }
.content-editor-dialog.ce-fullmode .el-dialog__body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding: 0; }
.content-editor-dialog.ce-fullmode .el-dialog__footer { flex: none; padding: 12px 16px 16px; border-top: 1px solid var(--el-border-color); }
/* normal 态：footer 统一内缩口径 */
.content-editor-dialog .el-dialog__footer { padding: 12px 16px 16px; }
</style>
