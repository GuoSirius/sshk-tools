import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { ToolMenu } from '@sshk/shared'

/** 收集菜单树全部分组 id（含任意层级；hover 展开与「进入预展开」共用） */
export function collectGroupIds(items: ToolMenu[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (item.children?.length) ids.push(item.id, ...collectGroupIds(item.children))
  }
  return ids
}

function toggleIn(target: Ref<Set<string>>, id: string): void {
  const next = new Set(target.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  target.value = next
}

/**
 * 左侧递归菜单的展开/收起状态单点（ToolShellLayout 工具侧栏 ↔ AppAdminPage 应用管理侧栏共用，
 * 复用监督清单：同一逻辑 ≥2 处必须提取——2026-11-22 应用管理侧栏补窄轨 + hover 展开时上收）：
 * - openIds：分组开合（激活链预展开等增值语义由消费方自行叠加）；
 * - collapsed：收起态由壳层持有；hover 时侧栏本体就地平滑展开（不弹独立浮层）——
 *   enter 全分组展开让多级菜单一眼可见，leave 140ms 延时回落成图标轨；
 * - expanded = 展开 || hover：传给 SidebarMenu 的 show-children（窄轨只留一级图标）。
 */
export function useSidebarNav(options: {
  /** 菜单树访问器（props/常量皆可，函数式避免 reactive 解构丢响应） */
  menus: () => ToolMenu[]
  collapsed: Ref<boolean>
}): {
  hover: Ref<boolean>
  openIds: Ref<Set<string>>
  expanded: Ref<boolean>
  onEnter: () => void
  onLeave: () => void
  toggleGroup: (id: string) => void
} {
  const { menus, collapsed } = options
  const hover = ref(false)
  const openIds = ref<Set<string>>(new Set())
  const expanded = computed(() => !collapsed.value || hover.value)
  let hoverTimer: number | undefined

  function onEnter(): void {
    if (!collapsed.value) return
    if (hoverTimer !== undefined) { window.clearTimeout(hoverTimer); hoverTimer = undefined }
    openIds.value = new Set(collectGroupIds(menus()))
    hover.value = true
  }
  function onLeave(): void {
    if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => { hover.value = false }, 140)
  }
  function toggleGroup(id: string): void { toggleIn(openIds, id) }

  // 手动展开（footer 钮）后复位 hover 态，回到常规展开语义
  watch(collapsed, (value) => { if (!value) hover.value = false })
  onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer) })

  return { hover, openIds, expanded, onEnter, onLeave, toggleGroup }
}
