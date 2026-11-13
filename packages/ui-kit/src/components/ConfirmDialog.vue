<script setup lang="ts">
/**
 * 危险操作统一二次确认（数据契约 §6）：展示影响数量与对象名。
 * v-model:open 控制显隐；确认时 emit confirm，取消时 emit cancel。
 */
import { computed } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  /** 影响对象名列表（截断展示前 5 个） */
  targets?: string[]
  /** 确认按钮文案 */
  confirmText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
  cancel: []
}>()

const preview = computed(() => (props.targets ?? []).slice(0, 5))
const restCount = computed(() => Math.max(0, (props.targets?.length ?? 0) - preview.value.length))

function close(action: 'confirm' | 'cancel'): void {
  emit('update:open', false)
  if (action === 'confirm') emit('confirm')
  else emit('cancel')
}
</script>

<template>
  <el-dialog
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :model-value="open"
    :title="title"
    width="420px"
    align-center
    @update:model-value="(v: boolean) => emit('update:open', v)"
    @close="close('cancel')"
  >
    <p v-if="targets" style="margin: 0 0 8px">将影响 {{ targets.length }} 项：</p>
    <ul v-if="targets" class="target-list">
      <li v-for="t in preview" :key="t">{{ t }}</li>
      <li v-if="restCount > 0" class="muted">…以及另外 {{ restCount }} 项</li>
    </ul>
    <template #footer>
      <el-button size="small" @click="close('cancel')">取消</el-button>
      <el-button size="small" :type="danger === false ? 'primary' : 'danger'" @click="close('confirm')">
        {{ confirmText ?? '确认' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.target-list {
  margin: 0;
  padding-left: 18px;
  max-height: 180px;
  overflow-y: auto;
}
.muted {
  opacity: 0.6;
}
</style>
