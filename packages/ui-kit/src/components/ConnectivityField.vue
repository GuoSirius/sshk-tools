<script setup lang="ts">
import { Connection } from '@element-plus/icons-vue'

/**
 * 连通性测试字段统一组件（CR-31 · P2-4 建库）：「测试连接」按钮 + 结果/提示文案。
 * 从 CloudProfileForm / RemoteProfileForm 逐字重复的连通性区块抽出。
 * 结果文案约定：以 ✓ 开头为成功（绿色），以 ✗ 开头为失败（红色），其余按中性提示展示。
 */
withDefaults(defineProps<{
  testing?: boolean
  /** 测试结果文案（空 = 展示默认提示） */
  result?: string
  /** 未测试时的默认提示 */
  hint?: string
  /** 按钮文案 */
  label?: string
}>(), {
  testing: false,
  result: '',
  hint: '验证配置是否正确，不写任何文件',
  label: '测试连接',
})

const emit = defineEmits<{ (e: 'test'): void }>()
</script>

<template>
  <div class="conn-field">
    <el-button type="primary" plain :icon="Connection" :loading="testing" @click="emit('test')">
      {{ label }}
    </el-button>
    <span v-if="result" class="conn-result" :class="{ 'is-error': result.startsWith('✗') }">{{ result }}</span>
    <span v-else class="conn-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.conn-field { display: flex; gap: 8px; align-items: center; width: 100%; flex-wrap: wrap; }
.conn-result { font-size: 12px; color: var(--el-color-success); word-break: break-all; }
.conn-result.is-error { color: var(--el-color-danger); }
.conn-hint { font-size: 12px; opacity: .6; }
</style>
