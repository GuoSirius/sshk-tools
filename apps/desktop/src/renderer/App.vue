<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_THEME_MODE } from '@sshk/shared'
import type { ThemeMode } from '@sshk/shared'
import { TOOLS } from './registry/tools'
import { useTheme } from './composables/useTheme'
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
const query = ref('')
const version = ref('0.1.0')
const updateChecking = ref(false)

const currentTool = computed(() => TOOLS.find((tool) => tool.id === activeToolId.value) ?? null)
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

function openTool(id: string): void {
  activeToolId.value = id
  activeMenu.value = TOOLS.find((tool) => tool.id === id)?.menus[0]?.id ?? ''
}
function goHome(): void { activeToolId.value = null }
function onThemeChange(next: ThemeMode): void { void setMode(next) }
function openDataDir(): void { void window.api.app.openDataDir() }

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
      <!-- 工具级：工具内页才有；左侧 = 当前工具的全部功能菜单（需求 8） -->
      <aside v-if="currentTool" class="tool-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-menu">
          <template v-if="!sidebarCollapsed">
            <div class="sidebar-tool-name">{{ currentTool.name }}</div>
            <el-menu :default-active="activeMenu" @select="(id: string) => (activeMenu = id)">
              <el-menu-item v-for="m in currentTool.menus" :key="m.id" :index="m.id">
                {{ m.label }}
              </el-menu-item>
            </el-menu>
          </template>
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
            <span v-if="!sidebarCollapsed" class="toggle-text">收起菜单</span>
          </button>
        </div>
      </aside>

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

        <!-- 工具内页：顶部操作 / 中间唯一滚动 / 底部分页（与需求 8 同构） -->
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
