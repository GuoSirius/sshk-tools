<script setup lang="ts">
/**
 * 一步式新建弹框（品牌 / 族共用）：code + name 同屏，一次确认即完成。
 * 替代原先两次 ElMessageBox.prompt 串联（用户误以为要点两次才成功）。
 * state 由 useContentTree 域持有；校验错误文案由域内 confirmCodeName 填入（不发 IPC）。
 */
import { FormHint } from '@sshk/ui-kit'
import type { CodeNameState } from '../composables/useContentTree'

defineProps<{ state: CodeNameState }>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <el-dialog
    :model-value="state.visible"
    :title="state.title"
    width="460px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form label-width="auto" @submit.prevent>
      <el-form-item :label="state.codeHint || 'code'" required>
        <el-input v-model="state.code" data-autofocus placeholder="英文目录名，如 my-brand" />
        <FormHint>真实目录名；后续重命名会自动同步</FormHint>
        <div v-if="state.codeError" class="code-name-tip">{{ state.codeError }}</div>
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input v-model="state.name" placeholder="人可读显示名，如 双十一横幅" />
        <div v-if="state.nameError" class="code-name-tip">{{ state.nameError }}</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" @click="emit('confirm')">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.code-name-tip {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}
</style>
