<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AUTO_TOOL_ICON, DEFAULT_TOOL_ICON } from '@sshk/shared'
import { TOOL_ICONS } from '../discovery'

const props = withDefaults(defineProps<{
  /** 工具 id：icon=auto 时取该工具包自带的 assets/icon.svg */
  toolId?: string
  /** auto / default / http(s) URL / data:image URI */
  icon?: string
  name?: string
  size?: number
}>(), { size: 40 })

const failed = ref(false)

/** SVG 源码内联成 data URI，避免 Electron file:// 下相对资源路径失效 */
function svgDataUri(raw: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`
}

/**
 * 图标归属工具包自己：
 * - auto → 构建期自动发现的 tools/<id>/assets/icon.svg
 * - URL / data URI → 应用设置里配置的自定义图标
 * - 未配置、default、未知 key、非法协议、加载失败 → 系统默认四色图标
 */
const resolved = computed(() => {
  const src = props.icon?.trim() ?? ''
  if (!src || src === DEFAULT_TOOL_ICON) return ''
  if (src === AUTO_TOOL_ICON) {
    const raw = props.toolId ? TOOL_ICONS[props.toolId] : undefined
    return typeof raw === 'string' && raw.trim() ? svgDataUri(raw) : ''
  }
  if (/^https?:\/\//i.test(src) || /^data:image\/(svg\+xml|png|jpe?g|webp);/i.test(src)) return src
  return ''
})

watch(() => [props.icon, props.toolId], () => { failed.value = false })
</script>

<template>
  <span class="tool-icon" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="resolved && !failed" :src="resolved" :alt="name ?? '工具图标'" @error="failed = true" />
    <span v-else class="tool-icon-fallback" aria-hidden="true"><i /><i /><i /><i /></span>
  </span>
</template>
