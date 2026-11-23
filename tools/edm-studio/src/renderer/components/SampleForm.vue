<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { FormFieldRenderer } from '@sshk/form-schema/ui'
import type { FieldDef } from '../sample-schema'
import { CodeEditor } from '@sshk/code-editor'
import { useToolId } from '@sshk/ui-kit'
import ImageField from './ImageField.vue'
import { createImageLibrary } from '../upload.js'
import { llmApi, type LlmProviderLite } from '../tool-api'
import { generateSample, polishRichText, type ChatMessage } from '../ai-copy'

/**
 * 示例数据表单壳（plans/13 B0 拆壳后 EDM 侧只剩 EDM 特有逻辑）：
 * - 通用递归渲染移交 @sshk/form-schema/ui 的 FormFieldRenderer（17 类控件、行级校验标红）；
 * - 本组件经 props/slot/事件注入 EDM 特有部分：图片库桥接 + ImageField 单图控件、
 *   D-Q2 AI 文案助手（顶层「AI 填充」按钮 + richtext「AI 润色」，均为 diff 预览后写回）。
 */
const props = withDefaults(
  defineProps<{
    fields: FieldDef[]
    modelValue: Record<string, unknown>
    readonly?: boolean
  }>(),
  { readonly: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

/** 图片库桥接：富文本工具栏/粘贴上传/图片字段全走 FilePicker（请求级目标，不依赖工具级配置） */
const toolId = useToolId()
const library = computed(() => createImageLibrary(toolId.value))

function set(key: string, val: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: val })
}
function strVal(key: string): string {
  const v = props.modelValue[key]
  return v == null || Array.isArray(v) || typeof v === 'object' ? '' : String(v)
}

// ── D-Q2 AI 文案助手：无 Provider 降级 + diff 预览（接受 / 放弃） ──
const aiLoading = ref(false)
const noProvider = ref(true)
let provider: LlmProviderLite | null = null
async function ensureProvider(): Promise<boolean> {
  try {
    const list = await llmApi().providers()
    provider = list.find((p) => p.enabled) ?? null
  } catch {
    provider = null
  }
  noProvider.value = !provider
  return Boolean(provider)
}
onMounted(() => { void ensureProvider() })

async function chat(messages: ChatMessage[]): Promise<string> {
  if (!provider) throw new Error('请先在「模型管理」配置并启用模型 Provider')
  const res = await llmApi().chat(provider, messages)
  return res.content
}

/** AI 填充：schema → 示例数据 → diff 预览（接受 / 放弃） */
const aiPreview = ref<{ open: boolean; prev: string; next: Record<string, unknown> }>({ open: false, prev: '', next: {} })
async function aiFill(): Promise<void> {
  if (props.readonly) return
  if (!(await ensureProvider())) {
    ElMessage.warning('未配置可用模型 Provider：请先在「模型管理」配置并启用')
    return
  }
  aiLoading.value = true
  try {
    const next = await generateSample(props.fields, chat)
    aiPreview.value = { open: true, prev: JSON.stringify(props.modelValue, null, 2), next }
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}
function acceptAiFill(): void {
  emit('update:modelValue', { ...props.modelValue, ...aiPreview.value.next })
  aiPreview.value.open = false
  ElMessage.success('AI 示例数据已写入')
}

/** AI 润色：richtext 字段旧/新并排预览，接受才写回 */
const polish = ref<{ open: boolean; key: string; label: string; before: string; after: string }>({
  open: false, key: '', label: '', before: '', after: '',
})
async function aiPolish(f: FieldDef): Promise<void> {
  if (props.readonly) return
  const before = strVal(f.key)
  if (!before.trim()) {
    ElMessage.warning('该字段还没有内容，先填一些文字再润色')
    return
  }
  if (!(await ensureProvider())) {
    ElMessage.warning('未配置可用模型 Provider：请先在「模型管理」配置并启用')
    return
  }
  aiLoading.value = true
  try {
    const after = await polishRichText(before, chat)
    polish.value = { open: true, key: f.key, label: f.label, before, after }
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}
function acceptPolish(): void {
  set(polish.value.key, polish.value.after)
  polish.value.open = false
  ElMessage.success('润色结果已写回')
}
</script>

<template>
  <div class="sample-form">
    <FormFieldRenderer
      :fields="fields"
      :model-value="modelValue"
      :readonly="readonly"
      :image-library="library"
      rich-state-key-prefix="edm:"
      :image-field="ImageField"
      polishable
      :polish-loading="aiLoading"
      @update:model-value="(v: Record<string, unknown>) => emit('update:modelValue', v)"
      @polish="aiPolish"
    >
      <template #toolbar>
        <!-- D-Q2 顶层工具行：AI 填充按钮 -->
        <div v-if="fields.length > 0" class="ai-bar">
          <el-button
            size="small"
            type="primary"
            plain
            :loading="aiLoading"
            :disabled="readonly"
            :title="noProvider ? '未配置可用模型 Provider：请先在「模型管理」配置并启用' : '按字段 schema 生成一版示例数据（预览确认后写入）'"
            @click="aiFill"
          >
            AI 填充
          </el-button>
          <span class="ai-hint">{{ noProvider ? '需在「模型管理」配置并启用 Provider 后使用' : '按字段 schema 生成示例数据，预览确认后才写入' }}</span>
        </div>
      </template>
    </FormFieldRenderer>

    <!-- AI 填充 diff 预览：旧 / 新并排，接受才写入（放弃零改动） -->
    <el-dialog
      v-model="aiPreview.open"
      title="AI 示例数据预览（接受才写入，放弃零改动）"
      width="720px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="diff-grid">
        <div>
          <div class="diff-cap">当前数据</div>
          <CodeEditor :model-value="aiPreview.prev" language="json" height="240px" readonly />
        </div>
        <div>
          <div class="diff-cap">AI 生成</div>
          <CodeEditor :model-value="JSON.stringify(aiPreview.next, null, 2)" language="json" height="240px" readonly />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="aiPreview.open = false">放弃</el-button>
        <el-button size="small" type="primary" @click="acceptAiFill">接受并写入</el-button>
      </template>
    </el-dialog>

    <!-- AI 润色 diff 预览：旧 / 新并排，接受才写回 -->
    <el-dialog
      v-model="polish.open"
      :title="`AI 润色预览 · ${polish.label}（接受才写回）`"
      width="720px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="diff-grid">
        <div>
          <div class="diff-cap">润色前</div>
          <CodeEditor :model-value="polish.before" language="html" height="240px" readonly />
        </div>
        <div>
          <div class="diff-cap">润色后</div>
          <CodeEditor :model-value="polish.after" language="html" height="240px" readonly />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="polish.open = false">放弃</el-button>
        <el-button size="small" type="primary" @click="acceptPolish">接受并写回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sample-form { display: flex; flex-direction: column; gap: 10px; }
.ai-bar { display: flex; align-items: center; gap: 10px; }
.ai-hint { font-size: 12px; opacity: .7; }
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.diff-cap { font-size: 12px; opacity: .7; margin-bottom: 4px; }
</style>
