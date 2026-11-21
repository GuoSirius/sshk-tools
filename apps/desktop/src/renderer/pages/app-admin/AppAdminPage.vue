<script setup lang="ts">
/**
 * 应用管理壳页（P4-2 · 新想法#4，总计划 §五.4 / §五.5 v1.3）：
 * - 页头行块已删（2026-11-22 需求：返回桌面与顶栏「桌面」按钮重复、标题冗余）；折叠钮移至左菜单底部固定位；
 * - 左菜单复用 SidebarMenu（递归渲染，全局 .side-* 样式）；菜单树按 §五.5 v1.3 定稿
 *   硬编码在页面内（非 manifest 驱动）；2026-11-22 起一级序 = 文件/模型/分享/应用设置（沉底），
 *   分组默认全部折叠，激活页祖先链自动展开；
 * - hash 路由 /app/:module?/:page?：active 由 route.params 响应式推导，selectItem push /app/<module>/<page>，
 *   未指定或指定无效时按「第一个有效菜单页」落点并 router.replace 规整 URL；
 * - 右内容区：应用设置 4 页真页面（P4-3 页化，pages/app-admin/settings/ 原位重写，自管页头与加载）；
 *   文件管理三页（P4-4）/模型管理三页（P4-5）/分享管理五页（P4-6）直引页面组件
 *   （useToolId 注入职责上收本壳：AppAdminPage 显式 provideToolId，文件管理子树内页面经
 *   useToolId() inject）；fileconfig / modelconfig 两个「工具设置」页走宿主 ToolSettingsPage
 *   （P4-8c 起页内声明分组，键 app.modules.*，不再依赖工具 manifest——P4-8b 后清单已退役）；
 * - P4-8a 三基础模块渲染层已物理搬迁至本目录 files/models/share/ 子目录（原 tools 各包 renderer 目录）：
 *   壳组件 FileManagerPage/ModelConsolePage/ShareManagerPage 随 P4-8b 工具包退役删除，
 *   应用本体不再 import 工具代码（边界铁律 §五.1）。
 */
import { computed, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Expand, Fold } from '@element-plus/icons-vue'
import { provideToolId } from '@sshk/ui-kit'
import type { ToolMenu } from '@sshk/shared'
import SidebarMenu from '../../components/SidebarMenu.vue'
import ToolSettingsPage from '../../SettingsPage.vue'
import GeneralPage from './settings/GeneralPage.vue'
import SystemDataPage from './settings/SystemDataPage.vue'
import ToolsPermissionPage from './settings/ToolsPermissionPage.vue'
import AboutPage from './settings/AboutPage.vue'
// 三模块页直引（P4-8a 物理搬迁后为本目录相对导入；内部 composables/components/host 相对层级随迁不变）：
// P4-4 起文件管理分发到各页面组件；P4-5 起模型管理分发到各页面组件；P4-6 起分享管理直引五页组件。
import FileExplorerPage from './files/pages/FileExplorerPage.vue'
import ContentsPage from './files/pages/ContentsPage.vue'
import ProfilesPage from './files/pages/ProfilesPage.vue'
import ProvidersPage from './models/pages/ProvidersPage.vue'
import ChatPage from './models/pages/ChatPage.vue'
import UsagePage from './models/pages/UsagePage.vue'
import RoutesPage from './share/pages/RoutesPage.vue'
import LogsPage from './share/pages/LogsPage.vue'
import ServicePage from './share/pages/ServicePage.vue'
import MountsPage from './share/pages/MountsPage.vue'
import ProxiesPage from './share/pages/ProxiesPage.vue'
import { FILE_CONFIG_GROUPS, MODEL_CONFIG_GROUPS } from './module-config-groups'

defineOptions({ name: 'AppAdminPage' })

const emit = defineEmits<{ 'create-tool': [] }>()

// 工具 id 注入上收本壳（P4-4，#129 铁律）：文件管理三页（FileExplorer/Contents/Profiles）经
// useToolId() inject 读取（模块 id = file-manager，P4-8c 后仍为本模块命名空间）；壳内直引的
// 其余模块页不用 useToolId（模型配置键固定前缀 app.modules.modelManager、分享页无注入需求）。
provideToolId('file-manager')

// ── 菜单树（总计划 §五.5 v1.3 定稿：下移基线 + 二/三轮规整；页面 id 即路由 page 段） ──
// 需求（2026-11-22）：一级顺序调整为 文件管理 → 模型管理 → 分享管理 → 应用设置（应用设置沉底）
const APP_MENUS: ToolMenu[] = [
  {
    id: 'files',
    label: '文件管理',
    icon: 'M3 7V5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 7h18',
    children: [
      { id: 'files', label: '文件系统' },
      { id: 'contents', label: '内容管理' },
      { id: 'profiles', label: '通道配置' },
      { id: 'fileconfig', label: '工具设置' },
    ],
  },
  {
    id: 'models',
    label: '模型管理',
    icon: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    children: [
      { id: 'providers', label: '模型配置' },
      { id: 'chat', label: '对话调试' },
      { id: 'usage', label: '用量统计' },
      { id: 'modelconfig', label: '工具配置' },
    ],
  },
  {
    id: 'share',
    label: '分享管理',
    icon: 'M18 5a3 3 0 100 6 3 3 0 100-6zM6 10a3 3 0 100 6 3 3 0 100-6zM18 15a3 3 0 100 6 3 3 0 100-6zM8.6 13.7l6.8 3.9M15.4 6.5L8.6 10.3',
    children: [
      { id: 'routes', label: '路由管理' },
      { id: 'logs', label: '访问日志' },
      {
        id: 'shareconfig',
        label: '工具设置',
        children: [
          { id: 'service', label: '服务配置' },
          { id: 'mounts', label: '挂载管理' },
          { id: 'proxies', label: '代理管理' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    label: '应用设置',
    children: [
      { id: 'general', label: '常规设置' },
      { id: 'system', label: '系统与数据' },
      { id: 'tools', label: '工具与权限' },
      { id: 'about', label: '关于应用' },
    ],
  },
]

/** 各模块默认页（URL 只带模块段 / 页段非法时回退） */
const MODULE_DEFAULT_PAGE: Record<string, string> = { settings: 'general', files: 'files', models: 'providers', share: 'routes' }

// 页面 id → 所属模块（含三级页）+ 祖先分组链（激活页自动展开用）；父分组 id 不入 PAGE_MODULE
const PAGE_MODULE: Record<string, string> = {}
const PAGE_CHAIN: Record<string, string[]> = {}
for (const group of APP_MENUS) {
  const walk = (items: ToolMenu[], chain: string[]): void => {
    for (const item of items) {
      if (item.children?.length) { walk(item.children, [...chain, item.id]); continue }
      PAGE_MODULE[item.id] = group.id
      PAGE_CHAIN[item.id] = chain
    }
  }
  walk(group.children ?? [], [group.id])
}

const route = useRoute()
const router = useRouter()
// route.params 变化经 computed 响应式同步 active（watch 显式化与 computed 等价，这里取纯推导）
// 需求（2026-11-22）：未指定或指定无效时打开第一个有效菜单页（菜单序首组的首个有效页）
const firstModuleId = APP_MENUS[0]?.id ?? 'settings'
const activeModule = computed(() => {
  const m = route.params.module as string | undefined
  return m !== undefined && m in MODULE_DEFAULT_PAGE ? m : firstModuleId
})
const activePage = computed<string>(() => {
  const p = route.params.page as string | undefined
  if (p !== undefined && PAGE_MODULE[p] === activeModule.value) return p
  return MODULE_DEFAULT_PAGE[activeModule.value] ?? 'general'
})

// 落点规整（2026-11-22 需求）：/app 裸路径或指定无效（模块/页面段非法）时，按「第一个有效菜单页」
// 解析并把 URL 规整为 /app/<module>/<page>（replace 不留历史）；指定有效时 URL 原样保留
const canonicalPath = computed(() => `/app/${activeModule.value}/${activePage.value}`)
watch(canonicalPath, (target) => {
  if (route.fullPath !== target) void router.replace(target)
}, { immediate: true })

/** 页面标题 + 说明（仅三模块过渡页用；应用设置 4 页 P4-3 起自管页头，不在此登记） */
const PAGE_META: Record<string, { title: string; description: string }> = {
  files: { title: '文件系统', description: '本地 / 远端 / 云存储浏览管理与上传下载传输队列' },
  contents: { title: '内容管理', description: '内容库管理与编辑（编辑器形态随「工具设置」切换）' },
  profiles: { title: '通道配置', description: '上传通道 Profile 管理，密钥经 safeStorage 加密' },
  fileconfig: { title: '工具设置 · 文件管理', description: '内容编辑器形态、传输与分片参数等工具偏好' },
  providers: { title: '模型配置', description: 'Provider 增删改、内置预设与连接测试' },
  chat: { title: '对话调试', description: '按 Provider 试聊，验证网关与流式输出' },
  usage: { title: '用量统计', description: '对话调用量与 Token 用量' },
  modelconfig: { title: '工具配置 · 模型管理', description: '默认 Provider / 请求超时 / 流式输出等网关偏好' },
  routes: { title: '路由管理', description: '全量分享路由查看与管理' },
  logs: { title: '访问日志', description: '分享访问日志查询、导出与清理' },
  service: { title: '服务配置', description: '分享服务状态、启停与基础设置' },
  mounts: { title: '挂载管理', description: '分享挂载目录管理' },
  proxies: { title: '代理管理', description: '分享代理规则管理' },
}
const activeMeta = computed(() => PAGE_META[activePage.value] ?? { title: '应用管理', description: '' })

// ── 左菜单状态：默认全部分组折叠（2026-11-22 需求）；激活页变化时自动展开其祖先分组链，
//    让「指定的菜单及页面」可见，其余分组不受影响；分组开合仅影响展示 ──
function toggleIn(target: Ref<Set<string>>, id: string): void {
  const next = new Set(target.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  target.value = next
}
const openIds = ref(new Set<string>())
function toggleGroup(id: string): void { toggleIn(openIds, id) }
watch(activePage, (page) => {
  const chain = PAGE_CHAIN[page]
  if (!chain?.length || chain.every((id) => openIds.value.has(id))) return
  const next = new Set(openIds.value)
  for (const id of chain) next.add(id)
  openIds.value = next
}, { immediate: true })
function selectItem(pageId: string): void {
  const moduleId = PAGE_MODULE[pageId]
  if (moduleId) void router.push(`/app/${moduleId}/${pageId}`)
}

const collapsed = ref(false)
</script>

<template>
  <div class="admin-page">
    <div class="admin-body">
      <aside class="admin-side" :class="{ collapsed }">
        <div class="admin-side-menu">
          <SidebarMenu
            :items="APP_MENUS"
            :active="activePage"
            :open-ids="openIds"
            :toggle-group="toggleGroup"
            :select-item="selectItem"
          />
        </div>
        <!-- 需求（2026-11-22）：展开/收起固定在左菜单底部（随侧栏收窄为图标轨，仍可再展开） -->
        <div class="admin-side-foot">
          <button
            class="admin-side-toggle"
            type="button"
            :title="collapsed ? '展开菜单' : '收起菜单'"
            :aria-label="collapsed ? '展开菜单' : '收起菜单'"
            @click="collapsed = !collapsed"
          >
            <el-icon :size="16"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
            <span v-if="!collapsed" class="admin-side-toggle-text">收起菜单</span>
          </button>
        </div>
      </aside>

      <section class="admin-content">
        <!-- 应用设置 4 页：P4-3 页化真页面（各页自管页头/加载/确认流） -->
        <template v-if="activeModule === 'settings'">
          <GeneralPage v-if="activePage === 'general'" />
          <SystemDataPage v-else-if="activePage === 'system'" />
          <ToolsPermissionPage v-else-if="activePage === 'tools'" @create-tool="emit('create-tool')" />
          <AboutPage v-else />
        </template>

        <!-- 三模块过渡直引：壳组件已处理 provideToolId / 流式订阅注入，页面 id 即壳的 menu id -->
        <template v-else>
          <div class="tool-page-head">
            <strong>{{ activeMeta.title }}</strong>
            <span class="muted" style="margin-left: 12px">{{ activeMeta.description }}</span>
          </div>
          <div class="admin-module-body">
            <!-- 工具设置页（P4-8c 页内声明分组，C-3 键 app.modules.*；manifest 已随 P4-8b 退役）：
                 fileconfig=「内容编辑器」+「传输与分片」，modelconfig=「网关偏好」（三轮复核独立页） -->
            <ToolSettingsPage
              v-if="activePage === 'fileconfig'"
              :key="'fileconfig'"
              tool-id="file-manager"
              :groups="FILE_CONFIG_GROUPS"
              key-base="app.modules.fileManager"
            />
            <!-- 文件管理三页直引（P4-4 迁即重构；provideToolId 已在本壳显式注入） -->
            <FileExplorerPage v-else-if="activePage === 'files'" :key="'files'" />
            <ContentsPage v-else-if="activePage === 'contents'" :key="'contents'" />
            <ProfilesPage v-else-if="activePage === 'profiles'" :key="'profiles'" />
            <!-- 模型管理三页直引（P4-5 迁即重构；页头由本壳 tool-page-head 提供，页面自管留白） -->
            <ProvidersPage v-else-if="activePage === 'providers'" />
            <ChatPage v-else-if="activePage === 'chat'" />
            <UsagePage v-else-if="activePage === 'usage'" />
            <ToolSettingsPage
              v-else-if="activePage === 'modelconfig'"
              :key="'modelconfig'"
              tool-id="model-manager"
              :groups="MODEL_CONFIG_GROUPS"
              key-base="app.modules.modelManager"
            />
            <!-- 分享管理五页直引（P4-6 迁即重构；service 即收编 ShareTab 后的唯一分享服务页） -->
            <RoutesPage v-else-if="activePage === 'routes'" />
            <LogsPage v-else-if="activePage === 'logs'" />
            <ServicePage v-else-if="activePage === 'service'" />
            <MountsPage v-else-if="activePage === 'mounts'" />
            <ProxiesPage v-else-if="activePage === 'proxies'" />
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.admin-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* 左菜单：纵向 flex——菜单区滚动、底部固定展开/收起钮（2026-11-22 需求，原在页头行块内） */
.admin-side {
  flex: none;
  width: 216px;
  padding: 10px 8px;
  border-right: 1px solid var(--sshk-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width .18s ease, padding .18s ease;
}
.admin-side-menu {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  overflow-y: auto;
  transition: opacity .18s ease;
}
.admin-side-foot {
  flex: none;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--sshk-border);
  display: flex;
}
.admin-side-toggle {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--sshk-border);
  border-radius: 6px;
  background: transparent;
  color: var(--sshk-text);
  font-size: 12px;
  cursor: pointer;
  transition: color .16s ease, border-color .16s ease, background .16s ease;
}
.admin-side-toggle:hover {
  color: var(--sshk-accent);
  border-color: var(--sshk-accent);
  background: color-mix(in srgb, var(--sshk-accent) 10%, transparent);
}
.admin-side-toggle .el-icon { flex: none; }
.admin-side-toggle-text { white-space: nowrap; }
/* 收起：不缩没（宽 0 会连折叠钮一起消失）——保留窄轨放底部展开钮，菜单区隐藏 */
.admin-side.collapsed {
  width: 44px;
  padding: 10px 4px;
}
.admin-side.collapsed .admin-side-menu {
  opacity: 0;
  pointer-events: none;
}
.admin-side.collapsed .admin-side-toggle-text { display: none; }
.admin-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 模块页容器：不外加留白——各页自管内边距（ToolPageLayout/.lp-page 已按 var(--sshk-page-padding)），与工具宿主同口径 */
.admin-module-body {
  flex: 1;
  min-height: 0;
}
</style>
