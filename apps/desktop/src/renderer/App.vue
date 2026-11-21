<script setup lang="ts">
import {
  computed, nextTick, onBeforeUnmount, onMounted, ref, watch,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DArrowLeft } from '@element-plus/icons-vue'
import { isDevFeaturesEnabled, SSHK_DEV } from '@sshk/shared'
import type { ToolCatalogPayload, ToolMenu, ToolRuntimeState } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'
import { useUpdateBanner } from './composables/useUpdateBanner'
import { useNewToolScan } from './composables/useNewToolScan'
import { useRuntimeComponent } from './composables/useRuntimeComponent'
import SidebarMenu from './components/SidebarMenu.vue'
import ToolIcon from './components/ToolIcon.vue'
import AppHeader from './components/AppHeader.vue'
import AboutDialog from './components/AboutDialog.vue'
import AppAdminPage from './pages/app-admin/AppAdminPage.vue'
import ToolSettingsPage from './SettingsPage.vue'
import CreateToolWizard from './components/CreateToolWizard.vue'
import VerifyGuidePage from './pages/verify-guide/VerifyGuidePage.vue'
import { promptSecret } from './components/secret-prompt'

const { visibleTools: catalogTools, byId, accept: acceptCatalog, refresh: refreshCatalog } = useToolCatalog()
// 路由即状态（vue-router）：桌面=/，工具页=/tool/:toolId/:menu?，应用管理=/app/:module/:page?
const route = useRoute()
const router = useRouter()
const activeToolId = computed(() => (route.params.toolId as string | undefined) ?? null)
// 应用管理路由（P4-2）：/app/:module/:page? 独立于桌面与工具宿主的第三容器
const isAdminRoute = computed(() => route.path === '/app' || route.path.startsWith('/app/'))
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
const query = ref('')
const version = ref('0.1.0')
/** 状态栏实时时钟（用户 2026-11-17：年月日 时分秒+星期） */
const clockText = ref('')
let clockTimer: number | undefined
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
function tickClock(): void {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  clockText.value = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 星期${WEEK_CN[d.getDay()]}`
}
// 顶栏更新簇 + 三态更新横幅状态（P4-1 抽 composable，AppHeader 与横幅共用同一单例）
const { updater, bannerKind, dismissUpdateBanner, checkUpdate, installUpdate } = useUpdateBanner()
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
onMounted(() => { tickClock(); clockTimer = window.setInterval(tickClock, 1000) })
onBeforeUnmount(() => { if (clockTimer !== undefined) window.clearInterval(clockTimer) })

// 关闭前确认：主进程在窗口关闭时通知渲染层，用主题色 ElMessageBox 替代原生系统 dialog
function showCloseConfirm(): void {
  ElMessageBox.confirm('退出后将关闭所有工具页面与后台任务，确定退出应用吗？', '退出确认', {
    type: 'warning',
    confirmButtonText: '退出',
    cancelButtonText: '取消',
    closeOnClickModal: false,
    closeOnPressEscape: false,
  }).then(() => { void window.api.app.confirmClose() }).catch(() => { /* 用户取消，保持窗口 */ })
}
onMounted(() => { window.api.app.onRequestClose(showCloseConfirm) })
const isConfigMenu = computed(() => activeMenu.value === 'config' || activeMenu.value.startsWith('config-'))
// 运行时组件加载抽 composable（CR-42 首刀 · P4-1）：内置工具走构建期组件；运行时包走 Blob URL 动态 import
const { runtimeLoading, runtimeFailed, toolView } = useRuntimeComponent(currentTool)
const visibleTools = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return catalogTools.value
  return catalogTools.value.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.categories.join(' ')}`.toLowerCase().includes(keyword))
})

/**
 * 形态 2（configLayout=menu）：把配置页挂成「工具配置」的二级菜单，
 * 每个二级菜单 id = configPages[].id（真实页面，页内可多分组）；
 * 未声明 configPages 时回退到逐分组（兼容旧清单）。
 * 形态 1（single）：不生成二级菜单，单个「工具配置」进去左右布局。
 */
const configSubMenus = (tool: ToolRuntimeState): ToolMenu[] =>
  tool.configPages.length
    ? tool.configPages.map((page) => ({ id: page.id, label: page.label, icon: page.icon }))
    : tool.configGroups.map((group) => ({ id: group.id, label: group.label, icon: group.icon }))

const sidebarMenus = computed(() => {
  const tool = currentTool.value
  if (!tool) return []
  if (tool.configLayout !== 'menu') return tool.menus
  return tool.menus.map((menu) => menu.id === 'config'
    ? { ...menu, children: configSubMenus(tool) }
    : menu)
})

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

/** 工具名超长时悬浮跑马灯：进入卡片量出溢出量写进 CSS 变量驱动往返滚动，未溢出不动；离开卡片动画平滑回位（2026-11-17 用户反馈） */
function nameScrollStart(e: MouseEvent): void {
  const box = e.currentTarget as HTMLElement
  const text = box.querySelector<HTMLElement>('.card-name-text')
  if (!text) return
  // 截断态下 rect.width 已是裁切后宽度，须用 scrollWidth 量内容真实宽度
  const overflow = Math.ceil(text.scrollWidth - box.clientWidth)
  if (overflow <= 2) return
  text.style.setProperty('--name-shift', `${-overflow - 8}px`)
  text.classList.add('is-scrolling')
}
function nameScrollStop(e: MouseEvent): void {
  const text = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.card-name-text')
  if (text) text.classList.remove('is-scrolling')
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
function openDataDir(): void { void window.api.app.openDataDir() }
/** P4-2：顶栏「应用管理」入口——跳应用管理页（hash 路由 /app/...，默认 应用设置 > 常规设置） */
function openAppAdmin(): void {
  void router.push('/app/settings/general')
}
/** dev 随意开关；打包版先试无密钥（会抛错），再弹密钥输入（默认 sshk-tools@888） */
async function openDevTools(): Promise<void> {
  try {
    await window.api.app.toggleDevTools()
    return
  } catch { /* 打包版需要密钥 */ }
  try {
    const secret = await promptSecret('开发者工具', '打开开发者工具需要访问密钥', '验证并开启')
    if (secret === null) return // 用户取消：不发起校验、不报错（2026-11-18）
    await window.api.app.toggleDevTools(secret)
  } catch (err) {
    const message = (err as Error).message
    if (message && message !== 'cancel') ElMessage.error(message)
  }
}
function onMoreCommand(command: string): void {
  // 数据目录 / 工具与权限 / 系统与数据 / 常规设置 已从「更多」下拉移除（迁往应用管理对应页，P4-2），
  // 旧 openSettings 分支随设置抽屉一并删除（P4-3）；about 开轻弹框（P4-1）
  if (command === 'dataDir') openDataDir()
  else if (command === 'reload') void window.api.app.reload()
  else if (command === 'reloadForce') void window.api.app.reload(true)
  else if (command === 'devtools') void openDevTools()
  else if (command === 'about') aboutOpen.value = true
  else if (command === 'createTool') createToolOpen.value = true
}

/** N16 创建工具向导（仅 dev 显示入口）：创建成功后刷新目录让新工具立即可见 */
const isDev = SSHK_DEV
const createToolOpen = ref(false)
const aboutOpen = ref(false)

/** U2 验证引导（dev 恒显示；打包版 developerMode 开启后显示）——口径统一 isDevFeaturesEnabled（D-2 · P0-2） */
const verifyGuideOpen = ref(false)
const developerModeOn = ref(false)
async function refreshDeveloperMode(): Promise<void> {
  developerModeOn.value = Boolean(await window.api.config.get('app.developerMode'))
}
void refreshDeveloperMode()
// CR-46（P0-2）：developerMode 变更实时反映——订阅 config.onChanged（preload 返回退订函数）
const offDeveloperModeChanged = window.api.config.onChanged((payload) => {
  if (payload.namespace === 'app' && payload.key === 'developerMode') void refreshDeveloperMode()
})
onBeforeUnmount(() => offDeveloperModeChanged())
const canShowVerifyGuide = computed(() => isDevFeaturesEnabled(isDev, developerModeOn.value))
function onToolCreated(catalog: unknown): void {
  if (catalog) acceptCatalog(catalog as ToolCatalogPayload)
  else void refreshCatalog()
}

// U1-1 L1 提示层（仅 dev）抽 composable（P4-1）：focus / 30s 轻扫描发现新工具出横幅，见 useNewToolScan
const { newTools, dismissNewTools } = useNewToolScan()

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

onMounted(async () => {
  version.value = await window.api.app.version().catch(() => '0.1.0')
})
</script>

<template>
  <div class="app-shell">
    <!-- 应用级顶栏：语义色胶囊组 + 更多下拉（三段）+ 应用管理入口（P4-1 抽 AppHeader） -->
    <AppHeader
      :verify-guide-visible="canShowVerifyGuide"
      @go-home="goHome"
      @open-app-admin="openAppAdmin"
      @open-verify-guide="verifyGuideOpen = true"
      @more-command="onMoreCommand"
    />

    <!-- 更新横幅：下载中显示进度条 / 完成提示安装 / 失败重试；均可关闭（项10：允许用户忽略，稍后自行重启） -->
    <div v-if="bannerKind === 'downloading'" class="update-banner update-banner--progress">
      <span class="update-banner-progress">
        正在下载新版本 v{{ updater.version }} · {{ updater.percent ?? 0 }}%
        <el-progress :percentage="updater.percent ?? 0" :stroke-width="6" :show-text="false" style="width: 180px; display: inline-block; vertical-align: middle; margin-left: 8px" />
      </span>
      <el-button size="small" text type="info" title="关闭提示（下载仍在后台继续）" @click="dismissUpdateBanner">关闭</el-button>
    </div>
    <div
      v-else-if="bannerKind === 'downloaded'"
      class="update-banner update-banner--ok"
    >
      <span>新版本 v{{ updater.version }} 已下载完成，重启即可生效</span>
      <span class="update-banner-actions">
        <el-button size="small" type="primary" @click="installUpdate">立即重启安装</el-button>
        <el-button size="small" text type="info" title="关闭提示（稍后可点顶栏按钮安装）" @click="dismissUpdateBanner">关闭</el-button>
      </span>
    </div>
    <div
      v-else-if="bannerKind === 'error'"
      class="update-banner update-banner--err"
    >
      <span>更新出错：{{ updater.error }}</span>
      <span class="update-banner-actions">
        <el-button size="small" text @click="checkUpdate">重试</el-button>
        <el-button size="small" text type="info" title="关闭提示" @click="dismissUpdateBanner">关闭</el-button>
      </span>
    </div>

    <div
      v-else-if="isDev && newTools.length > 0"
      class="update-banner update-banner--ok"
    >
      <span>检测到新工具：{{ newTools.map((t) => t.name).join('、') }} —— 重启 pnpm dev 后即可加载（渲染层组件需构建期发现）</span>
      <el-button size="small" text @click="dismissNewTools">知道了</el-button>
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
            <el-icon class="sidebar-toggle-icon" :size="16"><DArrowLeft /></el-icon>
            <!-- 文案随状态切换：展开态提示收起；收起态提示展开；hover 临时展开时提示固定 -->
            <span class="toggle-text">
              {{ sidebarCollapsed ? (sidebarHover ? '固定展开' : '展开菜单') : '收起菜单' }}
            </span>
          </button>
        </div>
      </aside>

      <main class="tool-content">
        <!-- 应用管理（P4-2）：左菜单 + 右内容区，create-tool 事件回抛壳层向导 -->
        <template v-if="isAdminRoute">
          <AppAdminPage @create-tool="createToolOpen = true" />
        </template>
        <template v-else-if="!currentTool">
          <div class="tool-page-head">
            <el-input v-model="query" placeholder="搜索工具" clearable style="max-width: 280px" />
            <span class="muted" style="margin-left: 12px">共 {{ visibleTools.length }} 个工具 · 可见性由应用设置统一管理</span>
          </div>
          <div class="desktop">
            <div class="desktop-grid">
              <article v-for="tool in visibleTools" :key="tool.id" class="tool-card" @click="openTool(tool.id)" @mouseenter="nameScrollStart" @mouseleave="nameScrollStop">
                <ToolIcon :icon="tool.icon" :tool-id="tool.id" :name="tool.name" :size="44" />
                <h3 class="card-name"><span class="card-name-text">{{ tool.name }}</span></h3>
                <p class="muted card-desc">{{ tool.description }}</p>
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
      <span class="app-spacer" />
      <span>{{ clockText }}</span>
      <span>就绪</span>
    </footer>

    <CreateToolWizard v-model="createToolOpen" @created="onToolCreated" />
    <!-- 更多下拉「关于应用」轻弹框（P4-1）：运行环境四行 + 完整信息指引 -->
    <AboutDialog v-model="aboutOpen" />
    <!-- 验证引导：settings 类直达入口由页内自行路由到 应用管理 > 应用设置（P4-3 页化后无抽屉） -->
    <VerifyGuidePage v-model="verifyGuideOpen" />
  </div>
</template>
