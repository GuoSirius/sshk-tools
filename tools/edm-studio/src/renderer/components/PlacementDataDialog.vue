<template>
  <el-dialog
    :model-value="open"
    title="片段数据"
    width="560px"
    class="pd-dialog"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <!-- 双 tab（#200）：默认表单 tab 按 fields schema 填写，JSON tab 查看和编辑原始数据 -->
    <el-tabs v-model="activeTab" class="pd-tabs">
      <el-tab-pane v-if="fields.length" label="表单" name="form">
        <SampleForm v-model="formObj" :fields="fields" :show-ai-fill="false" />
      </el-tab-pane>
      <el-tab-pane label="JSON" name="json">
        <CodeEditor :model-value="jsonText" language="json" height="100%" @update:model-value="(v: string) => (jsonText = v)" />
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button @click="emit('update:open', false)">取消</el-button>
      <el-button type="primary" @click="doSave">保存并刷新预览</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CodeEditor } from '@sshk/code-editor'
import SampleForm from './SampleForm.vue'
import type { FieldDef } from '../sample-schema'

const props = defineProps<{
  open: boolean
  /** 片段 fields schema（meta.yaml fields:）；空 = 无表单能力，仅 JSON tab */
  fields: FieldDef[]
  /** 打开时的初始数据（外部拷贝传入，保存经 save 事件回传） */
  data: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'save', data: Record<string, unknown>): void
}>()

const activeTab = ref<'form' | 'json'>('form')
const formObj = ref<Record<string, unknown>>({})
const jsonText = ref('{}')

watch(
  () => props.open,
  (o) => {
    if (!o) return
    formObj.value = { ...props.data }
    jsonText.value = JSON.stringify(formObj.value, null, 2)
    activeTab.value = props.fields.length ? 'form' : 'json'
  },
)

/** 切 tab 双向同步：进 JSON 从表单序列化；回表单前反解析，失败留在 JSON tab 提示 */
watch(activeTab, (t, prev) => {
  if (prev === 'form' && t === 'json') jsonText.value = JSON.stringify({ ...formObj.value }, null, 2)
  if (prev === 'json' && t === 'form') {
    try {
      formObj.value = parseJson()
    } catch (err) {
      ElMessage.error(`JSON 解析失败，暂不能切回表单：${(err as Error).message}`)
      activeTab.value = 'json'
    }
  }
})

function parseJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(jsonText.value || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('顶层必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

function doSave(): void {
  let data: Record<string, unknown>
  if (activeTab.value === 'json') {
    try {
      data = parseJson()
    } catch (err) {
      ElMessage.error(`JSON 解析失败：${(err as Error).message}`)
      return
    }
  } else {
    data = { ...formObj.value }
  }
  emit('save', data)
}
</script>

<style scoped>
.pd-tabs { height: 100%; display: flex; flex-direction: column; }
.pd-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; padding-top: 4px; overflow: auto; }
.pd-tabs :deep(.el-tab-pane) { height: 100%; }
</style>

<!-- 非 scoped：append-to-body 后 dialog 节点 teleport 到 body，scoped 数据属性不在节点上；
     固定高度为全项目弹框硬性口径（2026-11-25 用户反馈：片段数据弹框高度也要固定） -->
<style>
.el-dialog.pd-dialog { height: min(70vh, 560px); display: flex; flex-direction: column; max-height: none; }
.el-dialog.pd-dialog .el-dialog__body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
</style>
