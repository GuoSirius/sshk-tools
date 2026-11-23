<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { isDevFeaturesEnabled, SSHK_DEV } from '@sshk/shared'
import type { ToolCatalogPayload, ToolMenu, ToolRuntimeState } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'
import { useUpdateBanner } from './composables/useUpdateBanner'
import { useNewToolScan } from './composables/useNewToolScan'
import { useRuntimeComponent } from './composables/useRuntimeComponent'
import { TRANSFER_PANEL_KEY, useTransferPanel } from './composables/useTransferPanel'
import AppHeader from './components/AppHeader.vue'
import AboutDialog from './components/AboutDialog.vue'
import TransferPanel from './components/TransferPanel.vue'
import CreateToolWizard from './components/CreateToolWizard.vue'
import StatusBar from './components/StatusBar.vue'
import UpdateBanners from './components/UpdateBanners.vue'
import DesktopGrid from './components/DesktopGrid.vue'
import ToolShellLayout from './components/ToolShellLayout.vue'
import AppAdminPage from './pages/app-admin/AppAdminPage.vue'
import ToolSettingsPage from './SettingsPage.vue'
import VerifyGuidePage from './pages/verify-guide/VerifyGuidePage.vue'
import { promptSecret } from './components/secret-prompt'

const { visibleTools: catalogTools, byId, accept: acceptCatalog, refresh: refreshCatalog } = useToolCatalog()
// P4-7 传输面板全局化：面板挂本壳根层（跨桌面/应用管理/工具宿主三容器悬浮，任何页面可唤起）；
// 状态与任务数据的单一真相 = useTransferPanel 单例（App 级订阅 fs 传输事件，页面切换任务不丢）。
// 工具页禁反向 import apps（check-boundaries），经本壳 provide 的控制器 inject 消费（键 'sshk:transfer-panel'）
const transferPanel = useTransferPanel()
provide(TRANSFER_PANEL_KEY, transferPanel)
// 路由即状态（vue-router）：桌面=/，工具页=/tool/:toolId/:menu?，应用管理=/app/:module/:page?
const route = useRoute()
const router = useRouter()
const activeToolId = computed(() => (route.params.toolId as string | undefined) ?? null)
// 应用管理路由（P4-2）：/app/:module/:page? 独立于桌面与工具宿主的第三容器
const isAdminRoute = computed(() => route.path === '/app' || route.path.startsWith('/app/'))
// 台账 #181：应用管理入口二态——进入 /app 前记录最后一个非应用管理路由；应用管理内切菜单不覆盖回退点，
// 顶栏入口「返回」无论菜单切到哪都回到进入前的页面
const adminReturnPath = ref(isAdminRoute.value ? '/' : route.fullPath)
watch(() => route.fullPath, (path) => {
  if (isAdminRoute.value) return
  adminReturnPath.value = path
})
const activeMenu = computed(() => {
  const menu = route.params.menu as string | undefined
  if (menu) return menu
  return sidebarMenus.value[0]?.id ?? ''
})
const sidebarCollapsed = ref(false)

// 顶栏更新簇 + 三态更新横幅状态（P4-1 抽 composable，AppHeader 与横幅共用同一单例）
const { updater, bannerKind, dismissUpdateBanner, checkUpdate, installUpdate } = useUpdateBanner()

// 可见性由主进程裁决：桌面首页与侧栏都只消费 catalog 结果
const currentTool = computed(() => byId.value.get(activeToolId.value ?? '') ?? null)

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

function openTool(id: string): void {
  const tool = byId.value.get(id)
  if (!tool?.visible) return
  void router.push('/tool/' + id)
}
function goHome(): void {
  void router.push('/')
}
function openDataDir(): void { void window.api.app.openDataDir() }
/** P4-2：顶栏「应用管理」入口——跳应用管理页（hash 路由 /app/...）；
 *  2026-11-22 起不指定落点，由 AppAdminPage 按「第一个有效菜单页」规整（菜单序首组=文件管理）；
 *  台账 #181：已在应用管理内时入口变「返回」，点击回到进入前的页面（菜单切换不影响回退点） */
function openAppAdmin(): void {
  if (isAdminRoute.value) {
    void router.push(adminReturnPath.value || '/')
    return
  }
  void router.push('/app')
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

// 需求（2026-11-22 · 台账#165）：传输面板只在文件系统页存在——切到其它页面（应用管理内或外部）即关闭；
// 回到文件系统页且有活动队列 / 在页内检测到新队列（活动任务 0→N）时亮出收起摘要条；
// 用户 ✕ 关闭后不被反复顶起（仅路由再进入或新队列再现）。任务在主进程继续执行，页面切换不受影响；
// 内容编辑类弹框/最小化手柄本就随页面组件卸载销毁，无全局态。
const isFilesPage = computed(() =>
  route.params.module === 'files' && ((route.params.page as string | undefined) ?? 'files') === 'files')
watch([isFilesPage, transferPanel.runningCount], ([on, count], [prevOn, prevCount]) => {
  if (!on && transferPanel.visible.value) transferPanel.hide()
  if (on && count > 0 && !transferPanel.visible.value && (!prevOn || prevCount === 0)) transferPanel.reveal()
})

// 刷新恢复由 URL 天然承担（hash 路由），无需 sessionStorage 方案
</script>

<template>
  <div class="app-shell">
    <!-- 应用级顶栏：语义色胶囊组 + 更多下拉（三段）+ 应用管理入口（P4-1 抽 AppHeader） -->
    <AppHeader
      :verify-guide-visible="canShowVerifyGuide"
      :admin-mode="isAdminRoute"
      @go-home="goHome"
      @open-app-admin="openAppAdmin"
      @open-verify-guide="verifyGuideOpen = true"
      @more-command="onMoreCommand"
    />

    <!-- 更新/新工具横幅簇（P6-8 抽 UpdateBanners）：三态更新横幅 + dev 新工具发现 -->
    <UpdateBanners
      :kind="bannerKind"
      :updater="updater"
      :show-new-tools="isDev && newTools.length > 0"
      :new-tools="newTools"
      @dismiss-update="dismissUpdateBanner"
      @install-update="installUpdate"
      @retry-update="checkUpdate"
      @dismiss-new-tools="dismissNewTools"
    />

    <div class="app-body">
      <!-- 工具级侧栏（P6-8 抽 ToolShellLayout）：左侧功能菜单（含多级）；收起后 hover 就地平滑展开 -->
      <ToolShellLayout
        v-if="currentTool"
        :tool="currentTool"
        :menus="sidebarMenus"
        :active="activeMenu"
        v-model:collapsed="sidebarCollapsed"
      />

      <main class="tool-content">
        <!-- KeepAlive（台账 #182）：应用管理/桌面/工具页实例缓存——进入应用管理再「返回」，
             原页面状态保持（表格筛选/草稿、编辑中表单、弹框开合态）；key=组件+业务键保证跨工具/跨设置节各存各的；
             轮询页由 useTablePage onDeactivated 停、onActivated 恢复，缓存期不空转。
             ⚠️ KeepAlive 内禁止写 HTML 注释（Vue dev 编译器把注释算 child → expects exactly one child component） -->
        <KeepAlive>
          <AppAdminPage v-if="isAdminRoute" key="app-admin" @create-tool="createToolOpen = true" />
          <DesktopGrid v-else-if="!currentTool" key="desktop" :tools="catalogTools" @open="openTool" />
          <ToolSettingsPage
            v-else-if="isConfigMenu"
            :key="`config:${currentTool.id}:${activeMenu}`"
            :tool-id="currentTool.id"
            :section="activeMenu"
            :layout="currentTool.configLayout"
          />
          <component
            :is="toolView"
            v-else-if="toolView"
            :key="`tool:${currentTool.id}`"
            :menu="activeMenu"
            :tool-id="currentTool.id"
          />
          <div v-else style="display: contents">
            <!-- 兜底（无渲染插件/运行时加载态）：纯静态非缓存分支，display:contents 保持原布局 -->
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
          </div>
        </KeepAlive>
      </main>
    </div>

    <!-- 状态栏（P6-8 抽 StatusBar）：版本 + 实时时钟 + 就绪态 -->
    <StatusBar />

    <CreateToolWizard v-model="createToolOpen" @created="onToolCreated" />
    <!-- 更多下拉「关于应用」轻弹框（P4-1）：运行环境四行 + 完整信息指引 -->
    <AboutDialog v-model="aboutOpen" />
    <!-- 验证引导：settings 类直达入口由页内自行路由到 应用管理 > 应用设置（P4-3 页化后无抽屉） -->
    <VerifyGuidePage v-model="verifyGuideOpen" />
    <!-- P4-7 传输队列悬浮面板（全局化）：无遮罩可拖拽、收起态显摘要；任何页面经 useTransferPanel 唤起；
         不设任何传输设置入口（C-8 终审：参数只在 文件管理>工具设置「传输与分片」） -->
    <TransferPanel />
  </div>
</template>
