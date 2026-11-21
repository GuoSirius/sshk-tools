<script setup lang="ts">
/**
 * 「关于应用」轻弹框（P4-1 · 更多下拉三段之一）：
 * 运行环境四行（window.api.app.runtime() 与 应用管理 > 应用设置 > 关于应用 页同数据源、各自加载），
 * kv-line 风格沿用 theme.css 全局类；完整信息页在 应用管理 > 应用设置 > 关于应用（P4-3 页化）。
 * 禁遮罩禁 ESC：防误关口径。
 */
import { ref, watch } from 'vue'

defineOptions({ name: 'AboutDialog' })

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const runtime = ref<{ version: string; commit: string; electron: string; chrome: string; node: string } | null>(null)

// 每次打开现拉一次（轻 IPC），不常驻缓存
watch(() => props.modelValue, (open) => {
  if (!open) return
  void window.api.app.runtime().then((r) => { runtime.value = r }).catch(() => { /* 保持默认 */ })
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="关于应用"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <section class="settings-card">
      <div class="card-title">运行环境</div>
      <template v-if="runtime">
        <div class="kv-line"><span>版本</span><strong>v{{ runtime.version }}（{{ runtime.commit }}）</strong></div>
        <div class="kv-line"><span>Electron</span><span class="hint">{{ runtime.electron }}</span></div>
        <div class="kv-line"><span>Chrome</span><span class="hint">{{ runtime.chrome }}</span></div>
        <div class="kv-line"><span>Node.js</span><span class="hint">{{ runtime.node }}</span></div>
      </template>
      <div v-else class="hint">运行环境信息加载中…</div>
    </section>
    <div class="hint" style="margin-top: 10px">完整信息见 应用管理 &gt; 应用设置 &gt; 关于应用</div>
  </el-dialog>
</template>
