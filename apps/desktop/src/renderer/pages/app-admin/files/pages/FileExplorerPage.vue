<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ArrowDown,
  Box,
  ChatDotRound,
  CollectionTag,
  Connection,
  CopyDocument,
  Delete,
  Document,
  Download,
  EditPen,
  Folder,
  FolderAdd,
  FolderOpened,
  Grid,
  InfoFilled,
  Loading,
  Lock,
  MagicStick,
  Menu as MenuIcon,
  Plus,
  Rank,
  Refresh,
  Setting,
  Star,
  StarFilled,
  TrendCharts,
  Upload,
} from '@element-plus/icons-vue'
import {
  fsFormatSize,
  fsModeToRwx,
  isFsTextName,
  isFsZipName,
  type FsEntry,
} from '@sshk/shared'
import { FormHint, ShareDialog, useToolId } from '@sshk/ui-kit'
import FsChannelBar from '../components/FsChannelBar.vue'
import FsContextMenu from '../components/FsContextMenu.vue'
import FsEditorDialog from '../components/FsEditorDialog.vue'
import FsFavoritesDrawer from '../components/FsFavoritesDrawer.vue'
import FsNoteDialog from '../components/FsNoteDialog.vue'
import FsPathBar from '../components/FsPathBar.vue'
import FsPlayerDialog from '../components/FsPlayerDialog.vue'
import FsPreviewDialog from '../components/FsPreviewDialog.vue'
import { useFsAnnotations } from '../composables/useFsAnnotations'
import { useFsArchive } from '../composables/useFsArchive'
import { useFsClipboardMove } from '../composables/useFsClipboardMove'
import { useFsContextMenu } from '../composables/useFsContextMenu'
import { useFsDirPicker } from '../composables/useFsDirPicker'
import { useFsEntryOps } from '../composables/useFsEntryOps'
import { useFsFavorites } from '../composables/useFsFavorites'
import { useFsListing } from '../composables/useFsListing'
import { useFsMedia } from '../composables/useFsMedia'
import { useFsSearch } from '../composables/useFsSearch'
import { useFsSelection } from '../composables/useFsSelection'
import { useFsShareMarks } from '../composables/useFsShareMarks'
import { useFsTransfer } from '../composables/useFsTransfer'
import { useFsView } from '../composables/useFsView'

/**
 * X6 文件系统页（plans/08 §3）：进入文件管理工具默认展示。
 * 布局三段：通道切换条 / 路径区（面包屑 + 可编辑路径）+ 工具栏 / 文件列表（列表·网格双视图）
 * + 状态条 + 传输队列唤起入口（面板本体 P4-7 全局化挂 App.vue 根层，跨容器悬浮）。
 * 通道 = 文件管理（通道配置）的 remote/cloud profile；密钥只在 main（safeStorage），渲染层零接触。
 *
 * P4-4 结构拆分（行为保真）：本页收缩为「状态装配 + 布局编排」——
 * - 领域状态与行为在各 useFs* composable（composables/，装配顺序即原页面初始化顺序）；
 * - 自包含模板块拆到 components/（FsChannelBar/FsPathBar/FsPreviewDialog/FsEditorDialog/
 *   FsPlayerDialog/FsFavoritesDrawer/FsNoteDialog/FsContextMenu）；
 * - 跨域联动走注册回调（useFsListing.onListStart/onDirReload/onLocate）+ 页面级闭包注入，
 *   注册顺序 = 原页面执行顺序（搜索会话作废 → 清空选中；备注/分享状态随目录重载）。
 * - C-8 终审：原「更多▾ → 传输设置…」面板入口删除，分片参数迁「工具设置 > 传输与分片」
 *   （app.fs.multipart.*，manifest configGroups 驱动）；遗留分片清理保留在全局传输面板。
 */

/** #129 铁律：工具 id 单一来源=根组件 provideToolId 注入，renderer 禁字面量/常量表直取 */
const TOOL_ID = useToolId()

const themeDark = ref(true)
void window.api.config.get('app.themeMode').then((v) => { themeDark.value = String(v ?? 'dark') !== 'light' })

// ── 装配：核心列表（通道/目录/分页/导航/容量统计）──
const listing = useFsListing()
const {
  channels, outputRoot, profileId, path, pathInput, pathEditing,
  entries, cursor, loading, loadingMore, pageError, listEl,
  pendingNavPath, pendingNavSelect,
  activeChannel, hasWritable, crumbs, crumbItems, collapsedCrumbPath,
  isUsageLoading, showUsage, sizeCell,
  loadChannels, list, loadMore, enterDir, goUp, gotoCrumb, submitPathInput, refresh, fmtTime,
} = listing

// ── 装配：目标目录级联工具（移动/复制 与 解压到 共用）──
const dirPicker = useFsDirPicker({ profileId: () => profileId.value })

// ── 装配：ShareHub 分享（三态标记/分享弹框/媒体直链）──
const share = useFsShareMarks({
  toolId: () => TOOL_ID.value,
  profileId: () => profileId.value,
  activeChannel: () => activeChannel.value,
})
const { shareMarkOf, shareMarkTip, copyShareLink, shareDialog, canShareEntry, rowShare, loadShareRoutes } = share

// ── 装配：递归搜索（filter 由装配层持有，视图过滤与搜索共用同一输入框）──
const filter = ref('')
const search = useFsSearch({
  profileId: () => profileId.value,
  path: () => path.value,
  entries: () => entries.value,
  filter,
})
const {
  searchActive, searchLoading, searchEntries, searchTruncated, searchScannedDirs,
  runSearch, exitSearch, invalidateSession, bindResetSelection, searchDirHint, copyEntryDir,
} = search

// ── 装配：视图（视图切换/排序/过滤/列设置/过滤结果集）──
const view = useFsView({
  entries: () => entries.value,
  searchActive: () => searchActive.value,
  searchEntries: () => searchEntries.value,
  activeChannel: () => activeChannel.value,
  shareMarkOf,
  filter,
})
const {
  viewMode, sortKey, sortDir, kindFilter, linkFilter,
  filteredEntries, colsVisible, hasCreated, hasMode, hasOwner, colsOpen, colShown, listGridCols, fileIcon,
} = view

// ── 装配：选择（单击/Ctrl/Shift/全选/派生启用态）──
const selectionApi = useFsSelection(() => filteredEntries.value)
const {
  selection, selectedEntries, selSingle, selSingleFile, selSingleDir,
  reset: resetSelection, selectOnly, rowClick, toggleCheck, selectAll, copySelectedPaths,
} = selectionApi

// ── 装配：收藏夹 ──
const favorites = useFsFavorites({
  profileId, path, pendingNavPath, pendingNavSelect,
  list: (resetCursor?: boolean) => list(resetCursor),
})
const {
  favorites: favoriteList, favDrawerOpen,
  loadFavorites, isFavorited, gotoFavorite, addFavorites, removeFavorite, removeFavoriteById, toggleFav,
} = favorites

// ── 装配：备注 ──
const annotationsApi = useFsAnnotations({ profileId: () => profileId.value })
const {
  annotations, loadAnnotations, noteOpen, noteTargets, noteInput, noteSaving, openNote, submitNote,
} = annotationsApi

// ── 装配：传输（上传/下载/拖拽/上限设置/传输面板唤起；media 依赖 downloadEntries，故先建 transfer）──
const transfer = useFsTransfer({
  profileId: () => profileId.value,
  path: () => path.value,
  outputRoot: () => outputRoot.value,
  channels: () => channels.value,
  list: (resetCursor?: boolean) => list(resetCursor),
})
const {
  runningCount, openTransferPanel,
  uploadFiles, uploadDirs, uploadFromOutput,
  dupDialogOpen, dupList, resolveDupAction,
  elevated, adminTipDismissed, dismissAdminTip, dragOver,
  downloadEntries, rowLink, openDownloadDir, changeDownloadDir,
  transferCapsOpen, transferCapsForm, transferCapsSaving, openTransferCaps, submitTransferCaps, bindApplyCaps,
} = transfer

// ── 装配：媒体（预览/编辑/播放/在线上限；transfer 已先行建立，downloadEntries 直引）──
const media = useFsMedia({
  profileId: () => profileId.value,
  downloadEntries: (list0) => transfer.downloadEntries(list0),
  mediaDirectUrl: (entry) => share.mediaDirectUrl(entry),
  channelType: () => activeChannel.value?.type,
  refreshList: () => { void list(false) },
})
const {
  preview, onPreviewClose,
  editor, saveEditor,
  player, onMediaError,
  mediaLimitText, loadMediaLimit,
  openFile,
} = media

// ── 装配：剪贴板与复制/移动 ──
const clipboardMove = useFsClipboardMove({
  profileId: () => profileId.value,
  path: () => path.value,
  hasWritable: () => hasWritable.value,
  selectedEntries: () => selectedEntries.value,
  resetSelection,
  selectOnly,
  list: (resetCursor?: boolean) => list(resetCursor),
  channels: () => channels.value,
  openTransferPanel,
  dirPicker,
})
const {
  clipboard,
  clipCopy, clearClipboard, paste, rowPaste,
  moveOpen, moveMode, moveDirInput, moveDestProfile, moveDirProps, moveCascaderRef, moveCascaderPicked,
  openMove, onMoveDirPicked, submitMove, rowCopy, rowMove,
} = clipboardMove

// ── 装配：条目操作（新建/重命名/删除/权限/属性/转换）──
const entryOps = useFsEntryOps({
  profileId: () => profileId.value,
  path: () => path.value,
  hasMode: () => hasMode.value,
  list: (resetCursor?: boolean) => list(resetCursor),
  resetSelection,
  selSingle: () => selSingle.value,
  selSingleFile: () => selSingleFile.value,
  selectOnly,
  openTransferPanel,
  openFile: (entry) => openFile(entry),
})
const {
  mkdirOpen, mkdirName, mkdirInputRef, submitMkdir,
  renameOpen, renameName, renameInputRef, openRename, submitRename,
  deleteOpen, deleteTargets, openDelete, confirmDelete,
  newFile,
  canPerm, permOpen, permTarget, permOctal, permSaving, openPerm, permBits, togglePermBit, submitPerm,
  propsOpen, propsEntry, propsStat, openProps, openPropsFor,
  canConvert, convertOpen, convertTarget, convertForm, convertSaving, openConvert, submitConvert,
} = entryOps

// ── 装配：压缩/解压 ──
const archive = useFsArchive({
  profileId: () => profileId.value,
  path: () => path.value,
  hasWritable: () => hasWritable.value,
  activeChannel: () => activeChannel.value,
  selectedEntries: () => selectedEntries.value,
  selSingleFile: () => selSingleFile.value,
  list: (resetCursor?: boolean) => list(resetCursor),
  dirPicker,
})
const {
  zipLimitsOpen, zipLimitsForm, zipLimitsSaving, openZipLimits, submitZipLimits,
  doZip, canZip, canUnzip,
  unzipOpen, unzipSaving, unzipEntry, unzipDestProfile, unzipDirInput, unzipCascaderRef, unzipCascaderPicked,
  unzipDirProps, openUnzip, onUnzipDirPicked, submitUnzip,
} = archive

// ── 跨域联动接线（注册顺序 = 原页面行为顺序）──
// 模板 ref 绑定（ref="..." 按 setup 绑定名查找，滚动/聚焦/级联收起用）；TS noUnusedLocals 要求 script 侧有引用
void [listEl, mkdirInputRef, renameInputRef, moveCascaderRef, unzipCascaderRef]
listing.onListStart(() => {
  invalidateSession() // 在途搜索会话作废（切换目录/刷新时丢弃晚到的流式批次）
  resetSelection()
})
listing.onDirReload(() => {
  void loadAnnotations() // 备注/分享状态跟随目录重载
  void loadShareRoutes()
})
listing.onLocate((target) => {
  // 收藏文件跳转：进入父目录后选中该文件（未列到则忽略），仅定位文件时滚动到视口居中
  if (!entries.value.some((e) => e.path === target)) return
  selectOnly([target])
  listing.scrollEntryIntoView(target)
})
bindResetSelection(resetSelection)
bindApplyCaps((caps) => media.applyCaps(caps)) // 上限保存后同步媒体上限/直链开关

// ── 网格视图右键菜单 ──
const ctxMenu = useFsContextMenu((cmd, entry) => rowMoreCommand(cmd, entry))
const { ctxMenu: ctxMenuState, openCtxMenu, closeCtxMenu } = ctxMenu

// ── 弹框关闭 glue（组件只发意图，状态收口在页面，行为与原页面一致）──
function closePreview(): void {
  preview.value.open = false
  onPreviewClose() // PDF 的 Blob URL 释放内存（图片走 data URI 无需释放）
}
function onPreviewScale(value: number): void {
  preview.value.scale = value
}
function closeEditor(): void {
  editor.value.open = false
}
function closePlayer(): void {
  // 与原 @close 一致：清 src/mediaKey/entry，避免串台与旧源重复 error
  player.value.open = false
  player.value.src = ''
  player.value.mediaKey = ''
  player.value.entry = null
}
/** 右键菜单命令分发：先关菜单再执行（原 ctxRun） */
function runCtx(cmd: string): void {
  const entry = ctxMenuState.value?.entry
  closeCtxMenu()
  if (entry) rowMoreCommand(cmd, entry)
}

// ── plans/10 传输设置（C-8 终审 2026-11-21）：分片参数入口已迁「工具设置 > 传输与分片」分组
//    （app.fs.multipart.*，manifest configGroups 驱动）；本页不再保留任何传输设置入口；
//    遗留分片清理保留在全局传输面板（TransferPanel 展示 + 手动清理）。

// ── 打开：预览 / 编辑 / 下载 的行入口 ──
function rowOpen(entry: FsEntry): void {
  if (entry.kind === 'dir') enterDir(entry)
  else void openFile(entry)
}

// ── 工具栏「更多▾」分发（§3.1 + §十一 分组化：全部按选中态实时判定，避免误操作）──
function moreCommand(cmd: unknown): void {
  switch (String(cmd)) {
    case 'refresh': refresh(); return
    case 'usage': if (selSingleDir.value) void showUsage(selSingleDir.value); return
    case 'copyto': openMove('copy'); return
    case 'newfile': void newFile(); return
    case 'downloaddir': void changeDownloadDir(); return
    case 'opendir': void openDownloadDir(); return
    case 'cols': colsOpen.value = true; return
    case 'ziplimits': void openZipLimits(); return
    case 'transfercaps': void openTransferCaps(); return
    case 'note': openNote(selectedEntries.value); return
    case 'favorite': void addFavorites(selectedEntries.value); return
    case 'favorites': void loadFavorites().then(() => { favDrawerOpen.value = true }); return
    case 'copypath': void copySelectedPaths(); return
    case 'zip': void doZip(); return
    case 'unzip': if (canUnzip.value) openUnzip(selSingleFile.value!); return
    case 'convert': openConvert(); return
    case 'perm': openPerm(); return
    case 'props': openProps(); return
  }
}

/** 行「更多 ▾」/ 网格右键 共用分发（§11.4 定版 + 行外显操作全集） */
function rowMoreCommand(cmd: string, entry: FsEntry): void {
  switch (cmd) {
    case 'open': rowOpen(entry); return
    case 'download': void downloadEntries([entry]); return
    case 'link': void rowLink(entry); return
    case 'paste': void rowPaste(entry); return
    case 'copy': rowCopy(entry); return
    case 'move': rowMove(entry); return
    case 'rename': openRename(entry); return
    case 'delete': openDelete([entry]); return
    case 'usage': if (entry.kind === 'dir') void showUsage(entry); return
    case 'note': openNote([entry]); return
    case 'favorite': if (isFavorited(entry.path)) void removeFavorite(entry); else void addFavorites([entry]); return
    case 'copypath': void window.api.os.clipboardWrite(entry.path).then(() => ElMessage.success('路径已复制')); return
    case 'zip': void doZip([entry]); return
    case 'unzip': openUnzip(entry); return
    case 'convert': selectOnly([entry.path]); openConvert(); return
    case 'perm': selectOnly([entry.path]); openPerm(); return
    case 'props': void openPropsFor(entry); return
    case 'share': selectOnly([entry.path]); rowShare(entry); return
  }
}

// ── 键盘（§3.3） ──
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && ctxMenuState.value) { closeCtxMenu(); return }
  if (preview.value.open || editor.value.open || player.value.open || mkdirOpen.value || renameOpen.value || moveOpen.value || deleteOpen.value) return
  const target = event.target as HTMLElement
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
  if (event.key === 'F5') { event.preventDefault(); refresh(); return }
  if (event.key === 'Delete' && selectedEntries.value.length) { event.preventDefault(); openDelete(selectedEntries.value); return }
  if (event.key === 'F2' && selectedEntries.value.length === 1) { event.preventDefault(); openRename(selectedEntries.value[0]!); return }
  if (event.key === 'Backspace') { event.preventDefault(); goUp(); return }
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  if (event.key === 'a' || event.key === 'A') { event.preventDefault(); selectAll() }
  else if (event.key === 'c' || event.key === 'C') { event.preventDefault(); clipCopy('copy') }
  else if (event.key === 'x' || event.key === 'X') { event.preventDefault(); clipCopy('cut') }
  else if (event.key === 'v' || event.key === 'V') { event.preventDefault(); void paste() }
}

// ── 传输面板 P4-7 全局化：任务数据/显隐由 App 层单例承载，本页只关心唤起入口与完成刷新（在 useFsTransfer 内订阅）──
onMounted(() => {
  void loadChannels().then(() => { if (profileId.value) void list() })
  void loadFavorites() // §十一 收藏夹
  void loadMediaLimit() // 在线预览上限（可配）
})
</script>

<template>
  <div class="fs-page" tabindex="0" @keydown="onKeydown">
    <!-- 通道切换条 -->
    <FsChannelBar v-model:profile-id="profileId" :channels="channels" :active-channel="activeChannel" />

    <!-- 工具栏（§3.1 并集：常用操作外置，仅次要项进「更多▾」）；路径区紧随其下（用户 2026-11-19：路径单独一行，位于上传/下载下方） -->
    <div class="fs-toolbar">
      <el-dropdown @command="(c: unknown) => (String(c) === 'dir' ? uploadDirs() : String(c) === 'output' ? uploadFromOutput() : uploadFiles())">
        <el-button size="small" type="success" :icon="Upload" :disabled="!profileId">上传</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="file">上传文件</el-dropdown-item>
            <el-dropdown-item command="dir">上传文件夹（保留结构）</el-dropdown-item>
            <el-dropdown-item command="output">从 EDM 产物目录选择…</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" type="primary" :icon="Download" :disabled="!selectedEntries.length" @click="downloadEntries(selectedEntries)">下载</el-button>
      <el-button size="small" type="primary" plain :icon="FolderAdd" :disabled="!hasWritable || !profileId" @click="mkdirOpen = true">新建文件夹</el-button>
      <el-button size="small" type="primary" plain :icon="Document" :disabled="!hasWritable || !profileId" @click="newFile">新建文件</el-button>
      <el-button size="small" type="warning" plain :icon="CopyDocument" title="复制到剪贴板，再到目标目录点「粘贴」；行内「复制」是弹框直落" :disabled="!selectedEntries.length" @click="clipCopy('copy')">复制（剪贴板）</el-button>
      <el-button size="small" type="success" plain :icon="Plus" title="粘贴 (Ctrl+V)；跨通道粘贴按复制执行" :disabled="!clipboard || !hasWritable" @click="paste">
        粘贴{{ clipboard ? `（${clipboard.items.length} 项${clipboard.op === 'cut' ? ' · 剪切' : ''}${clipboard.profileId !== profileId ? ' · 跨通道' : ''}）` : '' }}
      </el-button>
      <!-- 用户 2026-11-19：复制后不想粘贴（误触）可一键清空剪贴板 -->
      <el-button v-if="clipboard" size="small" type="danger" plain title="清空剪贴板（不执行粘贴）" @click="clearClipboard">清空</el-button>
      <el-button size="small" type="warning" plain :icon="Rank" :disabled="!selectedEntries.length || !hasWritable" @click="openMove('move')">移动</el-button>
      <el-button size="small" type="primary" plain :icon="EditPen" :disabled="selectedEntries.length !== 1 || !hasWritable" @click="openRename(selectedEntries[0]!)">重命名</el-button>
      <el-button size="small" type="danger" plain :icon="Delete" :disabled="!selectedEntries.length || !hasWritable" @click="openDelete(selectedEntries)">删除</el-button>
      <el-dropdown @command="moreCommand">
        <el-button size="small" :icon="MenuIcon">
          更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <!-- 整理组（§11.3：顶部既有按钮保持不动，新增操作全部分组收纳） -->
            <el-dropdown-item command="note" :icon="ChatDotRound" :disabled="!selectedEntries.length || !hasWritable">设置备注…</el-dropdown-item>
            <el-dropdown-item command="favorite" :icon="CollectionTag" :disabled="!selectedEntries.length || !profileId">添加收藏</el-dropdown-item>
            <el-dropdown-item command="favorites" :icon="Star">收藏夹…</el-dropdown-item>
            <el-dropdown-item command="copypath" :icon="CopyDocument" :disabled="!selectedEntries.length">复制路径</el-dropdown-item>
            <el-dropdown-item command="zip" :icon="Box" :disabled="!canZip">压缩为 zip…</el-dropdown-item>
            <el-dropdown-item command="unzip" :icon="FolderOpened" :disabled="!canUnzip">解压到…</el-dropdown-item>
            <el-dropdown-item command="convert" :icon="MagicStick" :disabled="!canConvert">转换文本编码 / 换行符…</el-dropdown-item>
            <!-- 权限与信息组 -->
            <el-dropdown-item command="perm" :icon="Lock" divided :disabled="!canPerm">编辑权限…</el-dropdown-item>
            <el-dropdown-item command="props" :icon="InfoFilled" :disabled="selectedEntries.length !== 1">属性</el-dropdown-item>
            <el-dropdown-item command="usage" :icon="TrendCharts" :disabled="!selSingleDir">统计选中目录容量</el-dropdown-item>
            <!-- 视图与设置组 -->
            <el-dropdown-item command="copyto" :icon="CopyDocument" divided :disabled="!selectedEntries.length">复制到…</el-dropdown-item>
            <el-dropdown-item command="cols" :icon="Grid">列设置…</el-dropdown-item>
            <el-dropdown-item command="ziplimits" :icon="Setting">压缩上限设置…</el-dropdown-item>
            <el-dropdown-item command="transfercaps" :icon="Setting">上限设置…</el-dropdown-item>
            <el-dropdown-item command="refresh" :icon="Refresh">刷新（F5）</el-dropdown-item>
            <el-dropdown-item command="downloaddir" :icon="MenuIcon">下载目录设置…</el-dropdown-item>
            <el-dropdown-item command="opendir" :icon="Folder">打开本地下载目录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 路径区（独立一行，位于上传/下载工具栏下方）：导航 + 面包屑 + 过滤下拉 + 搜索 + 视图切换 -->
    <FsPathBar
      v-model:path-editing="pathEditing"
      v-model:path-input="pathInput"
      v-model:filter="filter"
      v-model:kind-filter="kindFilter"
      v-model:link-filter="linkFilter"
      v-model:view-mode="viewMode"
      :active-channel-name="activeChannel?.name ?? '通道'"
      :crumbs="crumbs"
      :crumb-items="crumbItems"
      :collapsed-crumb-path="collapsedCrumbPath"
      @go-up="goUp"
      @refresh="refresh"
      @goto-crumb="gotoCrumb"
      @submit-path="submitPathInput"
      @run-search="runSearch"
    />

    <!-- 文件列表 -->
    <el-alert
      v-if="elevated && !adminTipDismissed"
      class="fs-admin-tip"
      type="warning" closable show-icon
      title="当前以管理员模式运行：Windows 系统会拦截资源管理器向本应用的拖放（UIPI 安全限制），请改用「上传文件」按钮选择，或以普通权限运行应用"
      @close="dismissAdminTip"
    />
    <div ref="listEl" class="fs-list" :class="{ 'is-drag': dragOver }">
      <!-- 递归搜索结果横幅（二期） -->
      <div v-if="searchActive" class="fs-search-banner">
        <span class="fs-search-info">
          <el-icon v-if="searchLoading" class="fs-search-spin"><Loading /></el-icon>
          <span>递归搜索「{{ filter.trim() }}」：{{ searchLoading ? `已找到 ${searchEntries.length} 个 · 已扫描 ${searchScannedDirs} 个目录…` : `${searchEntries.length} 个结果` }}{{ searchTruncated ? '（已达扫描上限，结果可能不全）' : '' }}</span>
        </span>
        <el-button size="small" text type="primary" @click="exitSearch">返回目录</el-button>
      </div>
      <div v-if="!profileId" class="fs-empty">
        <p>还没有配置上传通道</p>
        <p class="fs-empty-hint">到「通道配置」页添加远程（FTP/SFTP）或云（OSS 等）profile 后即可浏览管理远端文件。</p>
      </div>
      <div v-else-if="pageError" class="fs-empty fs-error">
        <p>加载失败：{{ pageError }}</p>
        <el-button size="small" type="primary" plain @click="refresh">重试</el-button>
      </div>
      <!-- 流式搜索：首批结果到达即渲染列表，不再因 searchLoading 一直白屏 -->
      <div v-else-if="loading || (searchLoading && searchEntries.length === 0)" class="fs-empty"><p>{{ searchLoading ? '递归搜索中…' : '加载中…' }}</p></div>
      <div v-else-if="filteredEntries.length === 0" class="fs-empty">
        <p>{{ searchActive ? '递归搜索没有结果' : (filter ? '没有匹配的文件' : '此目录为空') }}</p>
        <p class="fs-empty-hint">{{ searchActive ? '换个关键词，或到上级目录再搜' : '把文件或文件夹拖进来即可上传到当前目录' }}</p>
      </div>

      <!-- 列表视图：单一 grid 容器 + subgrid 行——表头/数据行共用同一组列轨道，
           修复操作列 max-content 被两个独立 grid 各自计算导致的列错位（用户 2026-11-18） -->
      <template v-else-if="viewMode === 'list'">
        <div class="fs-table" :style="{ gridTemplateColumns: listGridCols }">
          <div class="fs-thead">
            <span class="fs-col-check">
              <el-checkbox :model-value="selection.size > 0 && selection.size === filteredEntries.length" :indeterminate="selection.size > 0 && selection.size < filteredEntries.length" @change="selectAll" />
            </span>
            <span class="fs-col-name fs-sortable" @click="sortKey = 'name'; sortDir = sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc'">名称{{ sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span class="fs-col-size fs-sortable" @click="sortKey = 'size'; sortDir = sortKey === 'size' && sortDir === 'asc' ? 'desc' : 'asc'">类型/大小{{ sortKey === 'size' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span class="fs-col-time fs-sortable" @click="sortKey = 'time'; sortDir = sortKey === 'time' && sortDir === 'asc' ? 'desc' : 'asc'">修改时间{{ sortKey === 'time' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}</span>
            <span v-if="colShown.createdAt" class="fs-col-time">创建时间</span>
            <span v-if="colShown.mode" class="fs-col-mode">权限</span>
            <span v-if="colShown.owner" class="fs-col-owner">用户/组</span>
            <span v-if="colShown.note" class="fs-col-note">备注</span>
            <span class="fs-col-op">操作</span>
          </div>
          <div
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="fs-row"
            :class="{ selected: selection.has(entry.path) }"
            :data-entry-path="entry.path"
            @click="rowClick(entry, $event)"
            @dblclick="rowOpen(entry)"
          >
          <span class="fs-col-check"><el-checkbox :model-value="selection.has(entry.path)" @click.stop @dblclick.stop @change="toggleCheck(entry)" /></span>
          <span class="fs-col-name">
            <el-icon class="fs-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
            <span class="fs-name" :class="{ 'is-dir': entry.kind === 'dir' }" :title="entry.path">{{ entry.name }}</span>
            <!-- 分享状态标记（用户 2026-11-19）：统一 Connection 图标，绿=自己的分享、橙=随父级；点击优先复制自己、否则父级 -->
            <el-tooltip v-if="shareMarkOf(entry).kind !== 'none'" :content="shareMarkTip(entry)" placement="top">
              <el-icon
                class="fs-share-mark"
                :class="shareMarkOf(entry).kind === 'own' ? 'is-own' : 'is-inherited'"
                @click.stop="copyShareLink(entry)"
              ><Connection /></el-icon>
            </el-tooltip>
            <el-tooltip v-if="searchDirHint(entry)" :content="searchDirHint(entry)" placement="top">
              <el-icon class="fs-dir-hint" @click.stop="copyEntryDir(entry)"><FolderOpened /></el-icon>
            </el-tooltip>
            <el-icon v-if="entry.kind === 'dir' && isUsageLoading(entry.path)" class="fs-usage-spin is-loading" title="正在统计…"><Loading /></el-icon>
            <el-button
              size="small" text
              class="fs-fav-toggle"
              :class="{ 'is-fav': isFavorited(entry.path) }"
              :title="isFavorited(entry.path) ? '取消收藏' : '收藏'"
              :aria-label="isFavorited(entry.path) ? '取消收藏' : '收藏'"
              @click.stop="toggleFav(entry)"
            ><el-icon><component :is="isFavorited(entry.path) ? StarFilled : Star" /></el-icon></el-button>
          </span>
          <span class="fs-col-size" :title="sizeCell(entry)">{{ sizeCell(entry) }}</span>
          <span class="fs-col-time" :title="fmtTime(entry.modified)">{{ fmtTime(entry.modified) }}</span>
          <span v-if="colShown.createdAt" class="fs-col-time" :title="fmtTime(entry.createdAt)">{{ fmtTime(entry.createdAt) }}</span>
          <span v-if="colShown.mode" class="fs-col-mode" :title="entry.mode ? `${entry.mode} ${fsModeToRwx(entry.mode)}` : ''">{{ entry.mode ?? '—' }}</span>
          <span v-if="colShown.owner" class="fs-col-owner" :title="entry.owner ? `${entry.owner}:${entry.group ?? ''}` : ''">{{ entry.owner ? `${entry.owner}:${entry.group ?? '—'}` : '—' }}</span>
          <span v-if="colShown.note" class="fs-col-note" :title="annotations.get(entry.path) ?? ''">{{ annotations.get(entry.path) ?? '' }}</span>
          <span class="fs-col-op">
            <!-- §11.4 顺序（用户 2026-11-18 改版：下载不区分文件/目录，统一放删除前）：
                 链接(文件)→粘贴(目录)→复制→移动→重命名→下载(全部)→删除→更多▾ -->
            <!-- 远程/云通道：baseUrl 裸链；本地通道：ShareHub 分享链接（用户 2026-11-19 定版，二者互斥按通道） -->
            <el-button v-if="entry.kind === 'file' && activeChannel?.type !== 'local'" size="small" text type="primary" title="复制外链（baseUrl + 文件路径）" @click.stop="rowLink(entry)">链接</el-button>
            <el-button v-if="canShareEntry()" size="small" text type="success" :title="entry.kind === 'dir' ? '分享目录（可勾选允许浏览整棵子树；带有效期、可撤销）' : '分享该文件（带有效期、可撤销）'" @click.stop="rowShare(entry)">分享链接</el-button>
            <el-button v-if="entry.kind === 'dir' && clipboard && hasWritable" size="small" text type="success" title="把剪贴板内容粘贴进该目录" @click.stop="rowPaste(entry)">粘贴</el-button>
            <el-button v-if="hasWritable" size="small" text type="warning" @click.stop="rowCopy(entry)">复制</el-button>
            <el-button v-if="hasWritable" size="small" text type="warning" @click.stop="rowMove(entry)">移动</el-button>
            <el-button v-if="hasWritable" size="small" text type="primary" @click.stop="openRename(entry)">重命名</el-button>
            <el-button size="small" text type="success" :title="entry.kind === 'dir' ? '目录递归下载到下载目录' : '下载到下载目录'" @click.stop="downloadEntries([entry])">下载</el-button>
            <el-button v-if="hasWritable" size="small" text type="danger" @click.stop="openDelete([entry])">删除</el-button>
            <el-dropdown trigger="click" @command="(c: unknown) => rowMoreCommand(String(c), entry)">
              <el-button size="small" text @click.stop>更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <!-- 信息组 -->
                  <el-dropdown-item command="props" :icon="InfoFilled">属性</el-dropdown-item>
                  <el-dropdown-item v-if="entry.kind === 'dir'" command="usage" :icon="TrendCharts">统计</el-dropdown-item>
                  <el-dropdown-item command="note" :icon="ChatDotRound">设置备注…</el-dropdown-item>
                  <el-dropdown-item command="favorite" :icon="CollectionTag">{{ isFavorited(entry.path) ? '取消收藏' : '添加收藏' }}</el-dropdown-item>
                  <el-dropdown-item command="copypath" :icon="CopyDocument">复制路径</el-dropdown-item>
                  <!-- 工具组（按通道与文件类型实时显隐：压缩/解压仅本地，文本转换仅文本扩展） -->
                  <template v-if="activeChannel?.type === 'local'">
                    <el-dropdown-item command="zip" :icon="Box" divided>压缩为 zip…</el-dropdown-item>
                    <el-dropdown-item v-if="isFsZipName(entry.name)" command="unzip" :icon="FolderOpened">解压到…</el-dropdown-item>
                  </template>
                  <el-dropdown-item v-if="entry.kind === 'file' && isFsTextName(entry.name)" command="convert" :icon="MagicStick" divided>转换编码 / 换行符…</el-dropdown-item>
                  <!-- 权限组（ShareHub 分享已外显为行操作「分享链接」，不再在更多菜单重复） -->
                  <el-dropdown-item v-if="hasMode" command="perm" :icon="Lock" divided :disabled="!entry.mode">编辑权限…</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
          </div>
          <div v-if="cursor" class="fs-more">
            <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多…</el-button>
          </div>
        </div>
      </template>

      <!-- 网格视图 -->
      <template v-else>
        <div class="fs-grid">
          <div
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="fs-cell"
            :class="{ selected: selection.has(entry.path) }"
            :data-entry-path="entry.path"
            :title="`${entry.name}\n${entry.kind === 'dir' ? '目录' : fsFormatSize(entry.size)} · ${fmtTime(entry.modified)}`"
            @click="rowClick(entry, $event)"
            @dblclick="rowOpen(entry)"
            @contextmenu.prevent="openCtxMenu(entry, $event)"
          >
            <!-- 分享标记（用户 2026-11-19）：卡片视图叠在文件类型图标右上角作角标，不占行高 -->
            <span class="fs-cell-icon-wrap">
              <el-icon class="fs-cell-icon" :class="{ 'is-dir': entry.kind === 'dir' }"><component :is="fileIcon(entry)" /></el-icon>
              <el-tooltip v-if="shareMarkOf(entry).kind !== 'none'" :content="shareMarkTip(entry)" placement="top">
                <el-icon
                  class="fs-share-mark"
                  :class="shareMarkOf(entry).kind === 'own' ? 'is-own' : 'is-inherited'"
                  @click.stop="copyShareLink(entry)"
                ><Connection /></el-icon>
              </el-tooltip>
              <!-- 收藏星标（用户 2026-11-19）：卡片视图叠在类型图标左下角，hover 展示、已收藏常显 -->
              <el-tooltip :content="isFavorited(entry.path) ? '取消收藏' : '收藏'" placement="top">
                <el-icon class="fs-cell-fav" :class="{ 'is-fav': isFavorited(entry.path) }" @click.stop="toggleFav(entry)">
                  <component :is="isFavorited(entry.path) ? StarFilled : Star" />
                </el-icon>
              </el-tooltip>
            </span>
            <span class="fs-cell-name">{{ entry.name }}</span>
            <el-tooltip v-if="searchDirHint(entry)" :content="searchDirHint(entry)" placement="top">
              <el-icon class="fs-dir-hint" @click.stop="copyEntryDir(entry)"><FolderOpened /></el-icon>
            </el-tooltip>
            <span class="fs-cell-meta">{{ sizeCell(entry) }}</span>
          </div>
        </div>
        <div v-if="cursor" class="fs-more">
          <el-button size="small" text :loading="loadingMore" @click="loadMore">加载更多…</el-button>
        </div>
      </template>
    </div>

    <!-- 状态条 -->
    <div class="fs-status">
      <span>共 {{ filteredEntries.length }} 项（{{ filteredEntries.filter((e) => e.kind === 'dir').length }} 目录 / {{ filteredEntries.filter((e) => e.kind === 'file').length }} 文件）</span>
      <span v-if="selection.size"> · 已选 {{ selection.size }} 项</span>
      <span class="fs-spacer" />
      <el-button size="small" text type="primary" :icon="MenuIcon" @click="openTransferPanel">
        传输队列{{ runningCount ? `（${runningCount} 进行中）` : '' }}
      </el-button>    </div>

    <!-- 拖拽遮罩提示 -->
    <div v-if="dragOver" class="fs-drop-mask">
      <div class="fs-drop-box">松开鼠标上传到当前目录</div>
    </div>

    <!-- 新建目录 -->
    <el-dialog v-model="mkdirOpen" title="新建文件夹" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input ref="mkdirInputRef" clearable v-model="mkdirName" data-autofocus placeholder="目录名（不含斜杠）" @keyup.enter="submitMkdir" />
      <template #footer>
        <el-button @click="mkdirOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMkdir">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog v-model="renameOpen" title="重命名" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input ref="renameInputRef" clearable v-model="renameName" data-autofocus @keyup.enter="submitRename" />
      <template #footer>
        <el-button @click="renameOpen = false">取消</el-button>
        <el-button type="primary" @click="submitRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 复制到 / 移动到 -->
    <el-dialog v-model="moveOpen" :title="moveMode === 'move' ? '移动到…' : '复制到…'" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div class="fs-move-body">
        <!-- 项20：复制/移动都可选目标通道；跨通道走传输队列，移动=复制成功删源 -->
        <template v-if="moveMode === 'copy' || moveMode === 'move'">
          <div class="hint" style="margin-bottom: 6px">目标通道（选择其它通道即跨通道{{ moveMode === 'move' ? '移动（复制后删源）' : '复制' }}，走传输队列）：</div>
          <el-select v-model="moveDestProfile" size="small" style="width: 100%; margin-bottom: 12px" filterable>
            <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="`${c.name}（${c.detail}）`" :disabled="!c.hasSecret" />
          </el-select>
        </template>
        <div class="hint" style="margin-bottom: 8px">目标目录（如 /a/b；留空或 / 为根目录）：</div>
        <el-input clearable v-model="moveDirInput" placeholder="/a/b，也可从下方目录树选择" @keyup.enter="submitMove" />
        <el-cascader
          ref="moveCascaderRef"
          :key="moveDestProfile || profileId || ''"
          :class="['fs-move-cascader', { 'is-root-selected': moveCascaderPicked === '/' }]"
          :props="moveDirProps"
          separator="/"
          popper-class="fs-dir-cascader-popper"
          size="small"
          placeholder="或从目录树选择目标目录（逐级下钻，点圈选中）"
          clearable
          style="width: 100%; margin-top: 8px"
          @change="onMoveDirPicked"
        />
        <div style="margin-top: 10px; display: flex; gap: 12px; align-items: center">
          <div class="fs-crumb" @click="moveDirInput = '/'">根目录 /</div>
          <div class="fs-crumb" @click="moveDirInput = path">填当前目录：{{ path === '/' ? '/（根）' : path }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="moveOpen = false">取消</el-button>
        <el-button type="primary" @click="submitMove">{{ moveMode === 'move' ? '移动' : '复制' }}</el-button>
      </template>
    </el-dialog>

    <!-- 解压到…（目标通道可选=跨源解压；目录手输/级联，不存在自动创建；同名条目覆盖确认） -->
    <el-dialog v-model="unzipOpen" title="解压到…" width="500px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="unzipEntry">
        <div class="hint" style="margin-bottom: 8px">把「{{ unzipEntry.name }}」解压到目标目录（目录不存在将自动创建）：</div>
        <div class="hint" style="margin-bottom: 6px">目标通道（选择其它通道即跨源解压：zip 读入内存后写入目标通道，受压缩上限约束）：</div>
        <el-select v-model="unzipDestProfile" size="small" style="width: 100%; margin-bottom: 12px" filterable>
          <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="`${c.name}（${c.detail}）`" :disabled="!c.hasSecret" />
        </el-select>
        <div class="hint" style="margin-bottom: 8px">目标目录（如 /docs/output；留空或 / 不可用，须为具体目录路径）：</div>
        <el-input clearable v-model="unzipDirInput" placeholder="/a/b，也可从下方目录树选择" data-autofocus @keyup.enter="submitUnzip()" />
        <el-cascader
          ref="unzipCascaderRef"
          :key="unzipDestProfile || profileId || ''"
          :class="['fs-move-cascader', { 'is-root-selected': unzipCascaderPicked === '/' }]"
          :props="unzipDirProps"
          separator="/"
          popper-class="fs-dir-cascader-popper"
          size="small"
          placeholder="或从目录树选择目标目录（逐级下钻，点圈选中）"
          clearable
          style="width: 100%; margin-top: 8px"
          @change="onUnzipDirPicked"
        />
        <div class="hint" style="margin-top: 10px">默认 = zip 所在目录下以 zip 名新建目录。目标目录中已有同名条目时会先询问是否覆盖。</div>
      </template>
      <template #footer>
        <el-button @click="unzipOpen = false">取消</el-button>
        <el-button type="primary" :loading="unzipSaving" @click="submitUnzip()">解压</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认（纯文件，无目录时） -->
    <el-dialog v-model="deleteOpen" title="删除确认" width="460px" :close-on-click-modal="false" :close-on-press-escape="false">
      <p>确定删除以下 {{ deleteTargets.length }} 项吗？此操作不可恢复。</p>
      <p class="fs-delete-list">{{ deleteTargets.map((e) => e.name).join('、') }}</p>
      <template #footer>
        <el-button @click="deleteOpen = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">删除</el-button>
      </template>
    </el-dialog>

    <!-- 图片/PDF 预览 -->
    <FsPreviewDialog :preview="preview" @close="closePreview" @scale="onPreviewScale" />

    <!-- 文本编辑器（文件名 · 大小 统计信息置顶，用户 2026-11-18） -->
    <FsEditorDialog v-model:content="editor.content" :editor="editor" :theme-dark="themeDark" @close="closeEditor" @save="saveEditor" />

    <!-- 网格视图右键菜单（与行操作全集一致，Teleport 到 body 防被列表容器裁切） -->
    <FsContextMenu
      :menu="ctxMenuState"
      :has-writable="hasWritable"
      :has-mode="hasMode"
      :has-clipboard="Boolean(clipboard)"
      :channel-type="activeChannel?.type"
      :is-favorited="isFavorited"
      :can-share="canShareEntry()"
      @run="runCtx"
    />

    <!-- 音视频播放：直链(src=域名/分享链接) 或边下边播(src=localres://)；右上 × 关闭 -->
    <FsPlayerDialog :player="player" :media-limit-text="mediaLimitText" @close="closePlayer" @media-error="onMediaError" />

    <!-- 上传重名确认：三选一（取消/保留重命名/全部覆盖）；文件名限高滚动，单次多选也不撑爆弹框 -->
    <el-dialog
      v-model="dupDialogOpen"
      title="上传重名确认"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @closed="resolveDupAction('skip')"
    >
      <div class="hint" style="margin-bottom: 8px">检测到 {{ dupList.length }} 个重名（含后缀）文件，请选择处理方式：</div>
      <ul class="fs-dup-list">
        <li v-for="n in dupList" :key="n" :title="n">{{ n }}</li>
      </ul>
      <div class="hint" style="margin-top: 10px; line-height: 1.9">
        · <b>保留</b>：重命名为 <code>原名_时间戳.后缀</code>（同批同一时间戳）<br />
        · <b>全部覆盖</b>：直接覆盖同名文件<br />
        · <b>取消</b>：忽略重名文件，其余照传
      </div>
      <template #footer>
        <el-button @click="resolveDupAction('skip')">取消</el-button>
        <el-button type="primary" @click="resolveDupAction('rename')">保留（自动重命名）</el-button>
        <el-button type="danger" @click="resolveDupAction('overwrite')">全部覆盖</el-button>
      </template>
    </el-dialog>

    <!-- P4-7：传输队列悬浮面板已全局化（App.vue 根层挂载），本页仅保留状态条唤起入口 -->

    <!-- ShareHub 安全分享（plans/09 S15）：本地通道文件的 TTL/可撤销分享 -->
    <ShareDialog
      v-model:open="shareDialog.open"
      :tool-id="TOOL_ID"
      :label="shareDialog.label"
      :default-root="shareDialog.root"
      :default-entry="shareDialog.entry"
      @changed="void loadShareRoutes()"
    />

    <!-- §十一：设置备注（确认后生效；多选批量同备注） -->
    <FsNoteDialog v-model:open="noteOpen" v-model:input="noteInput" :targets="noteTargets" :saving="noteSaving" @submit="submitNote" />

    <!-- §十一：编辑权限（本地 / SFTP；rwx 勾选 ↔ 八进制双向联动，确认后生效） -->
    <el-dialog v-model="permOpen" title="编辑权限" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="permTarget">
        <div class="hint" style="margin-bottom: 10px">{{ permTarget.name }} · 当前 {{ permTarget.mode }}（{{ fsModeToRwx(permTarget.mode) }}）</div>
        <div class="fs-perm-grid">
          <span />
          <span class="fs-perm-head">读</span><span class="fs-perm-head">写</span><span class="fs-perm-head">执行</span>
          <span class="fs-perm-label">属主</span>
          <template v-for="(bit, i) in permBits().owner" :key="`o${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('owner', i as 0 | 1 | 2)" />
          </template>
          <span class="fs-perm-label">属组</span>
          <template v-for="(bit, i) in permBits().group" :key="`g${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('group', i as 0 | 1 | 2)" />
          </template>
          <span class="fs-perm-label">其他</span>
          <template v-for="(bit, i) in permBits().other" :key="`t${i}`">
            <el-checkbox class="fs-perm-check" :model-value="bit" @change="togglePermBit('other', i as 0 | 1 | 2)" />
          </template>
        </div>
        <div class="fs-perm-octal">
          八进制：<el-input v-model="permOctal" data-autofocus class="fs-perm-octal-input" size="small" placeholder="0644" @keyup.enter="submitPerm" />
          <span class="hint">= {{ fsModeToRwx(permOctal) }}</span>
        </div>
        <div class="hint" style="margin-top: 8px">Windows 本地目录实际只有只读位生效；POSIX（SFTP/Linux）全量生效。点「修改」后二次确认才写入。</div>
      </template>
      <template #footer>
        <el-button @click="permOpen = false">取消</el-button>
        <el-button type="primary" :loading="permSaving" @click="submitPerm">修改</el-button>
      </template>
    </el-dialog>

    <!-- §十一：属性（只读展示 + 编辑入口） -->
    <el-dialog v-model="propsOpen" title="属性" width="520px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="propsEntry">
        <div class="fs-props">
          <div class="fs-props-row"><span class="fs-props-k">名称</span><span class="fs-props-v">{{ propsEntry.name }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">路径</span><span class="fs-props-v">{{ propsEntry.path || '(根)' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">类型</span><span class="fs-props-v">{{ propsEntry.kind === 'dir' ? '目录' : '文件' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">大小</span><span class="fs-props-v">{{ propsEntry.kind === 'dir' ? sizeCell(propsEntry) : fsFormatSize(propsEntry.size) }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">修改时间</span><span class="fs-props-v">{{ fmtTime(propsStat?.modified ?? propsEntry.modified) }}</span></div>
          <div v-if="hasCreated" class="fs-props-row"><span class="fs-props-k">创建时间</span><span class="fs-props-v">{{ fmtTime(propsEntry.createdAt) }}</span></div>
          <div v-if="hasMode" class="fs-props-row"><span class="fs-props-k">权限</span><span class="fs-props-v">{{ propsEntry.mode ? `${propsEntry.mode}（${fsModeToRwx(propsEntry.mode)}）` : '—' }}</span></div>
          <div v-if="hasOwner" class="fs-props-row"><span class="fs-props-k">用户/组</span><span class="fs-props-v">{{ propsEntry.owner ? `${propsEntry.owner}:${propsEntry.group ?? '—'}` : '—' }}</span></div>
          <div class="fs-props-row"><span class="fs-props-k">备注</span><span class="fs-props-v">{{ annotations.get(propsEntry.path) || '—' }}</span></div>
        </div>
      </template>
      <template #footer>
        <el-button v-if="propsEntry && colShown.note" size="small" type="warning" plain @click="openNote([propsEntry!])">编辑备注</el-button>
        <el-button v-if="propsEntry && hasMode && propsEntry.mode" size="small" type="primary" plain @click="selection = new Set([propsEntry!.path]); permTarget = propsEntry; permOctal = propsEntry.mode ?? '0644'; propsOpen = false; permOpen = true">编辑权限</el-button>
        <el-button size="small" @click="propsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- §十一：转换文本编码 / 换行符（转换格式 A，全通道，确认后生效） -->
    <el-dialog v-model="convertOpen" title="转换文本编码 / 换行符" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="convertTarget">
        <div class="hint" style="margin-bottom: 10px">{{ convertTarget.name }} · {{ fsFormatSize(convertTarget.size) }}</div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">当前编码</span>
          <el-select v-model="convertForm.from" size="small" style="flex: 1">
            <el-option label="自动检测" value="auto" />
            <el-option label="UTF-8" value="utf-8" />
            <el-option label="GBK / GB2312" value="gbk" />
            <el-option label="Big5" value="big5" />
          </el-select>
        </div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">转换为</span>
          <el-select v-model="convertForm.to" size="small" style="flex: 1">
            <el-option label="UTF-8（推荐）" value="utf-8" />
            <el-option label="GBK / GB2312" value="gbk" />
          </el-select>
        </div>
        <div class="fs-convert-row">
          <span class="fs-convert-label">换行符</span>
          <el-select v-model="convertForm.newline" size="small" style="flex: 1">
            <el-option label="保持不变" value="keep" />
            <el-option label="LF（Unix \\n）" value="lf" />
            <el-option label="CRLF（Windows \\r\\n）" value="crlf" />
          </el-select>
        </div>
        <div class="hint" style="margin-top: 8px">直接写回原文件（转换前建议下载备份）；「自动检测」按 BOM → UTF-8 严格校验 → GBK 的顺序判定。</div>
      </template>
      <template #footer>
        <el-button @click="convertOpen = false">取消</el-button>
        <el-button type="primary" :loading="convertSaving" @click="submitConvert">转换</el-button>
      </template>
    </el-dialog>

    <!-- §十一：列设置（显隐记忆 localStorage；通道不具备数据的列禁用） -->
    <el-dialog v-model="colsOpen" title="列设置" width="400px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div class="fs-cols">
        <el-checkbox v-model="colsVisible.note">备注（全通道可用）</el-checkbox>
        <el-checkbox v-model="colsVisible.createdAt" :disabled="!hasCreated" title="仅本地目录通道提供创建时间">创建时间{{ hasCreated ? '' : '（当前通道无数据）' }}</el-checkbox>
        <el-checkbox v-model="colsVisible.mode" :disabled="!hasMode" title="仅本地与 SFTP 通道提供权限">权限{{ hasMode ? '' : '（当前通道无数据）' }}</el-checkbox>
        <el-checkbox v-model="colsVisible.owner" :disabled="!hasOwner" title="仅本地与 SFTP 通道提供用户/组">用户 / 用户组{{ hasOwner ? '' : '（当前通道无数据）' }}</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="colsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- §十一：压缩/解压上限设置（app.fs.zipFileCap / zipBytesCap） -->
    <el-dialog v-model="zipLimitsOpen" title="压缩上限设置" width="400px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto" size="small">
        <el-form-item label="文件数上限">
          <el-input-number v-model="zipLimitsForm.fileCap" :min="10" :max="100000" :step="100" :controls="false" style="width: 150px" data-autofocus />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="容量上限">
          <el-input-number v-model="zipLimitsForm.bytesCapMb" :min="1" :max="4096" :step="50" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB</span>
        </el-form-item>
      </el-form>
      <div class="hint" style="margin-top: 8px">单次压缩 / 解压共用；超出即中止，防大目录占满内存。</div>
      <template #footer>
        <el-button @click="zipLimitsOpen = false">取消</el-button>
        <el-button type="primary" :loading="zipLimitsSaving" @click="submitZipLimits">保存</el-button>
      </template>
    </el-dialog>

    <!-- 上限设置（上传 / 下载分开、搜索扫描页数；0=不限） -->
    <el-dialog v-model="transferCapsOpen" title="上限设置" width="440px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto" size="small">
        <el-form-item label="上传文件数上限">
          <el-input-number v-model="transferCapsForm.uploadCap" :min="0" :max="100000" :step="1000" :controls="false" style="width: 150px" data-autofocus />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="下载文件数上限">
          <el-input-number v-model="transferCapsForm.downloadCap" :min="0" :max="100000" :step="1000" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">个</span>
        </el-form-item>
        <el-form-item label="搜索扫描页数上限">
          <el-input-number v-model="transferCapsForm.searchMaxPages" :min="0" :max="100000" :step="100" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">页</span>
        </el-form-item>
        <el-form-item label="在线预览大小上限">
          <el-input-number v-model="transferCapsForm.mediaLimitMb" :min="0" :max="4096" :step="50" :controls="false" style="width: 150px" />
          <span class="fs-ziplimits-unit">MB</span>
        </el-form-item>
        <el-form-item label="预览优先直链">
          <el-switch v-model="transferCapsForm.previewDirectLink" />
          <FormHint inline detail="默认开：云/远程音视频预览优先用访问域名直链（服务端 Range，免下载、秒开），直链需签名时在通道配置填「签名URL模板」，失效自动回退边下边播；关闭则云/远程一律边下边播。本地分享直链走本机服务，不受此开关影响、恒优先。" />
        </el-form-item>
      </el-form>
      <div class="hint" style="margin-top: 8px">上传目录展平 / 下载目录递归展开分别限制（默认：上传 10000、下载 0 不限制）；设为 0 表示不限制。云搜索扫描页数默认 500，0 = 不限。在线预览大小上限仅对「边下边播」生效，默认 100MB，0 = 不限。</div>
      <template #footer>
        <el-button @click="transferCapsOpen = false">取消</el-button>
        <el-button type="primary" :loading="transferCapsSaving" @click="submitTransferCaps">保存</el-button>
      </template>
    </el-dialog>

    <!-- §十一：收藏夹（跨通道直达） -->
    <FsFavoritesDrawer v-model:open="favDrawerOpen" :favorites="favoriteList" @goto="gotoFavorite" @remove="removeFavoriteById" />
  </div>
</template>

<style scoped>
.fs-page { display: flex; flex-direction: column; height: 100%; min-height: 0; outline: none; gap: 8px; padding: 10px 20px 14px; }
.fs-spacer { flex: 1; }
.hint { font-size: 12px; opacity: .6; line-height: 1.5; }

.fs-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* 不能给滚动容器垂直 padding：内容裁切在 padding box，顶缝会露出滚动的行（sticky 表头盖不到） */
.fs-list { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; position: relative; }
.fs-list.is-drag { outline: 2px dashed var(--el-color-primary); outline-offset: -4px; }

/* 列表表格：单一 grid 容器定义列轨道，表头与数据行用 subgrid 共享同一组轨道——
   修复操作列 max-content 被表头/数据行两个独立 grid 各自计算导致的列错位（用户 2026-11-18） */
.fs-table { display: grid; }
.fs-thead, .fs-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; padding: 0 10px; }
.fs-more { grid-column: 1 / -1; }
/* 表头不透明底色（用户反馈 2026-11-17：此前 opacity:.75 连背景一起半透明，滚动后与内容重叠）；muted 观感用文字色实现 */
.fs-thead { position: sticky; top: 0; background: var(--el-bg-color); z-index: 2; font-size: 12px; color: var(--el-text-color-secondary); height: 30px; border-bottom: 1px solid var(--el-border-color-lighter); }
.fs-row { height: 34px; cursor: default; border-bottom: 1px solid var(--el-border-color-extra-light); }
.fs-row:hover { background: var(--el-fill-color-light); background-clip: padding-box; }
.fs-row.selected { background: var(--el-color-primary-light-9); background-clip: padding-box; }
/* 首尾两列横向固定（用户 2026-11-18）：复选框贴左、操作贴右，水平滚动时保持可见可操作。
   用户明确要求固定列不要额外背景色——仅 sticky 定位，不加 background（2026-11-18 二次纠正） */
.fs-col-check, .fs-col-op { position: sticky; }
.fs-col-check { left: 0; z-index: 1; }
.fs-col-op { right: 0; z-index: 1; }
/* 表头本身 sticky（z2），其固定列更高一层（z3）盖过数据行固定列 */
.fs-thead .fs-col-check, .fs-thead .fs-col-op { z-index: 3; }
.fs-sortable { cursor: pointer; user-select: none; }
.fs-col-check { display: flex; align-items: center; }
.fs-col-name { display: flex; align-items: center; gap: 8px; min-width: 0; position: relative; padding-right: 24px; }
/* 分享状态标记：绿=自己的分享、橙=随父级树链接（用户 2026-11-19） */
.fs-share-mark { flex: none; font-size: 14px; cursor: pointer; transition: transform .12s; }
.fs-share-mark:hover { transform: scale(1.2); }
.fs-share-mark.is-own { color: var(--el-color-success); }
.fs-share-mark.is-inherited { color: var(--el-color-warning); }
.fs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-name.is-dir { color: var(--el-color-primary); font-weight: 500; }
/* 搜索结果所在目录 icon（searchDirHint，用户 2026-11-19）：文件名优先显示，目录改为名称后的
   小图标——hover tooltip 查看完整目录、点击复制目录；不再内联长路径灰字（会把文件名挤成省略号） */
.fs-dir-hint { flex: none; font-size: 13px; margin-left: 4px; color: var(--el-text-color-secondary); cursor: pointer; transition: color .12s, transform .12s; }
.fs-dir-hint:hover { color: var(--el-color-primary); transform: scale(1.15); }
.fs-icon.is-dir { color: var(--el-color-warning); }
.fs-col-size, .fs-col-time, .fs-col-mode { font-size: 12px; opacity: .7; }
/* 统计 loading：目录名旁旋转图标（成功色） */
.fs-usage-spin { color: var(--el-color-success); margin-left: 2px; font-size: 13px; }
/* 操作列：表头居中（用户 2026-11-17），行内按钮靠右且间距收紧 */
.fs-thead .fs-col-op { justify-content: center; }
.fs-col-op { display: flex; justify-content: flex-end; gap: 0; }
.fs-col-op .el-button + .el-button { margin-left: 2px; }
/* 操作列按钮紧凑化：EP small text 默认 padding 5px 11px，8 个按钮撑爆固定列宽——压缩到 0 4px */
.fs-col-op .el-button.is-text { padding: 0 4px; height: 22px; min-height: 0; white-space: nowrap; }
/* §十一 扩展列：备注左对齐可截断（hover 看 title）；owner 组为数字对（uid:gid） */
.fs-col-note, .fs-col-owner { font-size: 12px; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fs-more { text-align: center; padding: 8px 0; }
/* 搜索横幅不再 sticky（用户 2026-11-18：与 sticky 表头 top:0 叠住导致表格被遮）；随内容正常滚动即可 */
.fs-search-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; margin: 4px 8px; border-radius: 8px; background: var(--el-color-primary-light-9); font-size: 13px; }
.fs-search-info { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.fs-search-spin { color: var(--el-color-primary); animation: fs-search-rotate 1s linear infinite; }
@keyframes fs-search-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.fs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 10px; }
.fs-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px; border-radius: 8px; cursor: default; border: 1px solid transparent; }
.fs-cell:hover { background: var(--el-fill-color-light); }
.fs-cell.selected { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-5); }
.fs-cell-icon { font-size: 40px; color: var(--el-text-color-secondary); }
.fs-cell-icon.is-dir { color: var(--el-color-warning); }
/* 卡片视图分享角标：叠在类型图标右上角（用户 2026-11-19），带底色圆片避免与大图标混色 */
.fs-cell-icon-wrap { position: relative; display: inline-flex; line-height: 1; }
.fs-cell .fs-share-mark { position: absolute; top: -7px; right: -9px; font-size: 15px; padding: 2px; background: var(--el-bg-color); border-radius: 50%; box-shadow: 0 0 0 1px var(--el-border-color-lighter); }
/* 卡片视图收藏星标：类型图标左下角（用户 2026-11-19），未收藏 hover 才显、已收藏常显黄色实心星 */
.fs-cell .fs-cell-fav { position: absolute; bottom: -2px; right: -6px; font-size: 15px; padding: 2px; background: var(--el-bg-color); border-radius: 50%; box-shadow: 0 0 0 1px var(--el-border-color-lighter); color: var(--el-text-color-secondary); opacity: 0; transition: opacity .12s; cursor: pointer; }
.fs-cell:hover .fs-cell-fav, .fs-cell-fav.is-fav { opacity: 1; }
.fs-cell-fav.is-fav { color: var(--el-color-warning); }
.fs-cell-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
/* 搜索结果的目录提示单独一行（用户 2026-11-18：卡片式名称与目录分行显示） */
.fs-cell-meta { font-size: 11px; opacity: .6; }

.fs-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; text-align: center; }
.fs-empty-hint { font-size: 12px; opacity: .55; }
.fs-error { color: var(--el-color-danger); }

.fs-status { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .8; }
.fs-drop-mask { position: fixed; inset: 0; background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); z-index: 40; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.fs-drop-box { background: var(--el-bg-color); border: 2px dashed var(--el-color-primary); border-radius: 12px; padding: 24px 40px; font-size: 15px; }

.fs-delete-list { font-size: 12px; opacity: .7; max-height: 120px; overflow: auto; word-break: break-all; }
.fs-admin-tip { margin-bottom: 8px; }
/* 收藏星标（用户 2026-11-18 定版）：固定在名称列末尾同一位置；未收藏 hover 才显，已收藏常显黄色实心星 */
.fs-fav-toggle { position: absolute; right: 0; top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity .12s; padding: 0 2px; margin: 0; height: 22px; color: var(--el-text-color-secondary); }
.fs-row:hover .fs-fav-toggle, .fs-fav-toggle.is-fav { opacity: 1; }
.fs-fav-toggle.is-fav { color: var(--el-color-warning); }
.fs-move-body { display: flex; flex-direction: column; }

/* plans/10：传输队列抽屉已删，悬浮面板样式在 TransferPanel.vue 内自管 */

/* ── §十一：编辑权限 / 属性 / 转换 / 列设置 ── */
.fs-perm-grid { display: grid; grid-template-columns: 64px repeat(3, 1fr); justify-items: center; gap: 6px 0; align-items: center; }
.fs-perm-head { font-size: 12px; opacity: .6; }
.fs-perm-label { font-size: 13px; justify-self: start; }
/* EP .el-checkbox 默认 margin-right: 30px——居中时连 margin 一起算，勾选框整体偏左（2026-11-19 截图错位根因） */
.fs-perm-check { height: 22px; margin-right: 0; }
.fs-perm-octal { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
.fs-perm-octal-input { width: 110px; }
.fs-props { display: flex; flex-direction: column; gap: 8px; }
.fs-props-row { display: flex; gap: 12px; font-size: 13px; line-height: 1.5; }
.fs-props-k { flex: none; width: 72px; opacity: .6; }
.fs-props-v { flex: 1; min-width: 0; word-break: break-all; }
.fs-convert-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
/* 数字上限类弹框改用 el-form label-width="auto"（用户 2026-11-19 纠正：EP form 的 auto 自动等宽右对齐，不写死 px） */
/* 表单 label 宽度 auto + 不换行（用户铁律 2026-11-18：label 不允许固定宽度截断换行） */
.fs-convert-label { flex: none; width: auto; white-space: nowrap; font-size: 13px; opacity: .7; }
/* 重名确认：文件名限高滚动（单次多选几十个也能看全，不撑爆弹框） */
.fs-dup-list { max-height: 180px; overflow-y: auto; margin: 0; padding: 6px 10px 6px 24px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; font-size: 13px; line-height: 1.9; }
.fs-dup-list li { word-break: break-all; }
.fs-cols { display: flex; flex-direction: column; gap: 4px; }
.fs-ziplimits-unit { flex: none; margin-left: 10px; font-size: 13px; opacity: .7; }
</style>

<!-- 非 scoped：级联 popper 经 teleport 挂在 body，scoped 属性选择器打不到。
     根 label='' 是为守「子级回显 /a/b 不双斜杠」定版（pathLabels=['','a','b'].join('/')=/a/b）；
     代价是只选根时 join 结果为空 → 输入框/面板根节点都空。此处补显示，不改 label 机制。 -->
<style>
/* 面板首列（根列）首节点补 /：根列是第一个 .el-cascader-menu 且只含根节点；
   子级 menu 非 first-child 不受影响（不用 :empty——空文本节点会让它匹配失败） */
.fs-dir-cascader-popper .el-cascader-menu:first-child .el-cascader-node:first-child .el-cascader-node__label::before { content: '/'; }
/* 只选根时（手输框值为 /），级联输入框在占位层补 / 并隐藏空值+占位文字，视觉等同正常回显。
   注意 placeholder 由 ::placeholder 伪元素渲染，独立于此时的 input color，必须单独透明化，
   否则「/」会和「或从目录树选择…」叠在一起（用户 2026-11-19 反馈） */
.fs-move-cascader.is-root-selected .el-input__inner,
.fs-move-cascader.is-root-selected .el-input__inner::placeholder { color: transparent; }
.fs-move-cascader.is-root-selected .el-input__wrapper { position: relative; }
.fs-move-cascader.is-root-selected .el-input__wrapper::after {
  content: '/';
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--el-text-color-regular);
  font-size: 13px;
  pointer-events: none;
}
</style>
