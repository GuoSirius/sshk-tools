<script setup lang="ts">
/**
 * 文件选择弹框 · 缩略卡片网格（P6-3 拆分）：三个页签（上传/图库/已选择）共用的条目渲染。
 * 读码后真实结构=三 tab 共享同一网格（差异仅在角标与右上角按钮的条件分支），
 * 故拆为一个共享网格组件而非三份复制模板；上传页专属的拖拽卡/任务卡见 UploadTaskCards。
 * 布局 CSS 随组件走（.thumb-cell 系），父级 .thumb-grid（display:grid）仍在壳层。
 */
import { ElMessage } from 'element-plus'
// 图标约定（2026-11-17）：优先 @element-plus/icons-vue / FontAwesome，均无再用自定义 SVG
import { Close, Delete, Document, Link, Picture } from '@element-plus/icons-vue'
import type { PoolItem } from '../composables/useUploadPool'
import type { PickerTab } from '../composables/useDirPicker'
import { copyTextToClipboard } from '../clipboard'
import { extOf, formatSize } from '../format'

const props = defineProps<{
  /** 当前页签：决定角标（本次上传/来源作用域）与右上角按钮（移除已选 ✕ / 删除上传项 🗑） */
  tab: PickerTab
  /** 已渲染条目（分批渲染切片） */
  items: PoolItem[]
  /** 当前页签可见全集（大图预览 initial-index 取此下标） */
  visibleItems: PoolItem[]
  previewUrls: string[]
  /** 图片模式：缩略图 + 大图预览；文件模式：类型图标卡片 */
  isImage: boolean
  isSelected(item: PoolItem): boolean
  /** 预览 URL 解析钩子（rich-text 传 localres 显示形态转换；其他应用可不传） */
  resolveSrc(url: string): string
  /** 作用域中文标签（已选择 tab 卡片标注来源） */
  scopeLabel(scope: string): string
}>()

const emit = defineEmits<{
  (e: 'toggle', item: PoolItem): void
  (e: 'remove-key', key: string): void
  (e: 'remove-uploaded', item: PoolItem): void
}>()

/** 复制文件完整链接：优先 Clipboard API，失败回退 execCommand（file:// 等非安全上下文） */
async function copyLink(item: PoolItem): Promise<void> {
  const ok = await copyTextToClipboard(item.url)
  if (ok) ElMessage.success('链接已复制')
  else ElMessage.error('复制失败，请手动复制')
}
</script>

<template>
  <div
    v-for="item in items"
    :key="item.url"
    class="thumb-cell"
    :class="{ picked: props.isSelected(item) }"
  >
    <el-checkbox :model-value="props.isSelected(item)" class="thumb-check" @change="emit('toggle', item)" @click.stop />
    <!-- 图片模式：缩略图 + 大图预览；文件模式：类型图标卡片 -->
    <el-image
      v-if="isImage"
      :src="props.resolveSrc(item.url)"
      fit="cover"
      loading="lazy"
      class="thumb-img"
      :preview-src-list="previewUrls"
      :initial-index="visibleItems.indexOf(item)"
      :preview-teleported="true"
      @click.stop
    >
      <template #placeholder>
        <div class="img-placeholder" aria-hidden="true">
          <el-icon class="img-placeholder-icon" :size="26"><Picture /></el-icon>
        </div>
      </template>
      <template #error>
        <div class="img-fallback" title="图片加载失败">
          <svg class="img-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15.5 16 11 7 20" />
            <path d="M4 4 20 20" class="img-fallback-slash" />
          </svg>
          <span class="img-fallback-text">图片不可用</span>
        </div>
      </template>
    </el-image>
    <div v-else class="thumb-img file-tile" title="文件">
      <el-icon :size="30"><Document /></el-icon>
      <span class="file-ext">{{ extOf(item.name || item.key || '') || 'FILE' }}</span>
      <span v-if="item.size" class="file-size">{{ formatSize(item.size) }}</span>
    </div>
    <div class="thumb-name" :title="item.url">
      <span class="thumb-name-text">{{ item.name || item.key }}</span>
      <button
        type="button"
        class="copy-link"
        title="复制链接"
        @click.stop="copyLink(item)"
      >
        <el-icon :size="12"><Link /></el-icon>
      </button>
    </div>
    <span v-if="tab === 'selected'" class="thumb-badge" :title="props.scopeLabel(item.scope)">{{ props.scopeLabel(item.scope) }}</span>
    <span v-else-if="item.origin === 'upload'" class="thumb-badge">本次上传</span>
    <!-- 删除/移除改为右上角 icon 悬浮钮：删除(垃圾桶)=移出本次上传，移除(✕)=取消已选，图形区分避免歧义（2026-11-17 用户反馈） -->
    <button
      v-if="tab === 'selected'"
      type="button"
      class="thumb-del"
      title="移除已选"
      @click.stop="emit('remove-key', item.url)"
    >
      <el-icon :size="12"><Close /></el-icon>
    </button>
    <button
      v-else-if="item.origin === 'upload'"
      type="button"
      class="thumb-del"
      title="删除"
      @click.stop="emit('remove-uploaded', item)"
    >
      <el-icon :size="12"><Delete /></el-icon>
    </button>
  </div>
</template>

<style scoped>
.thumb-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  text-align: center;
}
.thumb-cell.picked { border-color: var(--el-color-primary); background: rgba(64, 158, 255, 0.08); }
/* 悬浮复选框：半透明暗色毛玻璃背板 + 白描边，避免纯白方块浮在深色/失败占位上突兀（明暗主题通用）。
   EP 的 .el-checkbox 默认 height:32px（theme.css 又把内芯定为 15px）——背板会上下多出灰色，
   必须让 wrapper 高度塌到内芯 + 2px padding（用户反馈 2026-11-17） */
.thumb-check {
  position: absolute; top: 5px; left: 5px; z-index: 2;
  height: auto;
  margin: 0; padding: 2px; line-height: 0;
  background: rgba(0, 0, 0, 0.34);
  border-radius: 5px;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.thumb-check :deep(.el-checkbox__inner) {
  width: 15px; height: 15px;
  background-color: transparent;
  border-color: rgba(255, 255, 255, 0.92);
  border-radius: 3px;
}
.thumb-check :deep(.el-checkbox__inner:hover) { border-color: var(--el-color-primary); }
.thumb-check.is-checked :deep(.el-checkbox__inner) {
  background-color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
.thumb-img { width: 100%; height: 80px; border-radius: 4px; display: block; cursor: zoom-in; }
/* 文件模式卡片：类型图标 + 扩展名 + 大小（无缩略图/无大图预览） */
.file-tile {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
.file-ext { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
.file-size { font-size: 10px; opacity: 0.7; }
/* 图片加载失败：统一柔和占位（替代 Element Plus 默认 FAILED 与生硬的「裂图」文案） */
.img-fallback {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px;
  color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
/* 图片尚未加载（懒加载未触发/加载中）：柔和淡图标占位，替代纯空白卡片 */
.img-placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.04) 0 6px, transparent 6px 12px);
}
.img-placeholder-icon { width: 26px; height: 26px; opacity: 0.4; }
.img-fallback-icon { width: 26px; height: 26px; opacity: 0.7; }
.img-fallback-slash { opacity: 0.45; }
.img-fallback-text { font-size: 11px; line-height: 1; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; display: flex; align-items: center; gap: 4px; min-width: 0; }
.thumb-name-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 复制链接 icon：悬浮缩略图时浮现，点击复制完整 URL（title 已带完整链接可悬停查看） */
.copy-link {
  flex: none; display: none; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: inherit; cursor: pointer;
}
.thumb-cell:hover .copy-link { display: inline-flex; opacity: 0.85; }
.thumb-cell:hover .thumb-name { opacity: 1; }
.copy-link:hover { background: color-mix(in srgb, var(--sshk-accent, #4f8cff) 22%, transparent); color: var(--sshk-accent, #4f8cff); opacity: 1; }
.thumb-badge { display: block; font-size: 10px; color: var(--el-color-primary); }
/* 删除/移除 icon：右上角悬浮小钮（替代文字按钮），毛玻璃暗底与左上复选框呼应，hover 红色填充 */
.thumb-del {
  position: absolute; top: 5px; right: 5px; z-index: 2;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(0, 0, 0, 0.34);
  color: var(--el-color-danger);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.thumb-del:hover { background: color-mix(in srgb, var(--el-color-danger) 30%, transparent); }
</style>
