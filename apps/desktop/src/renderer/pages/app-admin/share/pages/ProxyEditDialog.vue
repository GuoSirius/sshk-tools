<script setup lang="ts">
/**
 * 代理规则 · 新增/编辑弹框（列表化改造 #140）。
 * 表单层校验（控件下红字 tip，失败不发 IPC）+ 关闭脏数据二次确认；保存由父组件写 config（入库前再校验一次）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { FormGrid, FormHint } from '@sshk/ui-kit'

export interface ProxyForm { id: string; prefix: string; target: string; keepHost: boolean; enabled: boolean }

const props = defineProps<{
  record: ProxyForm | null
  takenPrefixes: string[]
}>()
const emit = defineEmits<{ save: [form: ProxyForm] }>()
const visible = defineModel<boolean>('modelValue', { default: false })

/** 属性值含 http:// 字面量会触发 vue-tsc v-for 作用域解析 bug，示例文案走常量绑定 */
const TARGET_PLACEHOLDER = '示例 http://192.168.1.10:8080/base，支持 https'

function blank(): ProxyForm { return { id: window.crypto.randomUUID(), prefix: '', target: '', keepHost: true, enabled: true } }
const form = ref<ProxyForm>(blank())
const errors = ref<Record<string, string>>({})
let baseline = ''

watch(visible, (open) => {
  if (!open) return
  form.value = props.record ? { ...props.record } : blank()
  errors.value = {}
  baseline = JSON.stringify(form.value)
})

function normAlias(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}
const isDirty = computed(() => JSON.stringify(form.value) !== baseline)

/** 表单层校验（双层铁律第一层）：控件下红字 tip，不写盘 */
function validate(): boolean {
  const e: Record<string, string> = {}
  const p = normAlias(form.value.prefix)
  if (!p) e.prefix = '路径前缀只能含小写字母/数字/连字符/下划线，且以字母或数字开头（≤32 字符）'
  else if (props.takenPrefixes.includes(p)) e.prefix = `路径前缀「${p}」已被其它代理占用`
  if (!form.value.target.trim()) e.target = '请填写目标地址（含 http:// 或 https://）'
  else if (!/^https?:\/\/\S+/i.test(form.value.target.trim())) e.target = '目标地址须以 http:// 或 https:// 开头'
  errors.value = e
  return Object.keys(e).length === 0
}
function onPrefixInput(v: string): void { form.value.prefix = v; errors.value.prefix = '' }
function onTargetInput(v: string): void { form.value.target = v; errors.value.target = '' }

function submit(): void {
  if (!validate()) return
  const payload: ProxyForm = { ...form.value, prefix: normAlias(form.value.prefix), target: form.value.target.trim() }
  emit('save', payload)
  baseline = JSON.stringify(payload)
  visible.value = false
}
async function doClose(): Promise<void> {
  if (isDirty.value) {
    try {
      await ElMessageBox.confirm('当前代理规则尚未保存，关闭后将丢失修改。确定关闭吗？', '未保存提醒', {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
        confirmButtonText: '关闭', cancelButtonText: '继续编辑', distinguishCancelAndClose: true,
      })
    } catch { return }
  }
  visible.value = false
}
const dialogVisible = computed({ get: () => visible.value, set: () => {} })
</script>

<template>
  <el-dialog
    :model-value="dialogVisible"
    width="560px" align-center :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false"
    @update:model-value="() => {}"
  >
    <template #header>
      <div class="dialog-header">
        <span>{{ record ? '编辑代理规则' : '新增代理规则' }}</span>
        <button class="dlg-close" aria-label="关闭" @click="doClose"><i class="fa-solid fa-xmark" /></button>
      </div>
    </template>
    <el-form size="small" label-width="auto" @submit.prevent>
      <FormGrid>
        <el-form-item label="路径前缀">
          <el-input :model-value="form.prefix" maxlength="32" placeholder="如 proxy-demo" @update:model-value="onPrefixInput">
            <template #prepend>/</template>
          </el-input>
          <div v-if="errors.prefix" class="field-tip">{{ errors.prefix }}</div>
          <FormHint v-else inline detail="访问 http://IP:端口/前缀/… 转发到目标；前缀不得与分享链接/挂载点重复">小写字母/数字/连字符</FormHint>
        </el-form-item>
        <el-form-item label="保留原始 Host">
          <div class="switch-row">
            <el-switch v-model="form.keepHost" />
            <span class="switch-hint">转发时沿用访客请求的 Host 头</span>
          </div>
        </el-form-item>
        <el-form-item class="full" label="目标地址">
          <el-input :model-value="form.target" :placeholder="TARGET_PLACEHOLDER" @update:model-value="onTargetInput" />
          <div v-if="errors.target" class="field-tip">{{ errors.target }}</div>
          <FormHint v-else inline detail="支持 http/https，全方法含 POST，响应流式回传">全方法转发 · 流式回传</FormHint>
        </el-form-item>
        <el-form-item class="full" label="启用">
          <div class="switch-row">
            <el-switch v-model="form.enabled" />
            <span class="switch-hint">停用后该代理入口立即失效，重新启用即恢复</span>
          </div>
        </el-form-item>
      </FormGrid>
    </el-form>
    <template #footer>
      <el-button size="small" @click="doClose">取消</el-button>
      <el-button size="small" type="primary" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-header { display: flex; align-items: center; justify-content: space-between; width: 100%; font-weight: 600; }
.dlg-close { background: none; border: 0; cursor: pointer; color: var(--el-text-color-secondary); font-size: 15px; padding: 0 2px; }
.field-tip { color: var(--el-color-danger); font-size: 12px; line-height: 1.4; margin-top: 2px; }
.switch-row { display: flex; align-items: center; gap: 8px; }
.switch-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.full { grid-column: 1 / -1; }
</style>
