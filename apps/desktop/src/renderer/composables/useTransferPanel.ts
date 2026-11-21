import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { FsTransferTask } from '@sshk/shared'

/**
 * 传输面板全局单例（P4-7 · 总计划 §五.4「传输面板全局悬浮」/ C-8 不设任何传输设置入口）：
 * - TransferPanel 组件挂 App.vue 根层，跨桌面/应用管理/工具宿主三容器可用，任何页面可唤起；
 * - 本 composable 是面板状态与任务数据的单一真相源：
 *   · visible/expanded：收起摘要条显隐与展开态（展开态不持久化，用户 2026-11-19 口径：唤起才展开）；
 *   · tasks/taskList：App 级订阅 fs.onTransferEvent 增量 + transferList 恢复——页面切换不丢任务，
 *     文件管理页卸载后传输仍在面板持续可见（全局化前任务数据随页面销毁重建）；
 *   · runningCount：状态条「N 进行中」（queued/running/conflict）；
 *   · show()/hide()：唤起（可见+展开+showSeq 自增驱动回默认贴底位置 #127）/ 关闭。
 * - 消费方式两档（依赖方向铁律：apps -> tools -> packages 单向，tools 禁止反向 import apps）：
 *   · apps 内组件直接 import useTransferPanel()（App.vue / TransferPanel.vue）；
 *   · 工具页经 App.vue provide 的控制器 inject 消费——注入键 'sshk:transfer-panel'
 *     （TRANSFER_PANEL_KEY 与 FileExplorerPage 的 inject 字面量成对维护），
 *     控制器最小面 = { show(): void; runningCount: ComputedRef<number> }。
 */

/** provide/inject 注入键（App.vue provide ↔ tools/file-manager FileExplorerPage inject，成对维护） */
export const TRANSFER_PANEL_KEY = 'sshk:transfer-panel'

const visible = ref(true) // 收起摘要条默认贴底可见（原文件管理页内挂语义一致）；✕ 关闭后会话内保持隐藏
const expanded = ref(false)
/** show() 序号：重复唤起也要回默认位置（watch 需要变化源，计数器承载「再次弹出」语义） */
const showSeq = ref(0)
const tasks = ref(new Map<string, FsTransferTask>())
const taskList = computed(() => [...tasks.value.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)))
const runningCount = computed(() => taskList.value.filter((t) => ['running', 'queued', 'conflict'].includes(t.status)).length)

// App 级订阅一次：面板随 App 常驻 = 应用生命周期，不退订（CR-40 退订函数存在，此处生命周期即应用本身）
let subscribed = false
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.api.fs.onTransferEvent((task) => {
    tasks.value.set(task.id, task)
    tasks.value = new Map(tasks.value)
  })
  // 队列已有历史任务（页面刷新恢复）；未就绪静默，事件到达时自然补齐
  void window.api.fs.transferList().then((list) => {
    for (const t of list) tasks.value.set(t.id, t)
    tasks.value = new Map(tasks.value)
  }).catch(() => { /* 静默 */ })
}

/** 唤起面板：可见 + 展开；showSeq 自增驱动面板回默认贴底位置（#127 弹出即回位） */
function show(): void {
  ensureSubscribed()
  visible.value = true
  expanded.value = true
  showSeq.value++
}

/** 关闭（✕）：仅收起可见性并复位展开态；下次唤起仍直接展开 */
function hide(): void {
  visible.value = false
  expanded.value = false
}

export function useTransferPanel(): {
  visible: Ref<boolean>
  expanded: Ref<boolean>
  showSeq: Ref<number>
  taskList: ComputedRef<FsTransferTask[]>
  runningCount: ComputedRef<number>
  show: typeof show
  hide: typeof hide
} {
  ensureSubscribed()
  return { visible, expanded, showSeq, taskList, runningCount, show, hide }
}
