<script setup lang="ts">
/**
 * 内容编辑弹框壳（plans/11 §3-5 / #8）：四态控件（最小化/最大化/全屏），打开默认最大化。
 * 编辑核心在 ContentEditorCore（dialog/page 两壳共用）。
 * - 最小化：弹框隐藏，收为可拖拽悬浮条（复用 TransferPanel useDraggable 范式），点击标题栏复原
 * - 最大化：铺满整个应用可视区（100vw×100vh、margin 0）；全屏：进出还原进入前模式（2026-11-20）
 * - 富文本 fullScreen() 是 @sshk/rich-text 内部 Teleport 到 body + z-index 满级，天然盖住本弹框
 *
 * ⚠️ 弹框节点样式必须放非 scoped 全局块（项目已知坑：teleport 到 body 的节点上没有本组件
 *   的 data-v 属性，:deep() 打不进去）；本模板自绘元素（.ce-head/.ce-body 等）可走 scoped。
 * 滚动口径（用户 2026-11-19）：滚动层 = .ce-body，头部/脚部不随内容滚；
 * 弹框自身 padding 归零，滚动条贴弹框最右缘，留白由 .ce-head/.ce-content 自身 padding 补偿。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDraggable } from '@vueuse/core'
import { Rank } from '@element-plus/icons-vue'
// 窗口四态图标用 FA（Windows 风格，EP icons 无对应；fa-window-* 全局 CSS 已在 main.ts 注册）
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
/** 进入全屏前的窗口模式：退出全屏还原到它（用户 2026-11-20：全屏可还原，不强制回最大化） */
const preFullscreenMode = ref<WinMode>('maximized')
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

function setMode(mode: WinMode): void {
  // 全屏进出：进入时记住当前模式，退出时还原（而非强制回最大化）
  if (mode === 'fullscreen') { preFullscreenMode.value = winMode.value; winMode.value = 'fullscreen' }
  else if (winMode.value === 'fullscreen') winMode.value = preFullscreenMode.value
  else winMode.value = mode
  minimized.value = false
}
/** 最小化：贴底右侧停靠（用户 2026-11-20：参考传输面板收起条——位置确定可找、手柄显示标题、点击复原） */
function doMinimize(): void {
  minimized.value = true
  void nextTick(() => {
    const w = barRef.value?.offsetWidth ?? 280
    const h = barRef.value?.offsetHeight ?? 40
    x.value = Math.max(8, (window.innerWidth ?? 1200) - w - 16)
    y.value = Math.max(8, (window.innerHeight ?? 800) - h - 12)
  })
}
/** 由父组件触发复原（用户选择「继续编辑」时） */
function restore(): void { minimized.value = false; winMode.value = 'maximized' }
function doClose(): void { minimized.value = false; visible.value = false }
function submit(): void { coreRef.value?.submit() }
defineExpose({ submit, canSave: () => Boolean(coreRef.value?.canSave), restore, isMinimized: () => minimized.value })

// 向上同步最小化态，父组件据此在其它编辑操作触发时二次确认
watch(minimized, (m) => { if (visible.value) emit('update:minimized', m) })

const dialogVisible = computed({
  get: () => visible.value && !minimized.value,
  // ⚠️ EP dialog 在关闭动画结束（afterLeave）会回发 update:modelValue=false——包括最小化这种
  // 程序性隐藏（useDialog.mjs:85 实锤）。若当作用户关闭处理，最小化条刚挂出就被 doClose 拆掉
  //（「最小化后找不到弹框」根因，2026-11-20）。本弹框所有关闭入口（footer 取消 / 标题栏 ✕）都直调 doClose，setter 无需做事。
  set: () => {},
})

const barRef = ref<HTMLElement | null>(null)
const barHandleRef = ref<HTMLElement | null>(null)
const { x, y } = useDraggable(barRef, {
  handle: barHandleRef,
  preventDefault: true,
  stopPropagation: true,
})
// 拖出视口防丢（TransferPanel 同款口径）：横纵各留 80px 可见，任何时候都能抓回来
function clampBar(): void {
  const w = barRef.value?.offsetWidth ?? 280
  const vw = window.innerWidth ?? 1200
  const vh = window.innerHeight ?? 800
  x.value = Math.min(Math.max(x.value, 8 - w + 80), vw - 80)
  y.value = Math.min(Math.max(y.value, 0), vh - 40)
}
watch([x, y], () => clampBar(), { flush: 'sync' })
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
          <!-- 窗口四态图标（Windows 风格 FA）：最小化=底部横条；最大化/还原=方框↔双叠方框；全屏=展开↔收拢；关闭=✕ -->
          <el-tooltip content="最小化" placement="bottom"><button class="ce-btn" aria-label="最小化" @click="doMinimize"><i class="fa-solid fa-window-minimize"></i></button></el-tooltip>
          <el-tooltip :content="winMode === 'normal' ? '最大化' : '还原'" placement="bottom">
            <button class="ce-btn" aria-label="最大化/还原" @click="setMode(winMode === 'normal' ? 'maximized' : 'normal')">
              <i :class="winMode === 'normal' ? 'fa-regular fa-window-maximize' : 'fa-regular fa-window-restore'"></i>
            </button>
          </el-tooltip>
          <el-tooltip :content="winMode === 'fullscreen' ? '退出全屏' : '全屏'" placement="bottom">
            <button class="ce-btn" aria-label="全屏" @click="setMode(winMode === 'fullscreen' ? 'normal' : 'fullscreen')">
              <i :class="winMode === 'fullscreen' ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
            </button>
          </el-tooltip>
          <el-tooltip content="关闭" placement="bottom">
            <button class="ce-btn" aria-label="关闭" @click="doClose"><i class="fa-solid fa-xmark"></i></button>
          </el-tooltip>
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

    <!-- 最小化悬浮条（传输面板收起条同款）：默认贴底右侧、手柄拖拽、点标题复原、✕ 关闭 -->
    <div v-if="minimized" ref="barRef" class="ce-mini-bar" :style="{ left: `${x}px`, top: `${y}px` }">
      <span ref="barHandleRef" class="ce-mini-handle" aria-hidden="true"><el-icon><Rank /></el-icon></span>
      <span class="ce-mini-title" :title="editTitle" @click="restore()"><i class="fa-regular fa-window-restore"></i>{{ editTitle }}（已最小化 · 点击展开）</span>
      <button class="ce-btn" aria-label="关闭" @click="doClose">✕</button>
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
.ce-mini-bar { position: fixed; z-index: 4000; display: flex; align-items: center; gap: 6px; background: var(--el-bg-color); border: 1px solid var(--el-border-color); box-shadow: var(--el-box-shadow-light); border-radius: 6px; padding: 5px 8px; max-width: 380px; }
.ce-mini-handle { cursor: grab; color: var(--el-text-color-placeholder); display: inline-flex; align-items: center; padding: 2px; flex: none; }
.ce-mini-title { cursor: pointer; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
.ce-mini-title i { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
.ce-btn { font-size: 13px; }
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
