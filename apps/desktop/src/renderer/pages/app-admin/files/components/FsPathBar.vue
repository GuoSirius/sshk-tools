<script setup lang="ts">
/**
 * 路径区（P4-4 自 FileExplorerPage 拆出）：导航 + 面包屑 + 可编辑路径 + 过滤下拉 + 搜索 + 视图切换。
 * 行为契约（与原页面逐字一致）：
 * - 独立一行，位于上传/下载工具栏下方（用户 2026-11-19）。
 * - 导航按钮图标+文字（纯图标易被误读成历史后退/前进，实际只有「上一级」语义）。
 * - 面包屑双击进入路径编辑；Windows 式折叠（中间段收成「…」）由父级 crumbItems/collapsedCrumbPath 派生。
 * - 搜索框回车 = 递归搜索；过滤下拉仅影响显示。
 */
import { Back, Grid, Menu as MenuIcon, Refresh, Search } from '@element-plus/icons-vue'

defineProps<{
  activeChannelName: string
  crumbs: string[]
  crumbItems: { seg: string; i: number }[]
  collapsedCrumbPath: string
}>()

const emit = defineEmits<{
  (e: 'goUp'): void
  (e: 'refresh'): void
  (e: 'gotoCrumb', index: number): void
  (e: 'submitPath'): void
  (e: 'runSearch'): void
}>()

const pathEditing = defineModel<boolean>('pathEditing', { default: false })
const pathInput = defineModel<string>('pathInput', { default: '' })
const filter = defineModel<string>('filter', { default: '' })
const kindFilter = defineModel<'all' | 'file' | 'dir'>('kindFilter', { default: 'all' })
const linkFilter = defineModel<'all' | 'linked' | 'unlinked'>('linkFilter', { default: 'all' })
const viewMode = defineModel<'list' | 'grid'>('viewMode', { default: 'list' })
</script>

<template>
  <div class="fs-path-bar">
    <!-- 导航：图标+文字（纯图标易被误读成历史后退/前进，实际只有「上一级」语义） -->
    <el-button size="small" type="primary" plain class="fs-nav-btn" :icon="Back" title="回到上一级目录 (Backspace)" @click="emit('goUp')">上一级</el-button>
    <el-button size="small" type="primary" plain class="fs-nav-btn" :icon="Refresh" title="刷新当前目录 (F5)" @click="emit('refresh')">刷新</el-button>
    <div v-if="!pathEditing" class="fs-crumbs" @dblclick="pathEditing = true">
      <span class="fs-crumb fs-crumb-root" @click="emit('gotoCrumb', -1)">{{ activeChannelName }}</span>
      <template v-if="crumbs.length > crumbItems.length">
        <span class="fs-crumb-sep">/</span>
        <span class="fs-crumb fs-crumb-ellipsis" :title="`展开：${collapsedCrumbPath}`" @click="emit('gotoCrumb', crumbs.length - crumbItems.length - 1)">…</span>
      </template>
      <template v-for="c in crumbItems" :key="c.i">
        <span class="fs-crumb-sep">/</span>
        <span class="fs-crumb" :title="c.seg" @click="emit('gotoCrumb', c.i)">{{ c.seg }}</span>
      </template>
    </div>
    <el-input clearable
      v-else
      v-model="pathInput"
      size="small"
      class="fs-path-input"
      placeholder="输入路径回车直达（oss:// 风格可省前缀，'..' 会被拒绝）"
      autofocus
      @keyup.enter="emit('submitPath')"
      @blur="pathEditing = false"
    />
    <el-select v-model="kindFilter" size="small" class="fs-dd-filter" title="按类型过滤">
      <el-option label="全部" value="all" />
      <el-option label="文件" value="file" />
      <el-option label="文件夹" value="dir" />
    </el-select>
    <el-select v-model="linkFilter" size="small" class="fs-dd-filter" title="按分享链接过滤">
      <el-option label="全部" value="all" />
      <el-option label="带链接" value="linked" />
      <el-option label="不带链接" value="unlinked" />
    </el-select>
    <el-input
      v-model="filter"
      size="small"
      class="fs-filter"
      :prefix-icon="Search"
      placeholder="当前目录内搜索；回车 = 递归搜索"
      clearable
      @keyup.enter="emit('runSearch')"
    />
    <el-button-group class="fs-view-toggle">
      <el-button size="small" :type="viewMode === 'list' ? 'primary' : 'default'" :icon="MenuIcon" title="列表视图" @click="viewMode = 'list'" />
      <el-button size="small" :type="viewMode === 'grid' ? 'primary' : 'default'" :icon="Grid" title="网格视图" @click="viewMode = 'grid'" />
    </el-button-group>
  </div>
</template>

<style scoped>
.fs-path-bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fs-crumbs { display: flex; align-items: center; min-width: 0; overflow: hidden; flex: 1; white-space: nowrap; }
.fs-crumb { cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 13px; }
.fs-crumb:hover { background: var(--el-fill-color); }
.fs-crumb-root { font-weight: 600; }
.fs-crumb-sep { opacity: .4; margin: 0 2px; }
/* Windows 式路径折叠：长路径中间段收成「…」，crumb 自身截断防超长段撑爆路径栏 */
.fs-crumb { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.fs-crumb-ellipsis { opacity: .65; letter-spacing: 1px; }
.fs-path-input { flex: 1; max-width: 560px; }
.fs-filter { width: 200px; margin-left: auto; }
/* 类型/链接下拉过滤（用户 2026-11-19）：紧跟搜索框左侧 */
.fs-dd-filter { width: 92px; margin-left: auto; }
.fs-dd-filter + .fs-dd-filter { margin-left: 8px; }
.fs-dd-filter + .fs-filter { margin-left: 8px; }
.fs-view-toggle { margin-left: 4px; }
/* 导航图标（后退/刷新）：small 按钮默认图标 12px 太细小，放大加主色 */
/* 上一级/刷新：图标+文字按钮（2026-11-17 用户反馈纯图标不明显） */
.fs-path-bar .fs-nav-btn { font-weight: 600; }
.fs-path-bar .fs-nav-btn .el-icon { font-size: 15px; }
</style>
