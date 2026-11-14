<script setup lang="ts">
import {
  computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch,
  type Component,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DEFAULT_THEME_MODE } from '@sshk/shared'
import type { ThemeMode, ToolMenu } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'
import { useTheme } from './composables/useTheme'
import { useUpdater } from './composables/useUpdater'
import { toolComponent } from './plugins'
import SidebarMenu from './components/SidebarMenu.vue'
import ToolIcon from './components/ToolIcon.vue'
import AppSettingsDrawer from './components/AppSettingsDrawer.vue'
import ToolSettingsPage from './SettingsPage.vue'
import logoUrl from '../../build/icon.svg'

const { mode, setMode } = useTheme()
const { visibleTools: catalogTools, byId } = useToolCatalog()
// 路由即状态（vue-router）：桌面=/，工具页=/tool/:toolId/:menu?
const route = useRoute()
const router = useRouter()
const activeToolId = computed(() => (route.params.toolId as string | undefined) ?? null)
const activeMenu = computed(() => {
  const menu = route.params.menu as string | undefined
  if (menu) return menu
  return sidebarMenus.value[0]?.id ?? ''
})
const sidebarCollapsed = ref(false)
/** 收起态 hover：侧栏本体平滑展开，不再弹独立浮层 */
const sidebarHover = ref(false)
const sideOpenIds = ref<Set<string>>(new Set())
const sidebarExpanded = computed(() => !sidebarCollapsed.value || sidebarHover.value)
const settingsOpen = ref(false)
const settingsGroup = ref('general')
const query = ref('')
const version = ref('0.1.0')
const { state: updater } = useUpdater()
let hoverTimer: number | undefined

// 可见性由主进程裁决：桌面首页与侧栏都只消费 catalog 结果
const currentTool = computed(() => byId.value.get(activeToolId.value ?? '') ?? null)
// 侧栏分类行自动循环滚动（内容超宽才启动；hover 暂停）
const sidebarMarqueeRef = ref<HTMLElement | null>(null)
const sidebarMarqueeRun = ref(false)
function measureMarquee(): void {
  void nextTick(() => {
    const el = sidebarMarqueeRef.value
    if (!el) { sidebarMarqueeRun.value = false; return }
    sidebarMarqueeRun.value = el.scrollWidth > el.clientWidth + 2
  })
}
watch([currentTool, sidebarCollapsed], () => measureMarquee(), { immediate: true })
onMounted(() => { void nextTick(measureMarquee) })

// 关闭前确认：主进程在窗口关闭时通知渲染层，用主题色 ElMessageBox 替代原生系统 dialog
function showCloseConfirm(): void {
  ElMessageBox.confirm('退出后将关闭所有工具页面与后台任务，确定退出应用吗？', '退出确认', {
    type: 'warning',
    confirmButtonText: '退出',
    cancelButtonText: '取消',
  }).then(() => { void window.api.app.confirmClose() }).catch(() => { /* 用户取消，保持窗口 */ })
}
onMounted(() => { window.api.app.onRequestClose(showCloseConfirm) })
const isConfigMenu = computed(() => activeMenu.value === 'config' || activeMenu.value.startsWith('config-'))
// 渲染插件按清单动态加载，单个工具组件失败只影响它自己
// 内置工具走构建期组件；运行时包走 Blob URL 动态 import（编译后 ESM 组件）
const runtimeComponents = reactive(new Map<string, Component>())
// 按 id 记录加载中 / 失败：失败不再自动重试，避免反复弹错刷屏（F5 可整体重试）
const runtimeLoading = reactive(new Set<string>())
const runtimeFailed = reactive(new Set<string>())
async function loadRuntimeComponent(id: string): Promise<void> {
  if (runtimeComponents.has(id) || runtimeLoading.has(id) || runtimeFailed.has(id)) return
  runtimeLoading.add(id)
  try {
    const code = await window.api.runtime.readRenderer(id)
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const mod = (await import(/* @vite-ignore */ url)) as { default?: Component }
    URL.revokeObjectURL(url)
    if (!mod.default) throw new Error('渲染层未默认导出组件')
    runtimeComponents.set(id, markRaw(mod.default))
  } catch (err) {
    runtimeFailed.add(id)
    ElMessage.error('运行时组件加载失败：' + (err as Error).message)
  } finally {
    runtimeLoading.delete(id)
  }
}
// 加载触发独立于 toolView：computed 只做纯渲染推导，副作用放 watch（进工具时拉起一次）
watch(() => {
  const tool = currentTool.value
  return tool?.runtime ? tool.id : null
}, (id) => {
  if (id) void loadRuntimeComponent(id)
}, { immediate: true })
const toolView = computed(() => {
  const tool = currentTool.value
  if (!tool) return null
  const builtin = toolComponent(tool.id)
  if (builtin) return builtin
  // 运行时包：声明了渲染层且带 package 契约
  if (tool.runtime) return runtimeComponents.get(tool.id) ?? null
  return null
})
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

function openTool(id: string): void {
  const tool = byId.value.get(id)
  if (!tool?.visible) return
  sideOpenIds.value = new Set(collectGroupIds(sidebarMenus.value))
  void router.push('/tool/' + id)
}
function goHome(): void {
  sidebarHover.value = false
  void router.push('/')
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

// 工具被禁用 / 权限撤销 / 分发剔除 / 插件加载失败后自动退回桌面
watch(catalogTools, (list) => {
  if (activeToolId.value && !list.some((tool) => tool.id === activeToolId.value)) goHome()
})

// 刷新恢复由 URL 天然承担（hash 路由），无需 sessionStorage 方案

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
  if (!activeToolId.value) return
  sideOpenIds.value = new Set([...sideOpenIds.value, ...(pathTo(sidebarMenus.value, id) ?? [])])
  void router.push('/tool/' + activeToolId.value + '/' + id)
}

watch(sidebarCollapsed, (collapsed) => { if (!collapsed) sidebarHover.value = false })
onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer) })

async function checkUpdate(): Promise<void> {
  if (updater.value.phase === 'checking' || updater.value.phase === 'downloading') return
  const result = await window.api.update.check().catch(() => ({}) as Record<string, unknown>)
  if (result.dev) {
    ElMessage.info('开发环境不检查更新')
  } else if (result.error) {
    ElMessage.error('检查更新失败：' + String(result.error))
  } else if (result.updateAvailable) {
    ElMessage.success(`发现新版本 ${String(result.version ?? '')}，已开始下载`)
  } else {
    ElMessage.success('当前已是最新版本')
  }
}

/** 下载完成后点击触发退出并安装（electron-updater 在下次启动时落地） */
async function installUpdate(): Promise<void> {
  await window.api.update.quitAndInstall().catch((err: unknown) => {
    ElMessage.error('安装失败：' + (err as Error).message)
  })
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
      <el-button
        v-if="updater.phase === 'downloaded'"
        size="small"
        type="success"
        @click="installUpdate"
      >立即更新 v{{ updater.version }}</el-button>
      <el-button
        v-else
        size="small"
        text
        :loading="updater.phase === 'checking' || updater.phase === 'downloading'"
        :title="updater.error ?? ''"
        @click="checkUpdate"
      >
        <template v-if="updater.phase === 'idle' || updater.phase === 'not-available'">检查更新</template>
        <template v-else-if="updater.phase === 'available'">发现新版本</template>
        <template v-else-if="updater.phase === 'downloading'">下载 {{ updater.percent }}%</template>
        <template v-else-if="updater.phase === 'checking'">检查中…</template>
        <template v-else-if="updater.phase === 'error'">更新出错</template>
        <template v-else-if="updater.phase === 'dev'">开发版</template>
      </el-button>
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

    <!-- 更新横幅：下载完成主动提示安装；检查失败给重试入口 -->
    <div
      v-if="updater.phase === 'downloaded'"
      class="update-banner update-banner--ok"
    >
      <span>新版本 v{{ updater.version }} 已下载完成，重启即可生效</span>
      <el-button size="small" type="primary" @click="installUpdate">立即重启安装</el-button>
    </div>
    <div
      v-else-if="updater.phase === 'error'"
      class="update-banner update-banner--err"
    >
      <span>更新检查失败：{{ updater.error }}</span>
      <el-button size="small" text @click="checkUpdate">重试</el-button>
    </div>

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
              <small
                ref="sidebarMarqueeRef"
                class="sidebar-marquee"
                :class="{ running: sidebarMarqueeRun }"
                :title="currentTool.categories.join(' / ')"
              >
                <span class="sidebar-marquee-track">{{ currentTool.categories.join(" / ") }}&nbsp;&nbsp;&nbsp;&nbsp;{{ currentTool.categories.join(" / ") }}</span>
              </small>
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
          <component :is="toolView" v-if="toolView" :menu="activeMenu" :tool-id="currentTool.id" />
          <template v-else>
            <div class="tool-page-head">
              <strong>{{ currentTool.name }}</strong>
              <span class="muted" style="margin-left: 12px">{{ currentTool.description }}</span>
            </div>
            <div class="tool-page-body">
              <div v-if="currentTool.runtime && runtimeLoading.has(currentTool.id)" class="empty-state">运行时组件加载中…</div>
              <div v-else-if="currentTool.runtime && runtimeFailed.has(currentTool.id)" class="empty-state">运行时组件加载失败（强制刷新可重试）</div>
              <div v-else class="empty-state">该工具没有可用的渲染插件</div>
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
