<!--
  密钥输入弹框（用户 2026-11-17：密码框要带眼镜可查看原始值）。
  历史：曾用 ElMessageBox + 编程式 h(ElInput) 组合，构建版输入框宽度异常且极难排查
  （ElMessageBox 动态挂载的 message vnode 样式链路不受控）——2026-11-18 起改为
  自管 el-dialog 组件：与 ShareDialog 等业务弹框同一条渲染路径，dev / 构建表现一致。
  由 secret-prompt.ts 动态挂载调用，保持 promptSecret(title, tip, ...) => Promise<string|null> API 不变。
-->
<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
// 关键修复（2026-11-18）：本组件由 secret-prompt.ts 用独立 createApp 动态挂载，
// 该实例没有走 main.ts 的 app.use(ElementPlus) 全局注册——el-dialog/el-input/el-button
// 在模板里解析不到，弹框整个渲染不出来（打包版/点开关「界面没反应」的根因）。
// 显式 import 本地注册后，任何 app 实例下都能解析；样式走全局引入的 element-plus css，不受影响。
import { ElButton, ElDialog, ElInput } from 'element-plus'

const props = defineProps<{
  open: boolean
  title: string
  tip: string
  confirmText?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', secret: string): void
}>()

const secret = ref('')
const inputRef = ref<InstanceType<typeof import('element-plus')['ElInput']> | null>(null)

/** 弹框每次打开清空输入并聚焦（自动聚焦是 ElMessageBox 版本的原有体验） */
watch(() => props.open, async (open) => {
  if (!open) return
  secret.value = ''
  await nextTick()
  inputRef.value?.focus()
})

function submit(): void {
  emit('confirm', secret.value)
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="420px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <p class="secret-tip">{{ tip }}</p>
    <el-input
      ref="inputRef"
      v-model="secret"
      type="password"
      show-password
      :placeholder="placeholder ?? '访问密钥'"
      @keyup.enter="submit"
    />
    <template #footer>
      <el-button size="small" @click="close">取消</el-button>
      <el-button type="primary" size="small" @click="submit">{{ confirmText ?? '确定' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.secret-tip { margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: var(--el-text-color-regular); }
</style>
