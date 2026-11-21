<script setup lang="ts">
/**
 * 网格视图右键菜单（P4-4 自 FileExplorerPage 拆出；与行操作全集一致，Teleport 到 body 防被列表容器裁切）。
 * 注意：不能用裸 el-dropdown-menu——它 inject(DROPDOWN_INJECTION_KEY, undefined) 后解构即抛错，
 * 菜单项完全不渲染（用户 2026-11-18 截图「只出现小黑框」根因）。这里用原生 ul/li + 事件委托。
 */
import {
  Box,
  ChatDotRound,
  CollectionTag,
  CopyDocument,
  Delete,
  Download,
  EditPen,
  FolderOpened,
  InfoFilled,
  Link,
  Lock,
  MagicStick,
  Rank,
  TrendCharts,
} from '@element-plus/icons-vue'
import { isFsTextName, isFsZipName, type FsEntry } from '@sshk/shared'

defineProps<{
  /** 菜单状态（useFsContextMenu.ctxMenu）：{ x, y, entry } | null */
  menu: { x: number; y: number; entry: FsEntry } | null
  hasWritable: boolean
  hasMode: boolean
  /** 剪贴板是否有内容（目录行显示「粘贴」） */
  hasClipboard: boolean
  channelType: string | undefined
  isFavorited: (path: string) => boolean
  canShare: boolean
}>()

const emit = defineEmits<{
  /** 点击菜单项：父级取当前 entry 分发 rowMoreCommand（并关闭菜单） */
  (e: 'run', cmd: string): void
}>()

/** 事件委托：原生菜单从 li 的 data-command 读取命令（不走 el-dropdown 的 command 分发） */
function onClick(e: MouseEvent): void {
  const item = (e.target as HTMLElement | null)?.closest?.('.fs-ctx-menu li')
  if (!item || item.classList.contains('is-disabled')) return
  const cmd = item.getAttribute('data-command')
  if (cmd) emit('run', cmd)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="menu" class="fs-ctx" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click="onClick">
      <ul class="fs-ctx-menu">
        <li data-command="open"><el-icon><FolderOpened /></el-icon>打开</li>
        <li v-if="menu.entry.kind === 'file'" data-command="download"><el-icon><Download /></el-icon>下载</li>
        <li v-if="menu.entry.kind === 'file' && channelType !== 'local'" data-command="link"><el-icon><Link /></el-icon>链接</li>
        <li v-if="canShare" data-command="share"><el-icon><Link /></el-icon>分享链接</li>
        <li v-if="menu.entry.kind === 'dir' && hasClipboard && hasWritable" data-command="paste"><el-icon><CopyDocument /></el-icon>粘贴</li>
        <li v-if="hasWritable" data-command="copy" class="is-divided"><el-icon><CopyDocument /></el-icon>复制</li>
        <li v-if="hasWritable" data-command="move"><el-icon><Rank /></el-icon>移动</li>
        <li v-if="hasWritable" data-command="rename"><el-icon><EditPen /></el-icon>重命名</li>
        <li v-if="hasWritable" data-command="delete"><el-icon><Delete /></el-icon>删除</li>
        <!-- 信息组 -->
        <li data-command="props" class="is-divided"><el-icon><InfoFilled /></el-icon>属性</li>
        <li v-if="menu.entry.kind === 'dir'" data-command="usage"><el-icon><TrendCharts /></el-icon>统计</li>
        <li data-command="note"><el-icon><ChatDotRound /></el-icon>设置备注…</li>
        <li data-command="favorite"><el-icon><CollectionTag /></el-icon>{{ isFavorited(menu.entry.path) ? '取消收藏' : '添加收藏' }}</li>
        <li data-command="copypath"><el-icon><CopyDocument /></el-icon>复制路径</li>
        <!-- 工具组（按通道与文件类型实时显隐） -->
        <template v-if="channelType === 'local'">
          <li data-command="zip" class="is-divided"><el-icon><Box /></el-icon>压缩为 zip…</li>
          <li v-if="isFsZipName(menu.entry.name)" data-command="unzip"><el-icon><FolderOpened /></el-icon>解压到…</li>
        </template>
        <li v-if="menu.entry.kind === 'file' && isFsTextName(menu.entry.name)" data-command="convert" class="is-divided"><el-icon><MagicStick /></el-icon>转换编码 / 换行符…</li>
        <!-- 权限组 -->
        <li v-if="hasMode" data-command="perm" class="is-divided" :class="{ 'is-disabled': !menu.entry.mode }"><el-icon><Lock /></el-icon>编辑权限…</li>
      </ul>
    </div>
  </Teleport>
</template>

<style scoped>
/* 网格视图右键菜单（Teleport 到 body，fixed 定位；原生 ul/li 避免 el-dropdown 裸用注入崩溃） */
.fs-ctx { position: fixed; z-index: 3000; min-width: 156px; padding: 5px 0; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color-light); border-radius: 6px; box-shadow: var(--el-box-shadow-light); }
.fs-ctx-menu { list-style: none; margin: 0; padding: 0; }
.fs-ctx-menu li { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 14px; font-size: 13px; color: var(--el-text-color-regular); white-space: nowrap; cursor: pointer; }
.fs-ctx-menu li .el-icon { font-size: 14px; color: var(--el-text-color-secondary); }
.fs-ctx-menu li:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.fs-ctx-menu li:hover .el-icon { color: inherit; }
.fs-ctx-menu li.is-divided { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--el-border-color-lighter); }
.fs-ctx-menu li.is-disabled { color: var(--el-text-color-disabled); cursor: not-allowed; }
</style>
