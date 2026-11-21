<script setup lang="ts">
/**
 * 收藏夹抽屉（§十一 跨通道直达，P4-4 自 FileExplorerPage 拆出）。
 * 行为契约（与原页面逐字一致）：前往/删除按钮；删除需父级二次确认（removeFavoriteById）。
 */
import { Document, Folder } from '@element-plus/icons-vue'
import type { FsFavorite } from '@sshk/shared'

defineProps<{
  favorites: FsFavorite[]
}>()

const emit = defineEmits<{
  (e: 'goto', f: FsFavorite): void
  (e: 'remove', f: FsFavorite): void
}>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <el-drawer v-model="open" title="收藏夹" size="380px" :close-on-click-modal="false" :close-on-press-escape="false">
    <div v-if="!favorites.length" class="fs-empty"><p>还没有收藏</p><p class="fs-empty-hint">选中文件/目录后在「更多 ▾」里添加收藏</p></div>
    <div v-else class="fs-fav-list">
      <div v-for="f in favorites" :key="f._id" class="fs-fav-item">
        <el-icon class="fs-icon" :class="{ 'is-dir': f.kind === 'dir' }"><component :is="f.kind === 'dir' ? Folder : Document" /></el-icon>
        <span class="fs-fav-name" :title="`${f.profileName ?? f.profileId}/${f.path}`">{{ f.name }}</span>
        <span class="fs-fav-meta">{{ f.profileName ?? f.profileId }} · {{ f.path }}</span>
        <span class="fs-spacer" />
        <el-button size="small" text type="primary" @click="emit('goto', f)">前往</el-button>
        <el-button size="small" text type="danger" @click="emit('remove', f)">删除</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.fs-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; text-align: center; }
.fs-empty-hint { font-size: 12px; opacity: .55; }
.fs-icon.is-dir { color: var(--el-color-warning); }
.fs-fav-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; height: 100%; }
.fs-fav-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.fs-fav-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
.fs-fav-meta { font-size: 12px; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-spacer { flex: 1; }
</style>
