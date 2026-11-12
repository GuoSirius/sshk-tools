<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_THEME_MODE } from '@sshk/shared'
import type { ThemeMode } from '@sshk/shared'
import { TOOLS, TOOL_GROUPS } from './registry/tools'
import { useTheme } from './composables/useTheme'
import logoUrl from '../../build/icon.svg'

const { mode, setMode } = useTheme()
const activeToolId = ref<string | null>(null)
const sidebarCollapsed = ref(false)
const query = ref('')
const version = ref('0.1.0')

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

function openTool(id: string): void { activeToolId.value = id }
function goHome(): void { activeToolId.value = null }
function onThemeChange(next: ThemeMode): void { void setMode(next) }
function openDataDir(): void { void window.api.app.openDataDir() }

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
      <el-button size="small" text>检查更新</el-button>
    </header>

    <div class="app-body">
      <!-- 工具级：工具内页才有 -->
      <aside v-if="currentTool" class="tool-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <el-button size="small" text @click="sidebarCollapsed = !sidebarCollapsed">
          {{ sidebarCollapsed ? '展开' : '收起' }}
        </el-button>
        <template v-if="!sidebarCollapsed">
          <div v-for="group in TOOL_GROUPS" :key="group" style="margin-top: 14px">
            <div class="muted" style="font-size: 12px; padding: 0 8px 6px">{{ group }}</div>
            <el-menu :default-active="currentTool?.entryRoute">
              <el-menu-item :index="currentTool?.entryRoute">
                {{ currentTool?.name }} 首页
              </el-menu-item>
            </el-menu>
          </div>
          <div style="margin-top: 18px; padding: 0 8px">
            <el-button size="small" text>工具配置</el-button>
          </div>
        </template>
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
