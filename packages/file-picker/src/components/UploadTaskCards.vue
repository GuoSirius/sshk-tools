<script setup lang="ts">
/**
 * 文件选择弹框 · 上传页专属卡片（P6-3 拆分）：拖拽上传卡 + 上传任务卡（进度/重试/删除）。
 * 与共享网格 PickerThumbGrid 同排渲染在同一 .thumb-grid（本组件为多根 fragment）。
 * 拖拽高亮态（dropActive）为本组件私有展示状态，不外泄。
 */
import { ref } from 'vue'
import { Document, Picture, UploadFilled } from '@element-plus/icons-vue'
import type { UploadTask } from '../composables/useUploadPool'
import { extOf } from '../format'

defineProps<{
  /** 图片模式：任务卡显示本地预览缩略图；文件模式：类型图标 */
  isImage: boolean
  /** 上传中/失败 + 刚完成仍在展示窗口内的任务 */
  tasks: UploadTask[]
  uploadInProgress: boolean
  /** 拖拽上传卡片主文案：与文件卡片同尺寸，只放短词；完整规则走 title 悬浮（2026-11-20 合并布局） */
  uploadHint: string
  /** 拖拽上传卡片悬浮说明：长说明不进卡片（行内只一两个词，长说明走悬浮提示） */
  uploadDropTip: string
  uploadMultiple: boolean
}>()

const emit = defineEmits<{
  (e: 'pick'): void
  (e: 'drop', event: DragEvent): void
  (e: 'retry', task: UploadTask): void
  (e: 'remove-task', task: UploadTask): void
}>()

/** 拖拽投放高亮态 */
const dropActive = ref(false)
</script>

<template>
  <!-- 拖拽上传卡并入网格：空态即一张「添加」卡，有文件后与文件卡同排连成片（2026-11-20 用户反馈） -->
  <div
    class="drop-cell"
    :class="{ busy: uploadInProgress, active: dropActive }"
    :title="uploadDropTip"
    @click="emit('pick')"
    @dragover.prevent="dropActive = true"
    @dragleave.prevent="dropActive = false"
    @drop.prevent="dropActive = false; emit('drop', $event)"
  >
    <el-icon class="drop-cell-icon" :size="28"><UploadFilled /></el-icon>
    <span class="drop-cell-main">{{ uploadHint }}</span>
    <span class="drop-cell-sub">{{ uploadMultiple ? '可多选' : '单个' }}</span>
  </div>
  <!-- 上传中/失败任务：卡片上叠进度/状态，卡片底部放重试与删除 -->
  <div
    v-for="task in tasks"
    :key="'task-' + task.id"
    class="thumb-cell task-cell"
    :class="'st-' + task.status"
    :title="task.status === 'failed' ? task.error : task.name"
  >
    <div class="task-thumb">
      <img
        v-if="isImage && task.previewUrl && !task.previewFailed"
        :src="task.previewUrl"
        :alt="task.name"
        @error="task.previewFailed = true"
      />
      <div v-else-if="!isImage" class="file-tile">
        <el-icon :size="26"><Document /></el-icon>
        <span class="file-ext">{{ extOf(task.name) || 'FILE' }}</span>
      </div>
      <span v-else class="task-thumb-ph" title="图片预览不可用">
        <el-icon :size="24"><Picture /></el-icon>
      </span>
      <span v-if="task.status === 'success'" class="task-thumb-state ok">✓</span>
      <span v-else-if="task.status === 'failed'" class="task-thumb-state err">!</span>
      <el-progress
        v-if="task.status !== 'failed'"
        class="task-thumb-progress"
        :percentage="task.status === 'success' ? 100 : task.percent"
        :status="task.status === 'success' ? 'success' : undefined"
        :stroke-width="4"
        :show-text="false"
      />
    </div>
    <div class="thumb-name">{{ task.name }}</div>
    <div class="task-meta">
      <span class="task-status" :class="'st-' + task.status">
        {{ task.status === 'uploading' ? `上传中 ${task.percent}%` : task.status === 'success' ? '上传完成' : '上传失败' }}
      </span>
    </div>
    <div class="task-ops">
      <el-button v-if="task.status === 'failed'" size="small" type="primary" link @click="emit('retry', task)">重试</el-button>
      <el-button size="small" type="danger" link @click="emit('remove-task', task)">删除</el-button>
    </div>
  </div>
</template>

<style scoped>
/* 任务卡与文件卡同为网格单元：基础 .thumb-cell 样式与 PickerThumbGrid 各自持有（scoped 隔离） */
.thumb-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  text-align: center;
}
/* 拖拽上传卡并入网格：与文件卡同尺寸，空态即一张「添加」卡（2026-11-20 用户反馈） */
.drop-cell {
  min-height: 118px;
  border: 1px dashed rgba(128, 128, 128, 0.45);
  border-radius: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; padding: 6px; text-align: center; cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.04) 0 6px, transparent 6px 12px);
}
.drop-cell:hover, .drop-cell.active { border-color: var(--el-color-primary); }
.drop-cell.active { background: rgba(64, 158, 255, 0.1); }
.drop-cell.busy { opacity: 0.6; cursor: wait; }
.drop-cell-icon { color: var(--el-color-primary); opacity: 0.75; }
.drop-cell-main { font-size: 12px; line-height: 1.3; }
.drop-cell-sub { font-size: 10px; opacity: 0.6; }
/* 上传中/失败任务卡片：与成功缩略图同网格，进度直接叠在图片上 */
.task-cell { border-color: var(--sshk-border, rgba(128, 128, 128, 0.3)); }
.task-cell.st-failed { border-color: var(--el-color-danger); }
.task-thumb { position: relative; width: 100%; height: 80px; border-radius: 4px; overflow: hidden; background: rgba(128, 128, 128, 0.1); }
.task-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.task-thumb-ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--el-text-color-placeholder); opacity: 0.4; }
.task-thumb-state { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; display: grid; place-items: center; font-size: 12px; color: #fff; border-radius: 50%; }
.task-thumb-state.ok { background: var(--el-color-success); }
.task-thumb-state.err { background: var(--el-color-danger); }
.task-thumb-progress { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 3px 3px; }
.task-meta { margin-top: 2px; }
.task-status { font-size: 10px; }
.task-status.st-uploading { color: var(--el-color-primary); }
.task-status.st-success { color: var(--el-color-success); }
.task-status.st-failed { color: var(--el-color-danger); }
.task-ops { display: flex; justify-content: center; gap: 4px; margin-top: 2px; }
.task-ops .el-button { padding: 2px 4px; height: auto; font-size: 11px; }
/* 任务卡复用网格文件卡的类型图标底（file-tile 在 PickerThumbGrid 有同款，此处独立成样式避免跨组件依赖） */
.file-tile {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
.file-ext { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; }
</style>
