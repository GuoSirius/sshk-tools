<script setup lang="ts">
/**
 * 应用顶栏（P4-1 · 新想法#3，CR-42 首刀从 App.vue 抽出）：
 * 右上角语义色胶囊按钮组（总计划 §五.3 方案一，C-7 终审）——
 * 高度 28px、圆角 6px、图标 14px + 12px 文字；底色语义色 light-9、前景/边框语义色、hover 加深一档（light-8）。
 * 色彩语义沿用总纲 §2.5：主题=紫、检查更新=success、验证引导=warning、更多操作=info、应用管理=primary 实底（全组视觉锚点）。
 * 图标按 D50：Brush / Refresh / CircleCheck / MoreFilled / Setting。
 * 原「更多」下拉的 数据目录/工具与权限/系统与数据 已迁往应用管理对应页（P4-2）；「设置」按钮删除（被应用管理替代）。
 */
import { computed } from 'vue'
import { Brush, CircleCheck, MoreFilled, Refresh, Setting } from '@element-plus/icons-vue'
import { DEFAULT_THEME_MODE, SSHK_DEV } from '@sshk/shared'
import type { ThemeMode } from '@sshk/shared'
import { useTheme } from '../composables/useTheme'
import { useUpdateBanner } from '../composables/useUpdateBanner'
import logoUrl from '../../../build/icon.svg'

defineOptions({ name: 'AppHeader' })

const props = defineProps<{ verifyGuideVisible?: boolean }>()
const emit = defineEmits<{
  'go-home': []
  'open-app-admin': []
  'open-verify-guide': []
  'more-command': [command: string]
}>()

const { mode, setMode } = useTheme()
const { updater, checkUpdate, installUpdate } = useUpdateBanner()

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: '暗黑', value: 'dark' },
  { label: '亮色', value: 'light' },
  { label: '跟随系统', value: 'system' },
]
function onThemeChange(next: ThemeMode): void { void setMode(next) }

/**
 * 更新簇四态（逻辑原样迁移）：已下载=实底胶囊立即安装 / 发现新版=warning 胶囊状态指示（点它会重新检查，
 * 导致「检查中→发现新版本」来回跳，故不可点）/ 下载中=success 胶囊内进度遮罩 / 其余=success 胶囊检查入口。
 */
const updateCapClass = computed(() => {
  if (updater.value.phase === 'downloaded') return 'cap-success-solid'
  if (updater.value.phase === 'available') return 'cap-warning'
  return 'cap-success'
})
const updateCapTitle = computed(() => {
  if (updater.value.phase === 'available') return '已发现新版本，正在后台下载，请稍候'
  return updater.value.error ?? ''
})
const updateCapChecking = computed(() => updater.value.phase === 'checking')
function onUpdateClick(): void {
  if (updater.value.phase === 'downloaded') void installUpdate()
  else if (updater.value.phase !== 'available') void checkUpdate()
}
</script>

<template>
  <header class="app-bar">
    <img class="app-logo" :src="logoUrl" alt="sshk-tools" />
    <span class="app-title">sshk-tools</span>
    <el-button size="small" text @click="emit('go-home')">桌面</el-button>
    <span class="app-spacer" />

    <!-- 主题：紫色胶囊壳包 el-select（D50 图标 Brush） -->
    <div class="cap cap-theme" title="界面主题">
      <el-icon :size="14"><Brush /></el-icon>
      <el-select
        class="cap-theme-select"
        :model-value="mode || DEFAULT_THEME_MODE"
        size="small"
        @change="onThemeChange"
      >
        <el-option v-for="opt in themeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
    </div>

    <!-- 检查更新：success 胶囊（SSHK_APP_AUTO_UPDATE=0 时 phase=disabled，整体不渲染任何更新入口） -->
    <div
      v-if="updater.phase !== 'disabled'"
      class="cap cap-update"
      :class="[updateCapClass, { 'is-checking': updateCapChecking }]"
      role="button"
      tabindex="0"
      :title="updateCapTitle"
      @click="onUpdateClick"
    >
      <span
        v-if="updater.phase === 'downloading'"
        class="cap-progress-mask"
        :style="{ '--p': (updater.percent ?? 0) + '%' }"
      />
      <el-icon :size="14"><Refresh /></el-icon>
      <span class="cap-text">
        <template v-if="updater.phase === 'downloaded'">立即更新 v{{ updater.version }}</template>
        <template v-else-if="updater.phase === 'available'">发现新版本{{ updater.percent !== undefined ? ` ${updater.percent}%` : '' }}</template>
        <template v-else-if="updater.phase === 'downloading'">下载 {{ updater.percent ?? 0 }}%</template>
        <template v-else-if="updater.phase === 'checking'">检查中…</template>
        <template v-else-if="updater.phase === 'error'">更新出错</template>
        <template v-else-if="updater.phase === 'dev'">开发版</template>
        <template v-else>检查更新</template>
      </span>
    </div>

    <!-- 验证引导：常用入口直接放顶栏（dev 恒显示；打包版 developerMode 开启后显示，可见性由宿主裁决） -->
    <div
      v-if="verifyGuideVisible"
      class="cap cap-warning"
      role="button"
      tabindex="0"
      @click="emit('open-verify-guide')"
    >
      <el-icon :size="14"><CircleCheck /></el-icon>
      <span class="cap-text">验证引导</span>
    </div>

    <!-- 更多操作：info 胶囊 dropdown（三段：刷新组 / 创建工具(dev) / 关于应用） -->
    <el-dropdown trigger="click" @command="(command: string) => emit('more-command', command)">
      <div class="cap cap-info" role="button" tabindex="0">
        <el-icon :size="14"><MoreFilled /></el-icon>
        <span class="cap-text">更多操作</span>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="reload">刷新页面（F5 / Ctrl+R）</el-dropdown-item>
          <el-dropdown-item command="reloadForce">强制刷新（Ctrl+F5 / Ctrl+Shift+R）</el-dropdown-item>
          <el-dropdown-item command="devtools">开发者工具</el-dropdown-item>
          <el-dropdown-item v-if="SSHK_DEV" command="createTool" divided>创建工具（开发者）</el-dropdown-item>
          <el-dropdown-item command="about" divided>关于应用</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- 应用管理：primary 实底胶囊，全组视觉锚点（替代原「设置」按钮） -->
    <div class="cap cap-primary" role="button" tabindex="0" title="应用管理" @click="emit('open-app-admin')">
      <el-icon :size="14"><Setting /></el-icon>
      <span class="cap-text">应用管理</span>
    </div>
  </header>
</template>

<style scoped>
/* ── 语义色胶囊按钮组（总计划 §五.3 方案一）：28px 高 / 6px 圆角 / 图标 14px + 12px 文字 ── */
.cap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease;
}
.cap .el-icon,
.cap .cap-text { position: relative; z-index: 1; }
.cap .el-icon { flex: none; }
.cap:focus-visible { outline: 2px solid var(--sshk-accent); outline-offset: 1px; }

/* 语义色口径：底色 light-9、前景/边框语义色（边框按 EP plain-tag 口径取混色），hover 加深一档（light-8） */
.cap-success {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  border-color: color-mix(in srgb, var(--el-color-success) 40%, transparent);
}
.cap-success:hover { background: var(--el-color-success-light-8); }
.cap-warning {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  border-color: color-mix(in srgb, var(--el-color-warning) 40%, transparent);
}
.cap-warning:hover { background: var(--el-color-warning-light-8); }
.cap-info {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
  border-color: color-mix(in srgb, var(--el-color-info) 40%, transparent);
}
.cap-info:hover { background: var(--el-color-info-light-8); }

/* 实底档：已下载可安装（success）/ 应用管理（primary）——hover 加深一档 */
.cap-success-solid {
  background: var(--el-color-success);
  color: #fff;
  border-color: var(--el-color-success);
}
.cap-success-solid:hover { background: color-mix(in srgb, var(--el-color-success) 86%, #000); }
.cap-primary {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}
.cap-primary:hover { background: color-mix(in srgb, var(--el-color-primary) 86%, #000); }

/* 主题胶囊：紫色（EP 语义色无紫，按 light-9 口径用混色近似，dark 下同样成立） */
.cap-theme {
  --cap-purple: #8b5cf6;
  background: color-mix(in srgb, var(--cap-purple) 14%, transparent);
  color: var(--cap-purple);
  border-color: color-mix(in srgb, var(--cap-purple) 40%, transparent);
}
.cap-theme:hover { background: color-mix(in srgb, var(--cap-purple) 22%, transparent); }
.cap-theme-select { width: 106px; }
.cap-theme-select :deep(.el-select__wrapper) {
  background: transparent;
  box-shadow: none;
  min-height: 24px;
  padding: 0 4px 0 0;
  font-size: 12px;
}
.cap-theme-select :deep(.el-select__selected-item),
.cap-theme-select :deep(.el-select__placeholder) { color: inherit; font-size: 12px; }

/* 检查中：Refresh 图标自旋（原 el-button loading 语义的胶囊等价实现） */
.cap.is-checking .el-icon { animation: cap-spin 1s linear infinite; }
@keyframes cap-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 下载中：进度遮罩——文字行上方盖一层随百分比从左填充的色块（原 update-btn__mask 原样迁移） */
.cap-update { position: relative; overflow: hidden; }
.cap-progress-mask {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--p, 0%);
  background: color-mix(in srgb, var(--el-color-success) 34%, transparent);
  transition: width .2s ease;
  pointer-events: none;
}
</style>
