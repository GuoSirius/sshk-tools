<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import edmSvg from '../assets/tools/edm.svg'
import badgeSvg from '../assets/tools/badge.svg'
import modelSvg from '../assets/tools/model.svg'

const props = withDefaults(defineProps<{
  /** 图标 key（edm/badge/model）、http(s) URL 或 data:image URI */
  icon?: string
  name?: string
  size?: number
}>(), { size: 40 })

const BUILTIN: Record<string, string> = {
  edm: edmSvg,
  badge: badgeSvg,
  model: modelSvg,
}
const failed = ref(false)

/** 未配置、未知 key、非法协议 → 空串，交由系统默认图标兜底 */
const resolved = computed(() => {
  const src = props.icon?.trim() ?? ''
  if (!src) return ''
  if (BUILTIN[src]) return BUILTIN[src]
  if (/^https?:\/\//i.test(src) || /^data:image\/(svg\+xml|png|jpe?g|webp);/i.test(src)) return src
  return ''
})
watch(() => props.icon, () => { failed.value = false })
</script>

<template>
  <span class="tool-icon" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="resolved && !failed" :src="resolved" :alt="name ?? '工具图标'" @error="failed = true" />
    <span v-else class="tool-icon-fallback" aria-hidden="true"><i /><i /><i /><i /></span>
  </span>
</template>
