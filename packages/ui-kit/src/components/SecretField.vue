<script setup lang="ts">
import { ref } from 'vue'
import { Delete, View } from '@element-plus/icons-vue'
import FormHint from './FormHint.vue'

/**
 * 密钥字段统一组件（CR-31 · P2-4 建库）：password 输入 + 查看/回显 + 清除 三件套。
 * 从 CloudProfileForm / RemoteProfileForm 的逐字重复 combo 抽出（两处迁移后共用）。
 * 语义（不变）：输入框绑定「本次输入值」（空=保持不变）；「查看」经 reveal 回调从宿主
 * safeStorage 回显已存密钥；「清除」删除已存密钥。密钥明文永不落 settings.json。
 */
const value = defineModel<string>({ default: '' })

const props = withDefaults(defineProps<{
  /** 是否已存有密钥（决定 查看/清除 可用与 placeholder 口径） */
  hasSecret?: boolean
  placeholder?: string
  disabled?: boolean
}>(), {
  hasSecret: false,
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{
  (e: 'reveal'): void
  (e: 'clear'): void
}>()

/** show-password 模式下 EP 自带眼睛切换明文；「查看」按钮负责从宿主回显已存密钥 */
const focused = ref(false)
</script>

<template>
  <div class="secret-field">
    <el-input
      v-model="value"
      type="password"
      show-password
      clearable
      :disabled="disabled"
      :placeholder="placeholder || (hasSecret ? '已加密存储；留空保持不变，输入即替换' : '加密存储，可点「查看」回显 / 直接输入')"
      @focus="focused = true"
      @blur="focused = false"
    />
    <el-tooltip content="从本机凭据库回显已保存的密钥" placement="top">
      <el-button :icon="View" :disabled="!hasSecret" @click="emit('reveal')">查看</el-button>
    </el-tooltip>
    <el-button :icon="Delete" :disabled="!hasSecret" @click="emit('clear')">清除</el-button>
    <FormHint
      v-if="focused"
      inline
      detail="密钥只存本机 safeStorage（加密落盘），配置文件里只有存在与否的标记；输入框留空保存 = 保持原密钥不变。"
    />
  </div>
</template>

<style scoped>
.secret-field { display: flex; gap: 8px; align-items: center; width: 100%; flex-wrap: wrap; }
.secret-field :deep(.el-input) { flex: 1; min-width: 200px; }
</style>
