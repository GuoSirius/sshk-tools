<script setup lang="ts">
/**
 * 音视频播放弹框（P4-4 自 FileExplorerPage 拆出）：直链(src=域名/分享链接) 或边下边播(src=localres://)。
 * 行为契约（与原页面逐字一致）：
 * - 播放来源 tag + 边下边播下载进度（直链无下载进度，服务端 Range）。
 * - 加载失败 onMediaError 交父级（直链失败自动回退边下边播）。
 * - 关闭清空 src/mediaKey/entry（父级 glue，避免串台与旧源重复 error）。
 */
import { computed } from 'vue'
import { fsFormatSize, type FsEntry } from '@sshk/shared'

export interface FsPlayerState {
  open: boolean
  name: string
  src: string
  video: boolean
  loading: boolean
  source: 'direct' | 'stream'
  entry: FsEntry | null
  mediaKey: string
  dlUploaded: number
  dlTotal: number
  dlDone: boolean
}

const props = defineProps<{
  player: FsPlayerState
  /** 在线播放上限文案（不限 / 100MB 等） */
  mediaLimitText: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'mediaError', event?: Event): void
}>()

const dlPercent = computed(() => {
  if (!props.player.dlTotal) return 0
  return Math.min(100, Math.round((props.player.dlUploaded / props.player.dlTotal) * 100))
})
</script>

<template>
  <el-dialog :model-value="player.open" :title="player.name" width="760px" top="6vh" :close-on-click-modal="false" :close-on-press-escape="false" class="fs-player-dialog" @update:model-value="emit('close')" @close="emit('close')">
    <div class="fs-player-body">
      <span v-if="player.loading && !player.src" class="hint">加载中…</span>
      <video v-else-if="player.video && player.src" :src="player.src" controls autoplay style="max-width: 100%; max-height: 58vh" @error="emit('mediaError', $event)" />
      <audio v-else-if="player.src" :src="player.src" controls autoplay style="width: 100%" @error="emit('mediaError', $event)" />
    </div>
    <!-- 播放来源 + 边下边播下载进度（直链无下载进度，服务端 Range） -->
    <div class="fs-player-status">
      <el-tag size="small" :type="player.source === 'direct' ? 'success' : 'primary'" effect="plain">
        {{ player.source === 'direct' ? '直链播放（免下载）' : '边下边播' }}
      </el-tag>
      <template v-if="player.source === 'stream' && player.dlTotal > 0">
        <el-progress :percentage="dlPercent" :stroke-width="6" style="flex: 1" :status="player.dlDone ? 'success' : undefined" />
        <span class="hint">{{ fsFormatSize(player.dlUploaded) }} / {{ fsFormatSize(player.dlTotal) }}</span>
      </template>
      <span v-else class="hint">{{ player.source === 'direct' ? '使用访问域名 / 分享链接，拖动进度条走服务端' : '正在准备下载…' }}</span>
    </div>
    <template #footer>
      <div class="hint">在线播放上限 {{ mediaLimitText }}（仅本地下载模式生效；可在「更多▾ → 上限设置」调整并切换「预览优先直链」，0=不限）</div>
    </template>
  </el-dialog>
</template>

<style scoped>
.fs-player-body { display: flex; align-items: center; justify-content: center; min-height: 260px; background: var(--el-fill-color-dark); border-radius: 8px; padding: 12px; }
.fs-player-status { display: flex; align-items: center; gap: 10px; margin-top: 10px; min-height: 24px; }
.fs-player-status .el-progress { min-width: 120px; }
.hint { font-size: 12px; opacity: .6; line-height: 1.5; }
</style>
