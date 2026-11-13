<script setup lang="ts">
import {
  computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch,
  type Component, type Ref,
} from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_THEME_MODE } from '@sshk/shared'
import type { ThemeMode, ToolMenu } from '@sshk/shared'
import { TOOLS } from './registry/tools'
import { useTheme } from './composables/useTheme'
import SettingsPage from './SettingsPage.vue'
import SidebarMenu from './components/SidebarMenu.vue'
import logoUrl from '../../build/icon.svg'

// 工具页按需加载；新增工具在此登记一条映射即可
const TOOL_COMPONENTS: Record<string, Component> = {
  'model-console': defineAsyncComponent(() => import('@sshk/model-console/renderer')),
  'badge-studio': defineAsyncComponent(() => import('@sshk/badge-studio/renderer')),
  'edm-studio': defineAsyncComponent(() => import('@sshk/edm-studio/renderer')),
}

const { mode, setMode } = useTheme()
const activeToolId = ref<string | null>(null)
const activeMenu = ref('')
const sidebarCollapsed = ref(false)
const flyoutOpen = ref(false)
const sideOpenIds = ref<Set<string>>(new Set())
const flyoutOpenIds = ref<Set<string>>(new Set())
const query = ref('')
const version = ref('0.1.0')
const updateChecking = ref(false)
let closeTimer: number | undefined

const currentTool = computed(() => TOOLS.find((tool) => tool.id === activeToolId.value) ?? null)
const isConfigMenu = computed(() => activeMenu.value === 'config' || activeMenu.value.startsWith('config-'))
const visibleTools = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return TOOLS
  return TOOLS.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(keyword))
})

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: '暗黑', value: 'dark' },
  { label: '亮色', value: 'light' },
  { label: '跟随系统', value: 'system' },
]

/** 找出 active 所在的分组链，保证激活项在任何层级都可见 */
function pathTo(items: ToolMenu[], active: string, parents: string[] = []): string[] | null {
  for (const item of items) {
    if (item.id === active) return parents
    if (item.children?.length) {
      const found = pathTo(item.children, active, [...parents, item.id])
      if (found) return found
    }
  }
  return null
}
function collectGroupIds(items: ToolMenu[]): string[] {
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

function openTool(id: string): void {
  const tool = TOOLS.find((item) => item.id === id)
  activeToolId.value = id
  activeMenu.value = tool?.menus[0]?.id ?? ''
  sideOpenIds.value = new Set(pathTo(tool?.menus ?? [], activeMenu.value) ?? [])
  flyoutOpenIds.value = new Set(collectGroupIds(tool?.menus ?? []))
  flyoutOpen.value = false
}
function goHome(): void { activeToolId.value = null; flyoutOpen.value = false }
function onThemeChange(next: ThemeMode): void { void setMode(next) }
function openDataDir(): void { void window.api.app.openDataDir() }

// ── 侧栏：展开态内联多级菜单 / 收起态图标轨 + hover 浮层 ──
function openFlyout(): void {
  if (!sidebarCollapsed.value) return
  if (closeTimer !== undefined) { window.clearTimeout(closeTimer); closeTimer = undefined }
  flyoutOpen.value = true
}
function scheduleClose(): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  // 留出鼠标从图标轨移到浮层的空隙，避免闪烁
  closeTimer = window.setTimeout(() => { flyoutOpen.value = false }, 180)
}
function onSidebarEnter(): void { if (sidebarCollapsed.value) openFlyout() }
function toggleSideGroup(id: string): void {
  if (sidebarCollapsed.value) {
    flyoutOpenIds.value = new Set(collectGroupIds(currentTool.value?.menus ?? []))
    openFlyout()
    return
  }
  toggleIn(sideOpenIds, id)
}
function toggleFlyoutGroup(id: string): void { toggleIn(flyoutOpenIds, id) }
function selectMenu(id: string): void {
  activeMenu.value = id
  const path = pathTo(currentTool.value?.menus ?? [], id) ?? []
  sideOpenIds.value = new Set([...sideOpenIds.value, ...path])
  flyoutOpen.value = false
}

watch(sidebarCollapsed, (collapsed) => { if (!collapsed) flyoutOpen.value = false })
onBeforeUnmount(() => { if (closeTimer !== undefined) window.clearTimeout(closeTimer) })

async function checkUpdate(): Promise<void> {
  if (updateChecking.value) return
  updateChecking.value = true
  try {
    const result = await window.api.update.check()
    if (result.dev) {
      ElMessage.info('开发环境不检查更新')
    } else if (result.updateAvailable) {
      ElMessage.success(`发现新版本 ${result.version ?? ''}，可在发布页下载或稍后自动安装`)
    } else {
      ElMessage.success('当前已是最新版本')
    }
  } catch {
    ElMessage.error('检查更新失败，请稍后重试')
  } finally {
    updateChecking.value = false
  }
}

onMounted(async () => {
  version.value = await window.api.app.version().catch(() => '0.1.0')
})
</script>

<template>
  <div class="app-shell">
    <!-- 应用级：任意页面可见可用 -->
    <header class="app-bar">
      <img class="app-logo" :src="logoUrl" alt="sshk-tools" />
      <span class="app-title">sshk-tools</span>
      <el-button size="small" text @click="goHome">桌面</el-button>
      <span class="app-spacer" />
      <el-select
        :model-value="mode || DEFAULT_THEME_MODE"
        size="small"
        style="width: 118px"
        @change="onThemeChange"
      >
        <el-option v-for="opt in themeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <el-button size="small" text @click="openDataDir">数据目录</el-button>
      <el-tag size="small" type="info">模型：未配置</el-tag>
      <el-button size="small" text :loading="updateChecking" @click="checkUpdate">检查更新</el-button>
    </header>

    <div class="app-body">
      <!-- 工具级：左侧 = 当前工具的全部功能菜单（含多级）；收起后 hover 浮层展开 -->
      <aside
        v-if="currentTool"
        class="tool-sidebar"
        :class="{ collapsed: sidebarCollapsed }"
        @mouseenter="onSidebarEnter"
        @mouseleave="scheduleClose"
      >
        <div class="sidebar-menu">
          <div class="sidebar-head">
            <span class="sidebar-badge">{{ currentTool.name.slice(0, 1) }}</span>
            <div class="sidebar-head-text">
              <strong>{{ currentTool.name }}</strong>
              <small>{{ currentTool.category }}</small>
            </div>
          </div>
          <SidebarMenu
            :items="currentTool.menus"
            :active="activeMenu"
            :open-ids="sideOpenIds"
            :show-children="!sidebarCollapsed"
            :toggle-group="toggleSideGroup"
            :select-item="selectMenu"
          />
        </div>
        <div class="sidebar-footer">
          <button
            class="sidebar-toggle"
            :title="sidebarCollapsed ? '展开菜单' : '收起菜单'"
            :aria-label="sidebarCollapsed ? '展开菜单' : '收起菜单'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="13 6 7 12 13 18" />
              <polyline points="19 6 13 12 19 18" />
            </svg>
            <span class="toggle-text">收起菜单</span>
          </button>
        </div>
      </aside>

      <!-- 收起态 hover 浮层：完整菜单树（支持任意层级），不挤压内容区 -->
      <Transition name="flyout">
        <div
          v-if="currentTool && sidebarCollapsed && flyoutOpen"
          class="sidebar-flyout"
          @mouseenter="openFlyout"
          @mouseleave="scheduleClose"
        >
          <div class="flyout-head">
            <span class="sidebar-badge">{{ currentTool.name.slice(0, 1) }}</span>
            <div class="flyout-title">
              <strong>{{ currentTool.name }}</strong>
              <small>全部功能菜单</small>
            </div>
          </div>
          <div class="flyout-body">
            <SidebarMenu
              :items="currentTool.menus"
              :active="activeMenu"
              :open-ids="flyoutOpenIds"
              :toggle-group="toggleFlyoutGroup"
              :select-item="selectMenu"
            />
          </div>
          <div class="flyout-foot">
            <button class="flyout-pin" type="button" @click="sidebarCollapsed = false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
              固定展开侧栏
            </button>
          </div>
        </div>
      </Transition>

      <main class="tool-content">
        <!-- 桌面首页：工具卡片 -->
        <template v-if="!currentTool">
          <div class="tool-page-head">
            <el-input v-model="query" placeholder="搜索工具" clearable style="max-width: 280px" />
          </div>
          <div class="desktop">
            <div class="desktop-grid">
              <article v-for="tool in visibleTools" :key="tool.id" class="tool-card" @click="openTool(tool.id)">
                <div class="card-mark">
                  <i style="background:#22d3ee" /><i style="background:#4f8cff" />
                  <i style="background:#8b7cf6" /><i style="background:#ff9f43" />
                </div>
                <h3 style="margin: 14px 0 6px">{{ tool.name }}</h3>
                <p class="muted" style="margin: 0; line-height: 1.6">{{ tool.description }}</p>
                <el-tag size="small" style="margin-top: 12px">{{ tool.category }}</el-tag>
              </article>
            </div>
            <div v-if="visibleTools.length === 0" class="empty-state">没有匹配的工具</div>
          </div>
        </template>

        <!-- 工具内页：配置管理 / 工具页（menu 驱动视图） -->
        <template v-else-if="isConfigMenu">
          <SettingsPage :section="activeMenu" />
        </template>
        <template v-else>
          <component
            :is="TOOL_COMPONENTS[currentTool.id]"
            v-if="TOOL_COMPONENTS[currentTool.id]"
            :menu="activeMenu"
          />
          <template v-else>
            <div class="tool-page-head">
              <strong>{{ currentTool.name }}</strong>
              <span class="muted" style="margin-left: 12px">{{ currentTool.description }}</span>
            </div>
            <div class="tool-page-body">
              <div class="empty-state">
                该工具的功能页将在对应里程碑落地（当前顺序：M0 → 1 → 2 → 3 → 7 → 6 → 4 → 5）
              </div>
            </div>
            <div class="tool-page-foot muted">共 0 项 · 已选 0 项（跨页保留）</div>
          </template>
        </template>
      </main>
    </div>

    <footer class="status-bar">
      <span>v{{ version }}</span>
      <span>产物目录：默认（可在应用配置中修改）</span>
      <span class="app-spacer" />
      <span>北京时间</span>
      <span>就绪</span>
    </footer>
  </div>
</template>
