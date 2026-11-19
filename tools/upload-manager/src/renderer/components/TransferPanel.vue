<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDraggable } from '@vueuse/core'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Aim, CircleClose, Delete, Rank, RefreshRight, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { fsFormatSize, type FsMultipartStatus, type FsTransferTask } from '@sshk/shared'

/**
 * 传输队列悬浮面板（plans/10 §3，替代旧 el-drawer）：
 * - 悬浮于文件列表之上：非文档流、无遮罩、不锁页面，列表始终可滚动/右键/翻目录
 * - useDraggable 拖拽（手柄 ⠿），展开态与收起态均可拖；位置/展开态/分栏/过滤记忆
 * - 全部/上传/下载/其它 分栏 + 名称搜索；全局 ▶ ⏸ ⏹ ↻ 🗑；单条按状态显隐
 * - 危险操作（停止/清理/移除）一律二次确认（禁遮罩/禁 ESC）；按钮语义配色
 */

const props = defineProps<{ tasks: FsTransferTask[] }>()
const expanded = defineModel<boolean>('expanded', { default: false })
const emit = defineEmits<{ (e: 'visible-change', v: boolean): void }>()

const STORE_KEY = 'sshk.fs.transferPanel.v2' // v2：默认位置改底部（用户 2026-11-19），旧记忆作废走新默认
type TabKey = 'all' | 'upload' | 'download' | 'other'

interface PanelState { x: number; y: number; expanded: boolean; tab: TabKey; filter: string }

function defaultPosition(): { x: number; y: number } {
  // 用户 2026-11-19：默认贴底（收起条落在列表底部、状态条上方、右缘近「传输队列」按钮）
  const barH = 36
  const statusH = 28
  return {
    x: Math.max(8, (window.innerWidth ?? 1200) - 472),
    y: Math.max(8, (window.innerHeight ?? 800) - barH - statusH - 9),
  }
}
function loadState(): PanelState {
  const dft: PanelState = { ...defaultPosition(), expanded: false, tab: 'all', filter: '' }
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '') as Partial<PanelState>
    return {
      x: Number.isFinite(raw.x) ? Number(raw.x) : dft.x,
      y: Number.isFinite(raw.y) ? Number(raw.y) : dft.y,
      expanded: raw.expanded === true,
      tab: raw.tab === 'upload' || raw.tab === 'download' || raw.tab === 'other' ? raw.tab : 'all',
      filter: typeof raw.filter === 'string' ? raw.filter : '',
    }
  } catch {
    return dft
  }
}

const init = loadState()
// 展开/收起态按上次记忆（首次进入默认收起；状态条摘要条有活动任务时由页面高亮）
expanded.value = init.expanded
const tab = ref<TabKey>(init.tab)
const filter = ref(init.filter)
const panelRef = ref<HTMLElement | null>(null)
const handleRef = ref<HTMLElement | null>(null)
const hidden = ref(false)
/** 拖拽守卫：onMove 移动过才算拖拽，pointerup 后的 click 不再触发展开/收起 */
let dragMoved = false
// 修复（用户 2026-11-19「拖拽无效」根因）：vueuse 的 useDraggable 只更新内部 position
// refs、不写 DOM——此前组件用本地 x/y 且从未同步，拖动时 position 变了面板纹丝不动。
// 现在直接解构其 x/y（可写 ref）作为位置唯一来源，clamp/复位/持久化全部写同一对 ref。
const { x, y, isDragging } = useDraggable(panelRef, {
  handle: handleRef,
  initialValue: { x: init.x, y: init.y },
  preventDefault: true,
  stopPropagation: true,
  onMove: () => { dragMoved = true },
  onEnd: () => { persist(); setTimeout(() => { dragMoved = false }, 0) },
})

/** 拖出视口防丢（用户 2026-11-19）：vueuse 的 restrictInView 只在传 containerElement 时生效
 *  （面板 fixed 悬浮无容器，传了等于没传），拖出视口后就抓不回来了。
 *  自行钳制：横向上左/右至少留 108px 可见，纵向顶边不高于视口顶、不沉到视口底 48px 以下——
 *  头部拖拽条永远有一段留在视口内，任何时候都能抓回来。 */
const MIN_VISIBLE_X = 108
const MIN_TOP_VISIBLE_Y = 48
function clampXY(nx: number, ny: number): { x: number; y: number } {
  const el = panelRef.value
  const w = el?.offsetWidth ?? 360
  const vw = window.innerWidth ?? 1200
  const vh = window.innerHeight ?? 800
  return {
    x: Math.min(Math.max(nx, MIN_VISIBLE_X - w), vw - MIN_VISIBLE_X),
    y: Math.min(Math.max(ny, 0), vh - MIN_TOP_VISIBLE_Y),
  }
}
watch([x, y], ([nx, ny]) => {
  const c = clampXY(nx, ny)
  if (c.x !== x.value) x.value = c.x
  if (c.y !== y.value) y.value = c.y
}, { flush: 'sync' })

function persist(): void {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    x: Math.round(x.value), y: Math.round(y.value),
    expanded: expanded.value, tab: tab.value, filter: filter.value,
  } satisfies PanelState))
}
watch([tab, filter, expanded], persist)

/** 窗口 resize：完整拉回可视区，防窗口缩放后面板在屏外 */
function clampIntoView(): void {
  const el = panelRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const maxX = Math.max(8, (window.innerWidth ?? 1200) - rect.width - 8)
  const maxY = Math.max(8, (window.innerHeight ?? 800) - rect.height - 8)
  x.value = Math.min(Math.max(8, x.value), maxX)
  y.value = Math.min(Math.max(8, y.value), maxY)
}
function resetPosition(): void {
  const d = defaultPosition()
  x.value = d.x
  y.value = d.y
  persist()
}
onMounted(() => {
  window.addEventListener('resize', clampIntoView)
  setTimeout(clampIntoView, 0)
})
onBeforeUnmount(() => window.removeEventListener('resize', clampIntoView))

// ── 分栏 / 过滤 / 计数 ──
function tabOf(t: FsTransferTask): Exclude<TabKey, 'all'> {
  if (t.kind === 'upload') return 'upload'
  if (t.kind === 'download') return 'download'
  return 'other'
}
const tabTasks = computed(() => props.tasks.filter((t) => tab.value === 'all' || tabOf(t) === tab.value))
const shownTasks = computed(() => {
  const kw = filter.value.trim().toLowerCase()
  return kw ? tabTasks.value.filter((t) => t.name.toLowerCase().includes(kw)) : tabTasks.value
})
function countOf(kind: Exclude<TabKey, 'all'>): { done: number; total: number } {
  const list = props.tasks.filter((t) => tabOf(t) === kind)
  return { done: list.filter((t) => t.status === 'success').length, total: list.length }
}
const uploadCount = computed(() => countOf('upload'))
const downloadCount = computed(() => countOf('download'))
const otherCount = computed(() => countOf('other'))
const activeCount = computed(() => props.tasks.filter((t) => ['queued', 'running', 'conflict', 'paused'].includes(t.status)).length)
const failedCount = computed(() => props.tasks.filter((t) => t.status === 'failed' || t.status === 'canceled').length)

// ── 展示 ──
function statusText(t: FsTransferTask): string {
  if (t.pausing) return '暂停中…'
  switch (t.status) {
    case 'queued': return '排队中'
    case 'running': return t.kind === 'delete' ? `删除中 ${t.transferred}/${t.size}` : '传输中'
    case 'paused': return '已暂停'
    case 'success': return '完成'
    case 'failed': return '失败'
    case 'canceled': return '已取消'
    case 'conflict': return '待确认'
    default: return t.status
  }
}
function kindLabel(t: FsTransferTask): string {
  switch (t.kind) {
    case 'upload': return '上传'
    case 'download': return '下载'
    case 'copy': return '复制'
    case 'cross': return '跨通道'
    default: return '删除'
  }
}
function kindTagType(t: FsTransferTask): 'success' | 'primary' | 'warning' | 'danger' {
  switch (t.kind) {
    case 'upload': return 'success'
    case 'download': return 'primary'
    case 'copy': return 'warning'
    case 'cross': return 'warning'
    default: return 'danger'
  }
}
function percentOf(t: FsTransferTask): number {
  if (t.status === 'success') return 100
  if (t.size > 0) return Math.min(100, Math.round((t.transferred / t.size) * 100))
  return t.status === 'running' ? 5 : 0
}
function fmtSpeed(v: number | undefined): string {
  if (!v || v <= 0) return ''
  return `${fsFormatSize(v)}/s`
}
function friendlyError(err: string | undefined): string {
  return String(err ?? '').replace(/^Error:\s*/, '')
}

// ── 控制（危险操作一律二次确认，禁遮罩/禁 ESC）──
function confirmBox(message: string, title: string): Promise<boolean> {
  return ElMessageBox.confirm(message, title, {
    confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
    closeOnClickModal: false, closeOnPressEscape: false,
  }).then(() => true, () => false)
}
async function ctl(action: string, ids?: string[], overwrite?: boolean): Promise<void> {
  try {
    await window.api.fs.transferControl({ action: action as never, ids, overwrite })
  } catch (err) {
    ElMessage.error((err as Error).message ?? String(err))
  }
}
async function stopTask(t: FsTransferTask): Promise<void> {
  if (!(await confirmBox(`停止「${t.name}」？分片任务会中止并清理服务端碎片，已传进度作废。`, '停止任务'))) return
  await ctl('stop', [t.id])
}
async function removeTask(t: FsTransferTask): Promise<void> {
  if (!(await confirmBox(`从队列移除「${t.name}」？（不删除已传输的文件）`, '移除任务'))) return
  await ctl('remove', [t.id])
}
async function retryTask(t: FsTransferTask): Promise<void> {
  await ctl('retry', [t.id])
}
async function overwriteTask(t: FsTransferTask): Promise<void> {
  await ctl('retry', [t.id], true)
  ElMessage.info('已按覆盖执行')
}
async function stopAll(): Promise<void> {
  if (!activeCount.value) return
  if (!(await confirmBox(`停止全部 ${activeCount.value} 个未完结任务？分片任务会中止并清理服务端碎片。`, '全部停止'))) return
  await ctl('stopAll')
}
async function retryFailed(): Promise<void> {
  if (!failedCount.value) return
  await ctl('retryFailed')
}
/** 清除全部（用户 2026-11-19）：停止全部进行中任务并移除所有任务记录，二次确认 */
async function clearAllTasks(): Promise<void> {
  if (!props.tasks.length) return
  if (!(await confirmBox(`清除全部 ${props.tasks.length} 个任务记录？进行中的任务会停止并一并移除（不删除已传输的文件）。`, '清除全部'))) return
  await ctl('clearAll')
}

// ── 遗留分片（崩溃遗留 uploadId；面板展示 + 手动清理，二次确认）──
const mpStatus = ref<FsMultipartStatus | null>(null)
async function loadMultipart(): Promise<void> {
  try { mpStatus.value = await window.api.fs.transferMultipart() } catch { mpStatus.value = null }
}
async function cleanOrphans(): Promise<void> {
  if (!mpStatus.value?.orphans) return
  if (!(await confirmBox(`清理服务端遗留的 ${mpStatus.value.orphans} 个分片上传？正在别处进行的同名上传会被中止。`, '遗留分片清理'))) return
  try {
    const n = await window.api.fs.cleanOrphanUploads()
    ElMessage.success(n ? `已清理 ${n} 个遗留分片` : '没有可清理的遗留分片')
    await loadMultipart()
  } catch (err) {
    ElMessage.error((err as Error).message ?? String(err))
  }
}
watch(expanded, (v) => { if (v) void loadMultipart() })
onMounted(() => { if (expanded.value) void loadMultipart() })

defineExpose({
  show: (): void => { hidden.value = false; expanded.value = true },
})
</script>

<template>
  <div
    v-if="!hidden"
    ref="panelRef"
    class="fs-tpanel"
    :class="{ 'is-collapsed': !expanded, 'is-dragging': isDragging }"
    :style="{ left: `${x}px`, top: `${y}px`, transform: 'none' }"
    @dragenter.stop.prevent @dragover.stop.prevent @drop.stop
    @pointerdown.stop
  >
    <!-- 收起态：窄摘要条（仍可拖拽，点摘要区展开） -->
    <template v-if="!expanded">
      <div
        ref="handleRef"
        class="fs-tpanel-bar"
        @click="() => { if (!dragMoved) { expanded = true } }"
      >
        <el-icon class="fs-tpanel-handle"><Rank /></el-icon>
        <span class="fs-tpanel-bar-title" :class="{ 'is-active': activeCount > 0 }">队列</span>
        <span class="fs-tpanel-bar-meta">
          上传{{ uploadCount.done }}/{{ uploadCount.total }} · 下载{{ downloadCount.done }}/{{ downloadCount.total }}
          <template v-if="failedCount"> · <span class="fs-tpanel-fail">失败{{ failedCount }}</span></template>
        </span>
        <span class="fs-spacer" />
        <el-button size="small" text type="primary" class="fs-tpanel-mini" @click.stop="expanded = true">展开</el-button>
        <el-button size="small" text class="fs-tpanel-mini" @click.stop="hidden = true; emit('visible-change', false)">✕</el-button>
      </div>
    </template>

    <!-- 展开态 -->
    <template v-else>
      <div ref="handleRef" class="fs-tpanel-head">
        <el-icon class="fs-tpanel-handle"><Rank /></el-icon>
        <span class="fs-tpanel-title">传输队列{{ activeCount ? `（${activeCount} 活动）` : '' }}</span>
        <span class="fs-spacer" />
        <el-tooltip content="回到默认位置" placement="top">
          <el-button size="small" text :icon="Aim" class="fs-tpanel-mini" @click.stop="resetPosition" />
        </el-tooltip>
        <el-button size="small" text class="fs-tpanel-mini" @click.stop="expanded = false">—</el-button>
        <el-button size="small" text class="fs-tpanel-mini" @click.stop="hidden = true; emit('visible-change', false)">✕</el-button>
      </div>

      <!-- 全局控制：开始/暂停/停止/失败重试（语义配色） -->
      <div class="fs-tpanel-tools">
        <el-button size="small" type="primary" plain :icon="VideoPlay" :disabled="!activeCount" @click="ctl('startAll')">全部开始</el-button>
        <el-button size="small" type="warning" plain :icon="VideoPause" :disabled="!activeCount" @click="ctl('pauseAll')">全部暂停</el-button>
        <el-button size="small" type="danger" plain :icon="CircleClose" :disabled="!activeCount" @click="stopAll">全部停止</el-button>
        <el-button size="small" type="warning" text :icon="RefreshRight" :disabled="!failedCount" @click="retryFailed">失败重试</el-button>
      </div>

      <!-- 搜索 + 清除全部（用户 2026-11-19 布局：搜索行在上、tab 行在下） -->
      <div class="fs-tpanel-filterrow">
        <el-input v-model="filter" size="small" clearable placeholder="按名称过滤" class="fs-tpanel-filter" />
        <el-button size="small" type="danger" plain :icon="Delete" :disabled="!tasks.length" @click="clearAllTasks">清除全部</el-button>
      </div>

      <!-- 分栏 -->
      <div class="fs-tpanel-tabs">
        <el-radio-group v-model="tab" size="small">
          <el-radio-button value="all">全部 {{ tasks.length }}</el-radio-button>
          <el-radio-button value="upload">上传 {{ uploadCount.done }}/{{ uploadCount.total }}</el-radio-button>
          <el-radio-button value="download">下载 {{ downloadCount.done }}/{{ downloadCount.total }}</el-radio-button>
          <el-radio-button value="other">其它 {{ otherCount.done }}/{{ otherCount.total }}</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 遗留分片提示（plans/10 §5：崩溃遗留 uploadId 手动清理入口） -->
      <div v-if="mpStatus && mpStatus.orphans > 0" class="fs-tpanel-orphans">
        <span>检测到服务端遗留分片 {{ mpStatus.orphans }} 个（崩溃/停止残留）</span>
        <el-button size="small" type="danger" text @click="cleanOrphans">清理…</el-button>
      </div>

      <!-- 任务列表 -->
      <div class="fs-tpanel-list">
        <div v-if="!shownTasks.length" class="fs-tpanel-empty">暂无传输任务</div>
        <div v-for="t in shownTasks" :key="t.id" class="fs-tpanel-task" :class="`is-${t.status}`">
          <div class="fs-tpanel-task-head">
            <el-tag size="small" :type="kindTagType(t)">{{ kindLabel(t) }}</el-tag>
            <span class="fs-tpanel-task-name" :title="t.remotePath ?? t.localPath">{{ t.name }}</span>
            <span class="fs-tpanel-task-meta">{{ t.kind === 'cross' ? `${t.profileName} → ${t.destProfileName}` : t.profileName }}</span>
            <span class="fs-spacer" />
            <span v-if="t.status === 'running' && !t.pausing" class="fs-tpanel-speed">{{ fmtSpeed(t.speed) }}</span>
            <span class="fs-tpanel-status">{{ statusText(t) }}</span>
            <el-button v-if="t.status === 'queued'" size="small" text type="primary" @click="ctl('start', [t.id])">开始</el-button>
            <el-button v-if="t.status === 'running' && !t.pausing" size="small" text type="warning" @click="ctl('pause', [t.id])">暂停</el-button>
            <el-button v-if="t.status === 'paused'" size="small" text type="primary" @click="ctl('resume', [t.id])">继续</el-button>
            <el-button v-if="t.status === 'conflict'" size="small" text type="warning" @click="overwriteTask(t)">覆盖</el-button>
            <el-button v-if="t.status === 'failed' || t.status === 'canceled'" size="small" text type="primary" @click="retryTask(t)">重试</el-button>
            <el-button
              v-if="['queued', 'running', 'paused', 'conflict'].includes(t.status)"
              size="small" text type="danger" @click="stopTask(t)"
            >停止</el-button>
            <el-button v-if="['success', 'failed', 'canceled'].includes(t.status)" size="small" text type="danger" @click="removeTask(t)">移除</el-button>
          </div>
          <div v-if="t.resumable" class="fs-tpanel-resume">
            <el-tag size="small" type="warning" effect="plain">断点续传</el-tag>
            <span v-if="t.partsTotal"> {{ t.partsDone ?? 0 }}/{{ t.partsTotal }} 片</span>
          </div>
          <el-progress
            v-if="t.status !== 'failed' && t.status !== 'canceled'"
            :percentage="percentOf(t)"
            :status="t.status === 'success' ? 'success' : t.status === 'conflict' ? 'warning' : undefined"
            :stroke-width="5"
          />
          <div v-if="t.error" class="fs-tpanel-error">{{ friendlyError(t.error) }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 悬浮面板：fixed + z-index 只高于列表（低于 el-overlay 弹框）；不参与 flex 布局。
   尺寸（用户 2026-11-19：原 380/420 过挤错位）加宽加高一档 */
.fs-tpanel {
  position: fixed;
  z-index: 1400;
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: min(560px, calc(100vh - 90px));
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
  overflow: hidden;
}
.fs-tpanel.is-dragging { box-shadow: var(--el-box-shadow); user-select: none; }
.fs-tpanel.is-collapsed { width: 360px; max-height: none; }
.fs-tpanel-handle { color: var(--el-text-color-secondary); cursor: grab; flex: none; }
.fs-tpanel.is-dragging .fs-tpanel-handle { cursor: grabbing; }

.fs-tpanel-bar { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; cursor: default; }
.fs-tpanel-bar-title { font-weight: 600; font-size: 13px; }
.fs-tpanel-bar-title.is-active { color: var(--el-color-primary); }
.fs-tpanel-bar-meta { font-size: 12px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-tpanel-fail { color: var(--el-color-danger); }
.fs-tpanel-mini { padding: 0 4px; height: 22px; min-height: 0; }

.fs-tpanel-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 6px; cursor: grab; user-select: none; }
.fs-tpanel.is-dragging .fs-tpanel-head { cursor: grabbing; }
.fs-tpanel-title { font-weight: 600; font-size: 13px; }

.fs-tpanel-tools { display: flex; align-items: center; gap: 6px; padding: 0 10px 6px; flex-wrap: wrap; }
.fs-tpanel-tools .el-button + .el-button { margin-left: 0; }
.fs-tpanel-tools .el-button.is-text { padding: 0 6px; }

/* 搜索 + 清除全部一行（用户 2026-11-19）；输入框沾满剩余空间（项目约定） */
.fs-tpanel-filterrow { display: flex; align-items: center; gap: 8px; padding: 0 10px 8px; }
.fs-tpanel-filter { flex: 1; min-width: 0; }

.fs-tpanel-tabs { display: flex; align-items: center; gap: 8px; padding: 0 10px 8px; flex-wrap: wrap; }

.fs-tpanel-orphans { display: flex; align-items: center; gap: 8px; margin: 0 10px 8px; padding: 6px 10px; border-radius: 6px; background: var(--el-color-warning-light-9); font-size: 12px; color: var(--el-color-warning-dark-2, var(--el-color-warning)); }

.fs-tpanel-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
.fs-tpanel-empty { text-align: center; opacity: .55; font-size: 12px; padding: 24px 0; }
.fs-tpanel-task { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 6px 8px; }
.fs-tpanel-task-head { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.fs-tpanel-task-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.fs-tpanel-task-meta { font-size: 12px; opacity: .6; flex: none; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-tpanel-speed { font-size: 12px; color: var(--el-color-primary); flex: none; }
.fs-tpanel-status { font-size: 12px; flex: none; }
.fs-tpanel-task .el-button.is-text { padding: 0 4px; height: 22px; min-height: 0; flex: none; }
.fs-tpanel-task.is-failed .fs-tpanel-status { color: var(--el-color-danger); }
.fs-tpanel-task.is-conflict .fs-tpanel-status { color: var(--el-color-warning); }
.fs-tpanel-task.is-success .fs-tpanel-status { color: var(--el-color-success); }
.fs-tpanel-task.is-paused .fs-tpanel-status { color: var(--el-text-color-secondary); }
.fs-tpanel-resume { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .8; margin-bottom: 4px; }
.fs-tpanel-error { font-size: 12px; color: var(--el-color-danger); margin-top: 2px; word-break: break-all; }
.fs-spacer { flex: 1; }
</style>
