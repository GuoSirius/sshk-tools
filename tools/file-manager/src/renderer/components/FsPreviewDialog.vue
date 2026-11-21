<script setup lang="ts">
/**
 * 图片/PDF 预览弹框（P4-4 自 FileExplorerPage 拆出）：图片缩放 / PDF 走 Chromium 内置 viewer。
 * 行为契约（与原页面逐字一致）：PDF 的 Blob URL 由父级 onPreviewClose 释放（图片走 data URI 无需释放）；
 * 缩放按钮 0.2~5 倍、复位 1 倍；PDF 态不显示缩放按钮。
 */
const props = defineProps<{
  /** 预览状态（useFsMedia.preview）：{ open, name, src, pdfUrl, scale } */
  preview: { open: boolean; name: string; src: string; pdfUrl: string; scale: number }
}>()

const emit = defineEmits<{
  /** 关闭（X/ESC/关闭按钮统一出口；父级置 open=false 并释放 PDF Blob URL） */
  (e: 'close'): void
  /** 缩放（子级算好目标倍数，父级回写 preview.scale） */
  (e: 'scale', value: number): void
}>()

function zoom(delta: number): void {
  emit('scale', Math.max(0.2, Math.min(5, props.preview.scale + delta)))
}
</script>

<template>
  <el-dialog :model-value="preview.open" :title="preview.name" width="720px" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-preview-dialog" @update:model-value="emit('close')" @close="emit('close')">
    <div class="fs-preview-body">
      <iframe v-if="preview.pdfUrl" :src="preview.pdfUrl" class="fs-preview-pdf" title="PDF 预览" />
      <img v-else :src="preview.src" :style="{ transform: `scale(${preview.scale})` }" alt="preview" />
    </div>
    <template #footer>
      <template v-if="!preview.pdfUrl">
        <el-button size="small" type="primary" plain @click="zoom(-0.2)">缩小</el-button>
        <el-button size="small" type="primary" plain @click="emit('scale', 1)">复位</el-button>
        <el-button size="small" type="primary" plain @click="zoom(0.2)">放大</el-button>
      </template>
      <el-button size="small" @click="emit('close')">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fs-preview-body { display: flex; align-items: center; justify-content: center; min-height: 320px; overflow: auto; background: var(--el-fill-color-dark); border-radius: 8px; }
.fs-preview-body img { max-width: 100%; max-height: 60vh; transition: transform .15s; }
/* PDF：Chromium 内置 viewer，iframe 撑满弹框可视区 */
.fs-preview-body .fs-preview-pdf { width: 100%; height: 60vh; border: none; border-radius: 8px; background: var(--el-bg-color); }
</style>
