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
  /** 收起前分组开合快照：收起态 hover 全展开是临时的，离开/展开后必须原样还原（用户口径） */
  let preCollapseOpenIds: Set<string> | null = null

  function restoreOpenIds(): void {
    if (preCollapseOpenIds) {
      openIds.value = new Set(preCollapseOpenIds)
      preCollapseOpenIds = null
    }
  }
  function onEnter(): void {
    if (!collapsed.value) return
    if (hoverTimer !== undefined) { window.clearTimeout(hoverTimer); hoverTimer = undefined }
    // 首次 hover 才快照（收起态多次 hover 不覆盖原始状态）
    if (!preCollapseOpenIds) preCollapseOpenIds = new Set(openIds.value)
    openIds.value = new Set(collectGroupIds(menus()))
    hover.value = true
  }
  function onLeave(): void {
    if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => {
      hover.value = false
      restoreOpenIds() // 离开窄轨：还原收起前的分组开合
    }, 140)
  }
  function toggleGroup(id: string): void { toggleIn(openIds, id) }

  watch(collapsed, (value) => {
    if (value) {
      // 刚收起：快照当前开合（hover 未介入时的真实状态）
      preCollapseOpenIds = new Set(openIds.value)
    } else {
      // 手动展开（footer 钮）：清延时、复位 hover、还原快照，回到收起前原样
      if (hoverTimer !== undefined) { window.clearTimeout(hoverTimer); hoverTimer = undefined }
      restoreOpenIds()
      hover.value = false
    }
  })
  onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer) })

  return { hover, openIds, expanded, onEnter, onLeave, toggleGroup }
}
