<script setup lang="ts">
/** 所有时间展示统一走 @sshk/shared/time（北京时间，D22） */
import { computed } from 'vue'
import { format } from '@sshk/shared'

const props = withDefaults(
  defineProps<{
    value?: string | number
    /** 展示格式，默认 YYYY-MM-DD HH:mm:ss */
    pattern?: string
    placeholder?: string
  }>(),
  { pattern: 'YYYY-MM-DD HH:mm:ss', placeholder: '—' },
)

const display = computed(() => {
  if (props.value === undefined || props.value === null || props.value === '') return props.placeholder
  return format(props.value, props.pattern)
})
</script>

<template>
  <span class="time-text">{{ display }}</span>
</template>
