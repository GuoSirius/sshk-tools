<script setup lang="ts">
import type { ToolMenu } from '@sshk/shared'

defineOptions({ name: 'SidebarMenu' })

// 递归菜单节点：展开态与收起态 hover 就地展开共用同一套渲染。
const props = withDefaults(defineProps<{
  items: ToolMenu[]
  active: string
  openIds: Set<string>
  toggleGroup: (id: string) => void
  selectItem: (id: string) => void
  level?: number
  /** 收起态隐藏子级（图标轨只保留一级入口） */
  showChildren?: boolean
}>(), { level: 0, showChildren: true })

// 一级功能图标；子级用圆点，父级分组用齿轮兜底
const ICONS: Record<string, string> = {
  brands: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  templates: 'M4 4h16v4H4zM4 10h10v10H4zM16 10h4v10h-4z',
  fragments: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4',
  mails: 'M3 5h18v14H3zM3 6l9 7 9-7',
  generate: 'M4 20h16M6 16l9-9 3 3-9 9H6zM14 5l3 3',
  posters: 'M3 4h18v16H3zM3 15l5-5 4 4 3-3 6 6',
  providers: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  chat: 'M4 5h16v11H9l-5 4z',
  config: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
}
const DOT = 'M12 10a2 2 0 100 4 2 2 0 000-4z'

function iconPath(menu: ToolMenu): string {
  return ICONS[menu.id] ?? (menu.children?.length ? ICONS['config']! : DOT)
}
function containsActive(menu: ToolMenu): boolean {
  if (menu.id === props.active) return true
  return (menu.children ?? []).some(containsActive)
}
</script>

<template>
  <ul class="side-menu" :class="{ 'is-sub': level > 0 }">
    <li v-for="menu in items" :key="menu.id" class="side-node">
      <button
        v-if="menu.children?.length"
        type="button"
        class="side-row is-group"
        :class="{ 'is-open': openIds.has(menu.id), 'has-active': containsActive(menu) }"
        :title="menu.label"
        @click="toggleGroup(menu.id)"
      >
        <svg class="side-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath(menu)" /></svg>
        <span class="side-label">{{ menu.label }}</span>
        <svg class="side-chevron" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
      </button>
      <button
        v-else
        type="button"
        class="side-row"
        :class="{ 'is-active': active === menu.id }"
        :title="menu.label"
        @click="selectItem(menu.id)"
      >
        <svg class="side-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="iconPath(menu)" /></svg>
        <span class="side-label">{{ menu.label }}</span>
      </button>

      <Transition name="submenu">
        <SidebarMenu
          v-if="showChildren && menu.children?.length && openIds.has(menu.id)"
          :items="menu.children"
          :active="active"
          :open-ids="openIds"
          :level="level + 1"
          :show-children="showChildren"
          :toggle-group="toggleGroup"
          :select-item="selectItem"
        />
      </Transition>
    </li>
  </ul>
</template>
