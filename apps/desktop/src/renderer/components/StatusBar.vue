<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 应用状态栏（P6-8 CR-42 终拆自 App.vue）：版本号 + 实时时钟（用户 2026-11-17：年月日 时分秒+星期）+ 就绪态。
 * 时钟/版本获取自包含，壳层不再持有 timer。
 */
const version = ref('0.1.0')
/** 状态栏实时时钟（用户 2026-11-17：年月日 时分秒+星期） */
const clockText = ref('')
let clockTimer: number | undefined
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
function tickClock(): void {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  clockText.value = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 星期${WEEK_CN[d.getDay()]}`
}

onMounted(() => {
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
  void window.api.app.version().then((v) => { version.value = v }).catch(() => { version.value = '0.1.0' })
})
onBeforeUnmount(() => { if (clockTimer !== undefined) window.clearInterval(clockTimer) })
</script>

<template>
  <footer class="status-bar">
    <span>v{{ version }}</span>
    <span class="app-spacer" />
    <span>{{ clockText }}</span>
    <span>就绪</span>
  </footer>
</template>
