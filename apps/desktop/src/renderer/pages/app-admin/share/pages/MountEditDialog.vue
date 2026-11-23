<script setup lang="ts">
/**
 * 挂载目录 · 新增/编辑弹框（列表化改造 #140）。
 * 表单层校验（控件下红字 tip，失败不发 IPC）+ 关闭脏数据二次确认；保存由父组件写 config（入库前再校验一次）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { FormGrid, FormHint } from '@sshk/ui-kit'
import { host } from '../host'

export interface MountForm { id: string; dir: string; alias: string; enabled: boolean; allowIndex: boolean; password: string }

const props = defineProps<{
  record: MountForm | null
  /** 其它挂载已占用的挂载点（别名去重） */
  takenAliases: string[]
}>()
/** save 携带 done 回调：父组件异步写盘成功后回传 true，弹框仅在成功时关闭（失败保留表单） */
const emit = defineEmits<{ save: [form: MountForm, done: (ok: boolean) => void] }>()
const visible = defineModel<boolean>('modelValue', { default: false })
const saving = ref(false)

function blank(): MountForm {
  return { id: window.crypto.randomUUID(), dir: '', alias: '', enabled: true, allowIndex: true, password: '' }
}
const form = ref<MountForm>(blank())
const errors = ref<Record<string, string>>({})
let baseline = ''

watch(visible, (open) => {
  if (!open) return
  form.value = props.record ? { ...props.record } : { ...blank(), alias: randomAlias() }
  errors.value = {}
  baseline = JSON.stringify(form.value)
})
function randomAlias(): string { return `dir-${Math.random().toString(36).slice(2, 8)}` }

function normAlias(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}
const isDirty = computed(() => JSON.stringify(form.value) !== baseline)

/** 表单层校验：直接显示控件下红字 tip，不发 IPC（双层铁律第一层） */
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.value.dir.trim()) e.dir = '请选择要挂载的本地目录'
  const a = normAlias(form.value.alias)
  if (!a) e.alias = '挂载点只能含小写字母/数字/连字符/下划线，且以字母或数字开头（≤32 字符）'
  else if (props.takenAliases.includes(a)) e.alias = `挂载点「${a}」已被其它挂载占用`
  errors.value = e
  return Object.keys(e).length === 0
}

async function pickDir(): Promise<void> {
  try {
    const dir = await host.os.pickDir(form.value.dir ? { defaultPath: form.value.dir } : undefined)
    if (dir) { form.value.dir = dir; errors.value.dir = '' }
  } catch { /* 取消保持原值 */ }
}
function onAliasInput(v: string): void { form.value.alias = v; errors.value.alias = '' }

function submit(): void {
  if (saving.value || !validate()) return
  const payload: MountForm = { ...form.value, alias: normAlias(form.value.alias), dir: form.value.dir.trim(), password: String(form.value.password ?? '') }
  saving.value = true
  emit('save', payload, (ok) => {
    saving.value = false
    if (!ok) return // 写盘失败：保留弹框与已填内容，由父组件已弹错误提示
    baseline = JSON.stringify(payload)
    visible.value = false
  })
}
async function doClose(): Promise<void> {
  if (isDirty.value) {
    try {
      await ElMessageBox.confirm('当前挂载尚未保存，关闭后将丢失修改。确定关闭吗？', '未保存提醒', {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
        confirmButtonText: '关闭', cancelButtonText: '继续编辑', distinguishCancelAndClose: true,
      })
    } catch { return }
  }
  visible.value = false
}
/** EP dialog afterLeave 会回发 false，setter 不能当关闭处理（内容编辑弹框同款口径） */
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
        <span>{{ record ? '编辑挂载目录' : '新增挂载目录' }}</span>
        <button class="dlg-close" aria-label="关闭" @click="doClose"><i class="fa-solid fa-xmark" /></button>
      </div>
    </template>
    <el-form size="small" label-width="auto" @submit.prevent>
      <FormGrid>
        <el-form-item class="full" label="本地目录">
          <div class="field-row">
            <el-input :model-value="form.dir" readonly placeholder="未选择目录" class="grow" />
            <el-button type="primary" plain data-autofocus @click="pickDir">选择目录</el-button>
          </div>
          <div v-if="errors.dir" class="field-tip">{{ errors.dir }}</div>
          <FormHint v-else inline detail="选择要对外分享的本地目录；保存后每条挂载生成一条固定链接">每个目录一条固定链接</FormHint>
        </el-form-item>
        <el-form-item label="挂载点">
          <el-input :model-value="form.alias" maxlength="32" placeholder="留空随机生成" @update:model-value="onAliasInput">
            <template #prepend>/</template>
          </el-input>
          <div v-if="errors.alias" class="field-tip">{{ errors.alias }}</div>
          <FormHint v-else inline detail="链接路径中的段落；留空保存时自动生成，填后即固定">小写字母/数字/连字符</FormHint>
        </el-form-item>
        <el-form-item label="访问密钥">
          <el-input v-model="form.password" show-password clearable placeholder="留空不设密钥">
            <template #prepend>ak</template>
          </el-input>
          <FormHint inline detail="填写后链接自动带 ?ak=，访客需该密钥才能访问">留空则公开可访问</FormHint>
        </el-form-item>
        <el-form-item label="允许访问目录">
          <div class="switch-row">
            <el-switch v-model="form.allowIndex" />
            <FormHint inline detail="关闭后访客只能访问具体文件链接，裸目录路径返回 404；分享弹框可按次覆盖">{{ form.allowIndex ? '允许' : '禁止' }}</FormHint>
          </div>
        </el-form-item>
        <el-form-item label="启用">
          <div class="switch-row">
            <el-switch v-model="form.enabled" />
            <FormHint inline detail="停用后该挂载的链接立即失效，重新启用即恢复">{{ form.enabled ? '启用中' : '已停用' }}</FormHint>
          </div>
        </el-form-item>
      </FormGrid>
    </el-form>
    <template #footer>
      <el-button size="small" :disabled="saving" @click="doClose">取消</el-button>
      <el-button size="small" type="primary" :loading="saving" :disabled="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-header { display: flex; align-items: center; justify-content: space-between; width: 100%; font-weight: 600; }
.dlg-close { background: none; border: 0; cursor: pointer; color: var(--el-text-color-secondary); font-size: 15px; padding: 0 2px; }
.grow { flex: 1; min-width: 0; }
.field-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.field-tip { color: var(--el-color-danger); font-size: 12px; line-height: 1.4; margin-top: 2px; }
.switch-row { display: flex; align-items: center; gap: 4px; }
.full { grid-column: 1 / -1; }
</style>
