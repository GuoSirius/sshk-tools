<script setup lang="ts">
import {
  computed, onBeforeUnmount, onMounted, ref, watch,
  type Ref,
} from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DEFAULT_THEME_MODE } from '@sshk/shared'
import type { ThemeMode, ToolMenu } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'
import { useTheme } from './composables/useTheme'
import { toolComponent } from './plugins'
import SidebarMenu from './components/SidebarMenu.vue'
import ToolIcon from './components/ToolIcon.vue'
import AppSettingsDrawer from './components/AppSettingsDrawer.vue'
import ToolSettingsPage from './SettingsPage.vue'
import logoUrl from '../../build/icon.svg'

const { mode, setMode } = useTheme()
const { visibleTools: catalogTools, byId } = useToolCatalog()
const activeToolId = ref<string | null>(null)
const activeMenu = ref('')
const sidebarCollapsed = ref(false)
/** 收起态 hover：侧栏本体平滑展开，不再弹独立浮层 */
const sidebarHover = ref(false)
const sideOpenIds = ref<Set<string>>(new Set())
const sidebarExpanded = computed(() => !sidebarCollapsed.value || sidebarHover.value)
const settingsOpen = ref(false)
const settingsGroup = ref('general')
const query = ref('')
const version = ref('0.1.0')
const updateChecking = ref(false)
let hoverTimer: number | undefined

// 可见性由主进程裁决：桌面首页与侧栏都只消费 catalog 结果
const currentTool = computed(() => byId.value.get(activeToolId.value ?? '') ?? null)
const isConfigMenu = computed(() => activeMenu.value === 'config' || activeMenu.value.startsWith('config-'))
// 渲染插件按清单动态加载，单个工具组件失败只影响它自己
const toolView = computed(() => currentTool.value ? toolComponent(currentTool.value.id) : null)
const visibleTools = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return catalogTools.value
  return catalogTools.value.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.categories.join(' ')}`.toLowerCase().includes(keyword))
})

/**
 * configLayout=menu 时把配置分组挂成「工具配置」的二级菜单；
 * single（默认）/tabs 都不生成左侧二级菜单，消除双重导航的割裂感。
 */
const sidebarMenus = computed(() => {
  const tool = currentTool.value
  if (!tool) return []
  if (tool.configLayout !== 'menu') return tool.menus
  return tool.menus.map((menu) => menu.id === 'config'
    ? { ...menu, children: tool.configGroups.map((group) => ({ id: group.id, label: group.label })) }
    : menu)
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

const ROUTE_KEY = 'sshk.route'
function rememberRoute(): void {
  try {
    if (activeToolId.value) sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ tool: activeToolId.value, menu: activeMenu.value }))
    else sessionStorage.removeItem(ROUTE_KEY)
  } catch { /* 隐私模式等场景忽略 */ }
}
function openTool(id: string): void {
  const tool = byId.value.get(id)
  if (!tool?.visible) return
  activeToolId.value = id
  activeMenu.value = sidebarMenus.value[0]?.id ?? ''
  sideOpenIds.value = new Set(pathTo(sidebarMenus.value, activeMenu.value) ?? [])
  rememberRoute()
}
function goHome(): void {
  activeToolId.value = null
  sidebarHover.value = false
  try { sessionStorage.removeItem(ROUTE_KEY) } catch { /* 忽略 */ }
}
function onThemeChange(next: ThemeMode): void { void setMode(next) }
function openDataDir(): void { void window.api.app.openDataDir() }
function openSettings(group = 'general'): void {
  settingsGroup.value = group
  settingsOpen.value = true
}
/** dev 随意开关；打包版先试无密钥（会抛错），再弹密钥输入（默认 sshk-tools@888） */
async function openDevTools(): Promise<void> {
  try {
    await window.api.app.toggleDevTools()
    return
  } catch { /* 打包版需要密钥 */ }
  try {
    const { value } = await ElMessageBox.prompt('打开开发者工具需要访问密钥', '开发者工具', {
      inputPlaceholder: '访问密钥',
      inputType: 'password',
      closeOnClickModal: false,
    })
    await window.api.app.toggleDevTools(String(value ?? ''))
  } catch (err) {
    const message = (err as Error).message
    if (message && message !== 'cancel') ElMessage.error(message)
  }
}
function onMoreCommand(command: string): void {
  if (command === 'dataDir') openDataDir()
  else if (command === 'reload') void window.api.app.reload()
  else if (command === 'reloadForce') void window.api.app.reload(true)
  else if (command === 'devtools') void openDevTools()
  else if (command === 'tools') openSettings('tools')
  else if (command === 'system') openSettings('system')
  else if (command === 'about') openSettings('about')
  else openSettings('general')
}

// 工具被禁用 / 权限撤销 / 分发分发剔除 / 插件加载失败后自动退回桌面
watch(catalogTools, (list) => {
  if (activeToolId.value && !list.some((tool) => tool.id === activeToolId.value)) goHome()
})

// 刷新（F5 / reload）后恢复上次页面：catalog 就绪即打开，sessionStorage 生命周期与应用一致
let pendingRoute: { tool?: string; menu?: string } | null = null
try {
  pendingRoute = JSON.parse(sessionStorage.getItem(ROUTE_KEY) ?? 'null')
} catch { pendingRoute = null }
watch(catalogTools, (list) => {
  if (!pendingRoute?.tool) return
  const hit = list.find((tool) => tool.id === pendingRoute!.tool)
  if (hit?.visible) {
    activeToolId.value = hit.id
    activeMenu.value = pendingRoute.menu || hit.menus[0]?.id || ''
    sideOpenIds.value = new Set(pathTo(sidebarMenus.value, activeMenu.value) ?? [])
  }
  pendingRoute = null
}, { once: true })

// ── 侧栏：同一棵菜单树，收起后 hover 让侧栏本体平滑变宽，不弹独立浮层 ──
function onSidebarEnter(): void {
  if (!sidebarCollapsed.value) return
  if (hoverTimer !== undefined) { window.clearTimeout(hoverTimer); hoverTimer = undefined }
  // hover 时把分组全部展开，多级菜单一眼可见；移开后自动收成图标轨
  sideOpenIds.value = new Set(collectGroupIds(sidebarMenus.value))
  sidebarHover.value = true
}
function onSidebarLeave(): void {
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
  hoverTimer = window.setTimeout(() => { sidebarHover.value = false }, 140)
}
function toggleSideGroup(id: string): void { toggleIn(sideOpenIds, id) }
function selectMenu(id: string): void {
  activeMenu.value = id
  const path = pathTo(sidebarMenus.value, id) ?? []
  sideOpenIds.value = new Set([...sideOpenIds.value, ...path])
  rememberRoute()
}

watch(sidebarCollapsed, (collapsed) => { if (!collapsed) sidebarHover.value = false })
onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer) })

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
    <!-- 应用级：高频操作平铺，低频收纳到「更多」，全部应用配置进设置抽屉 -->
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
      <el-button size="small" text :loading="updateChecking" @click="checkUpdate">检查更新</el-button>
      <el-dropdown trigger="click" @command="onMoreCommand">
        <el-button size="small" text>更多 ▾</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="reload">刷新页面（F5 / Ctrl+R）</el-dropdown-item>
            <el-dropdown-item command="reloadForce">强制刷新（Ctrl+F5 / Ctrl+Shift+R）</el-dropdown-item>
            <el-dropdown-item command="devtools">开发者工具</el-dropdown-item>
            <el-dropdown-item command="dataDir" divided>数据目录</el-dropdown-item>
            <el-dropdown-item command="tools">工具与权限</el-dropdown-item>
            <el-dropdown-item command="system">系统与数据</el-dropdown-item>
            <el-dropdown-item command="about">关于</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <button class="app-settings-btn" type="button" title="应用设置" @click="openSettings('general')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 9a3 3 0 100 6 3 3 0 000-6z" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
        <span>设置</span>
      </button>
    </header>

    <div class="app-body">
      <!-- 工具级：左侧 = 当前工具的全部功能菜单（含多级）；收起后 hover 就地平滑展开 -->
      <aside
        v-if="currentTool"
        class="tool-sidebar"
        :class="{ collapsed: sidebarCollapsed, hover: sidebarHover, 'is-narrow': !sidebarExpanded }"
        @mouseenter="onSidebarEnter"
        @mouseleave="onSidebarLeave"
      >
        <div class="sidebar-menu">
          <div class="sidebar-head">
            <ToolIcon :icon="currentTool.icon" :tool-id="currentTool.id" :name="currentTool.name" :size="28" />
            <div class="sidebar-head-text">
              <strong>{{ currentTool.name }}</strong>
              <small :title="currentTool.categories.join(' / ')">{{ currentTool.categories.join(' / ') }}</small>
            </div>
          </div>
          <SidebarMenu
            :items="sidebarMenus"
            :active="activeMenu"
            :open-ids="sideOpenIds"
            :show-children="sidebarExpanded"
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
            <!-- 文案随状态切换：展开态提示收起；收起态提示展开；hover 临时展开时提示固定 -->
            <span class="toggle-text">
              {{ sidebarCollapsed ? (sidebarHover ? '固定展开' : '展开菜单') : '收起菜单' }}
            </span>
          </button>
        </div>
      </aside>

      <main class="tool-content">
        <template v-if="!currentTool">
          <div class="tool-page-head">
            <el-input v-model="query" placeholder="搜索工具" clearable style="max-width: 280px" />
            <span class="muted" style="margin-left: 12px">共 {{ visibleTools.length }} 个工具 · 可见性由应用设置统一管理</span>
          </div>
          <div class="desktop">
            <div class="desktop-grid">
              <article v-for="tool in visibleTools" :key="tool.id" class="tool-card" @click="openTool(tool.id)">
                <ToolIcon :icon="tool.icon" :tool-id="tool.id" :name="tool.name" :size="44" />
                <h3 style="margin: 14px 0 6px">{{ tool.name }}</h3>
                <p class="muted card-desc" :title="tool.description">{{ tool.description }}</p>
                <div class="card-tags">
                  <el-tag v-for="tag in tool.categories" :key="tag" size="small">{{ tag }}</el-tag>
                  <el-tag v-if="tool.requiredGrant" size="small" type="warning">需密钥</el-tag>
                  <span v-if="tool.warnings.length" class="card-warn" :title="tool.warnings.join('；')">依赖提示</span>
                </div>
              </article>
            </div>
            <div v-if="visibleTools.length === 0" class="empty-state">没有匹配的工具（可在「设置 → 工具与权限」启用）</div>
          </div>
        </template>

        <!-- 工具内页：工具配置 / 插件页面（menu 驱动视图） -->
        <template v-else-if="isConfigMenu">
          <ToolSettingsPage
            :tool-id="currentTool.id"
            :section="activeMenu"
            :layout="currentTool.configLayout"
          />
        </template>
        <template v-else>
          <component :is="toolView" v-if="toolView" :menu="activeMenu" />
          <template v-else>
            <div class="tool-page-head">
              <strong>{{ currentTool.name }}</strong>
              <span class="muted" style="margin-left: 12px">{{ currentTool.description }}</span>
            </div>
            <div class="tool-page-body">
              <div class="empty-state">该工具没有可用的渲染插件</div>
            </div>
            <div class="tool-page-foot muted">共 0 项 · 已选 0 项</div>
          </template>
        </template>
      </main>
    </div>

    <footer class="status-bar">
      <span>v{{ version }}</span>
      <span>产物目录：默认（可在应用设置中修改）</span>
      <span class="app-spacer" />
      <span>北京时间</span>
      <span>就绪</span>
    </footer>

    <AppSettingsDrawer v-model="settingsOpen" :group="settingsGroup" />
  </div>
</template>
