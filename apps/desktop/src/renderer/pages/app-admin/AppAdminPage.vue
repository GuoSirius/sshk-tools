<script setup lang="ts">
/**
 * 应用管理壳页（P4-2 · 新想法#4，总计划 §五.4 / §五.5 v1.3）：
 * - 页头：返回桌面（与 goHome 同款 router.push('/')）+ 标题 + 右侧折叠按钮；
 * - 左菜单复用 SidebarMenu（递归渲染，全局 .side-* 样式）；菜单树按 §五.5 v1.3 定稿
 *   硬编码在页面内（非 manifest 驱动；P4-4~6 迁即重构后再接各模块描述文件）；
 * - hash 路由 /app/:module/:page?：active 由 route.params 响应式推导，selectItem push /app/<module>/<page>，
 *   默认 /app/settings/general（未知模块/页面回退各模块默认页）；
 * - 右内容区：应用设置 4 页真页面（P4-3 页化，pages/app-admin/settings/ 原位重写，自管页头与加载）；
 *   文件/模型/分享三模块过渡直引工具壳组件（provideToolId / llm.onDelta 注入在壳内已处理，最少侵入），
 *   fileconfig / modelconfig 两个「工具设置」页走宿主 ToolSettingsPage（manifest configGroups 驱动）。
 */
import { computed, ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Expand, Fold } from '@element-plus/icons-vue'
import type { ToolMenu } from '@sshk/shared'
import SidebarMenu from '../../components/SidebarMenu.vue'
import ToolSettingsPage from '../../SettingsPage.vue'
import GeneralPage from './settings/GeneralPage.vue'
import SystemDataPage from './settings/SystemDataPage.vue'
import ToolsPermissionPage from './settings/ToolsPermissionPage.vue'
import AboutPage from './settings/AboutPage.vue'
// 三模块壳直引（过渡）：相对路径与 discovery.ts 同一跨包引用先例（apps → tools 方向合法）
import FileManagerPage from '../../../../../../tools/file-manager/src/renderer/FileManagerPage.vue'
import ModelConsolePage from '../../../../../../tools/model-console/src/renderer/ModelConsolePage.vue'
import ShareManagerPage from '../../../../../../tools/share-manager/src/renderer/ShareManagerPage.vue'

defineOptions({ name: 'AppAdminPage' })

const emit = defineEmits<{ 'create-tool': [] }>()

// ── 菜单树（总计划 §五.5 v1.3 定稿：下移基线 + 二/三轮规整；页面 id 即路由 page 段） ──
const APP_MENUS: ToolMenu[] = [
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
]

/** 各模块默认页（URL 只带模块段 / 页段非法时回退） */
const MODULE_DEFAULT_PAGE: Record<string, string> = { settings: 'general', files: 'files', models: 'providers', share: 'routes' }

// 页面 id → 所属模块（含三级页），selectItem 反查路由段用；父分组 id 不入表
const PAGE_MODULE: Record<string, string> = {}
for (const group of APP_MENUS) {
  const walk = (items: ToolMenu[]): void => {
    for (const item of items) {
      if (item.children?.length) { walk(item.children); continue }
      PAGE_MODULE[item.id] = group.id
    }
  }
  walk(group.children ?? [])
}

const route = useRoute()
const router = useRouter()
// route.params 变化经 computed 响应式同步 active（watch 显式化与 computed 等价，这里取纯推导）
const activeModule = computed(() => {
  const m = route.params.module as string | undefined
  return m !== undefined && m in MODULE_DEFAULT_PAGE ? m : 'settings'
})
const activePage = computed<string>(() => {
  const p = route.params.page as string | undefined
  if (p !== undefined && PAGE_MODULE[p] === activeModule.value) return p
  return MODULE_DEFAULT_PAGE[activeModule.value] ?? 'general'
})

/** 页面标题 + 说明（仅三模块过渡页用；应用设置 4 页 P4-3 起自管页头，不在此登记） */
const PAGE_META: Record<string, { title: string; description: string }> = {
  files: { title: '文件系统', description: '本地 / 远端 / 云存储浏览管理与上传下载传输队列' },
  contents: { title: '内容管理', description: '内容库管理与编辑（编辑器形态随「工具设置」切换）' },
  profiles: { title: '通道配置', description: '上传通道 Profile 管理，密钥经 safeStorage 加密' },
  fileconfig: { title: '工具设置 · 文件管理', description: '内容编辑器形态等工具偏好' },
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

// ── 左菜单状态：默认全部分组展开（▲ 结构一眼可见）；分组开合仅影响展示 ──
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
const openIds = ref(new Set(collectGroupIds(APP_MENUS)))
function toggleGroup(id: string): void { toggleIn(openIds, id) }
function selectItem(pageId: string): void {
  const moduleId = PAGE_MODULE[pageId]
  if (moduleId) void router.push(`/app/${moduleId}/${pageId}`)
}

const collapsed = ref(false)
function goBackDesktop(): void {
  void router.push('/')
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-bar">
      <button class="admin-back" type="button" @click="goBackDesktop">
        <el-icon :size="14"><ArrowLeft /></el-icon>
        <span>返回桌面</span>
      </button>
      <strong class="admin-title">应用管理</strong>
      <span class="app-spacer" />
      <button
        class="admin-collapse"
        type="button"
        :title="collapsed ? '展开菜单' : '收起菜单'"
        :aria-label="collapsed ? '展开菜单' : '收起菜单'"
        @click="collapsed = !collapsed"
      >
        <el-icon :size="16"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
      </button>
    </header>

    <div class="admin-body">
      <aside class="admin-side" :class="{ collapsed }">
        <SidebarMenu
          :items="APP_MENUS"
          :active="activePage"
          :open-ids="openIds"
          :toggle-group="toggleGroup"
          :select-item="selectItem"
        />
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
            <!-- 工具设置页：宿主 ToolSettingsPage（manifest configGroups 驱动；layout=single 与工具宿主一致） -->
            <ToolSettingsPage
              v-if="activePage === 'fileconfig'"
              :key="'fileconfig'"
              tool-id="file-manager"
              section="config"
              layout="single"
            />
            <FileManagerPage
              v-else-if="activeModule === 'files'"
              :key="'file-manager'"
              :menu="activePage"
              tool-id="file-manager"
            />
            <ToolSettingsPage
              v-else-if="activePage === 'modelconfig'"
              :key="'modelconfig'"
              tool-id="model-console"
              section="config"
              layout="single"
            />
            <ModelConsolePage
              v-else-if="activeModule === 'models'"
              :key="'model-console'"
              :menu="activePage"
              tool-id="model-console"
            />
            <ShareManagerPage
              v-else-if="activeModule === 'share'"
              :key="'share-manager'"
              :menu="activePage"
              tool-id="share-manager"
            />
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
.admin-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--sshk-border);
}
.admin-back,
.admin-collapse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--sshk-border);
  border-radius: 6px;
  background: transparent;
  color: var(--sshk-text);
  font-size: 12px;
  cursor: pointer;
  transition: color .16s ease, border-color .16s ease, background .16s ease;
}
.admin-back:hover {
  color: var(--sshk-accent);
  border-color: var(--sshk-accent);
  background: color-mix(in srgb, var(--sshk-accent) 10%, transparent);
}
.admin-collapse .el-icon { flex: none; }
.admin-title { font-size: 14px; font-weight: 600; }
.admin-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.admin-side {
  flex: none;
  width: 216px;
  padding: 10px 8px;
  border-right: 1px solid var(--sshk-border);
  overflow: hidden;
  overflow-y: auto;
  transition: width .18s ease, padding .18s ease, opacity .18s ease;
}
.admin-side.collapsed {
  width: 0;
  padding: 10px 0;
  opacity: 0;
  border-right-color: transparent;
}
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
