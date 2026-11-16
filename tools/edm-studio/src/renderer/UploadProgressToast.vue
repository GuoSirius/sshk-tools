<script setup lang="ts">
/** E-T2：上传进度浮动条（右下角常驻，仅 uploadSession.active 时显示）。 */
import { computed } from 'vue'
import { uploadSession } from './upload-progress'

const currentName = computed(() => {
  const uploading = [...uploadSession.items].reverse().find((i) => i.status === 'uploading')
  return uploading?.name ?? (uploadSession.failed > 0 ? '部分失败' : '完成')
})
</script>

<template>
  <transition name="fade">
    <div v-if="uploadSession.active" class="upload-toast">
      <div class="toast-head">
        <span class="toast-title">上传进度 {{ uploadSession.succeeded + uploadSession.failed }}/{{ uploadSession.total }}</span>
        <span v-if="uploadSession.failed > 0" class="toast-fail">失败 {{ uploadSession.failed }}</span>
        <span class="toast-file">{{ currentName }}</span>
      </div>
      <el-progress
        :percentage="uploadSession.percent"
        :status="uploadSession.failed > 0 ? 'exception' : uploadSession.percent >= 100 ? 'success' : undefined"
        :stroke-width="8"
      />
      <div v-if="uploadSession.errors.length" class="toast-errors">
        <div v-for="(e, i) in uploadSession.errors.slice(0, 3)" :key="i">{{ e }}</div>
        <div v-if="uploadSession.errors.length > 3">…共 {{ uploadSession.errors.length }} 条</div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.upload-toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2000;
  width: 300px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
  padding: 10px 12px;
}
.toast-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.toast-title { font-weight: 600; }
.toast-fail { color: var(--el-color-danger); }
.toast-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .6; text-align: right; }
.toast-errors { margin-top: 6px; font-size: 11px; color: var(--el-color-danger); line-height: 1.6; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
