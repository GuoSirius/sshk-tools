<script setup lang="ts">
/**
 * 设置备注弹框（§十一 确认后生效；多选批量同备注，P4-4 自 FileExplorerPage 拆出）。
 * 行为契约（与原页面逐字一致）：备注保存在本机应用数据，跨通道可用；重命名/移动后自动跟随。
 */
import type { FsEntry } from '@sshk/shared'

defineProps<{
  targets: FsEntry[]
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'submit'): void
}>()

const open = defineModel<boolean>('open', { default: false })
const input = defineModel<string>('input', { default: '' })
</script>

<template>
  <el-dialog v-model="open" :title="`设置备注${targets.length > 1 ? `（${targets.length} 项）` : ''}`" width="440px" :close-on-click-modal="false" :close-on-press-escape="false">
    <el-input clearable v-model="input" data-autofocus maxlength="200" placeholder="备注（留空清除；最多 200 字）" @keyup.enter="emit('submit')" />
    <div class="hint" style="margin-top: 8px">备注保存在本机应用数据，跨通道可用；重命名/移动后自动跟随。</div>
    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="emit('submit')">保存备注</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint { font-size: 12px; opacity: .6; line-height: 1.5; }
</style>
