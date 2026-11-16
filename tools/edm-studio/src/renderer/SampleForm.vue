<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { validateModel, type FieldDef } from './sample-schema'
import { RichTextEditor, type RichTextUploadHook } from '@sshk/rich-text'
import { CodeEditor } from '@sshk/code-editor'
import { useToolId } from '@sshk/ui-kit'
import ImageField from './ImageField.vue'
import { createImageUploader } from './upload.js'
import { llmApi, type LlmProviderLite } from './shared'
import { generateSample, polishRichText, type ChatMessage } from './ai-copy'

/**
 * 示例数据表单渲染器（R15）：按 fields schema 渲染 10 类控件，实时校验标红。
 * 递归：list 行内渲染子 SampleForm（depth 限 3 层防套娃）。
 * richtext 已接入 wangEditor（@wangeditor/editor core 直接驱动，绕开 editor-for-vue 的 Vue2 版本陷阱）。
 * image/image-list 已支持「上传 + 预览 + URL 直填」（ImageField）：B7 起走应用级上传通道并回填服务端 URL，
 * 通道未配置 / 上传失败时回退 dataURL，离线编辑不阻断。
 * richtext 的 onUploadImage 与 ImageField 共用工具侧同一个注入实现（C2 唯一注入点）。
 * D-Q2 AI 文案助手：顶层「AI 填充」（schema→示例数据，diff 预览后写入）+ richtext「AI 润色」（只改文字）。
 */
const props = withDefaults(
  defineProps<{
    fields: FieldDef[]
    modelValue: Record<string, unknown>
    readonly?: boolean
    depth?: number
  }>(),
  { readonly: false, depth: 0 },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

const errors = computed(() => validateModel(props.fields, props.modelValue))
/** 上传钩子按宿主注入的 toolId 生成，与 ImageField 共用同一实现（C2 唯一注入点） */
const toolId = useToolId()
const uploader = computed<RichTextUploadHook>(() => createImageUploader(toolId.value))

/** 分组分隔：group 与上一字段不同时插分隔条 */
const rows = computed(() => {
  let lastGroup = ''
  return props.fields.map((f) => {
    const showGroup = !!f.group && f.group !== lastGroup
    if (f.group) lastGroup = f.group
    return { f, showGroup }
  })
})

function set(key: string, val: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: val })
}

function strVal(key: string): string {
  const v = props.modelValue[key]
  return v == null || Array.isArray(v) || typeof v === 'object' ? '' : String(v)
}
function arrVal(key: string): unknown[] {
  const v = props.modelValue[key]
  return Array.isArray(v) ? v : []
}
function setArr(key: string, arr: unknown[]): void {
  set(key, arr)
}
function rowErr(f: FieldDef): string | undefined {
  if (errors.value[f.key]) return errors.value[f.key]
  return Object.keys(errors.value).some((k) => k.startsWith(`${f.key}.`)) ? '存在未通过校验的行' : undefined
}
function strErr(key: string): string | undefined {
  return errors.value[key]
}

function updateRow(key: string, index: number, row: Record<string, unknown>): void {
  const next = [...arrVal(key)]
  next[index] = row
  setArr(key, next)
}
function removeRow(key: string, index: number): void {
  setArr(key, arrVal(key).filter((_, i) => i !== index))
}
function addRow(f: FieldDef): void {
  if (f.maxRows && arrVal(f.key).length >= f.maxRows) return
  setArr(f.key, [...arrVal(f.key), {}])
}
function addImage(key: string): void {
  setArr(key, [...arrVal(key), ''])
}
function removeImage(key: string, index: number): void {
  setArr(key, arrVal(key).filter((_, i) => i !== index))
}

function canNest(f: FieldDef): boolean {
  return (props.depth ?? 0) < 2 && (f.itemFields?.length ?? 0) > 0
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
  if (!provider) throw new Error('请先在「模型控制台」配置并启用模型 Provider')
  const res = await llmApi().chat(provider, messages)
  return res.content
}

/** AI 填充：schema → 示例数据 → diff 预览（接受 / 放弃） */
const aiPreview = ref<{ open: boolean; prev: string; next: Record<string, unknown> }>({ open: false, prev: '', next: {} })
async function aiFill(): Promise<void> {
  if (props.readonly || props.depth !== 0) return
  if (!(await ensureProvider())) {
    ElMessage.warning('未配置可用模型 Provider：请先在「模型控制台」配置并启用')
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
    ElMessage.warning('未配置可用模型 Provider：请先在「模型控制台」配置并启用')
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
    <!-- D-Q2 顶层工具行：AI 填充（仅顶层渲染，嵌套行不重复出现） -->
    <div v-if="(depth ?? 0) === 0 && fields.length > 0" class="ai-bar">
      <el-button
        size="small"
        type="primary"
        plain
        :loading="aiLoading"
        :disabled="readonly"
        :title="noProvider ? '未配置可用模型 Provider：请先在「模型控制台」配置并启用' : '按字段 schema 生成一版示例数据（预览确认后写入）'"
        @click="aiFill"
      >
        AI 填充
      </el-button>
      <span class="ai-hint">{{ noProvider ? '需在「模型控制台」配置并启用 Provider 后使用' : '按字段 schema 生成示例数据，预览确认后才写入' }}</span>
    </div>
    <template v-for="{ f, showGroup } in rows" :key="f.key">
      <div v-if="showGroup" class="group-divider"><span>{{ f.group }}</span></div>
      <div class="field-row" :class="{ 'has-error': rowErr(f) }">
        <div class="field-label">{{ f.label }}<span v-if="f.required" class="req">*</span></div>
        <div class="field-control">
          <!-- 文本类 -->
          <el-input
            v-if="f.type === 'input'"
            :model-value="strVal(f.key)"
            :placeholder="f.placeholder"
            :disabled="readonly"
            @update:model-value="(v: string) => set(f.key, v)"
          />
          <el-input
            v-else-if="f.type === 'textarea'"
            :model-value="strVal(f.key)"
            type="textarea"
            :rows="3"
            :placeholder="f.placeholder"
            :disabled="readonly"
            @update:model-value="(v: string) => set(f.key, v)"
          />
          <RichTextEditor
            v-else-if="f.type === 'richtext'"
            :model-value="strVal(f.key)"
            :readonly="readonly"
            :on-upload-image="uploader"
            @update:model-value="(v: string) => set(f.key, v)"
          />
          <!-- D-Q2 富文本润色：字段下方轻量入口（只改文字，diff 预览后写回） -->
          <div v-if="f.type === 'richtext' && !readonly" class="ai-polish-row">
            <el-button size="small" text type="primary" :loading="aiLoading" @click="aiPolish(f)">AI 润色</el-button>
            <span class="ai-hint">保持标签结构与链接不变，仅改写文字；预览确认后才写回</span>
          </div>
          <!-- 单选 -->
          <el-radio-group
            v-else-if="f.type === 'radio'"
            :model-value="strVal(f.key)"
            :disabled="readonly"
            @update:model-value="(v: unknown) => set(f.key, v)"
          >
            <el-radio v-for="o in f.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
          <!-- 多选 -->
          <el-checkbox-group
            v-else-if="f.type === 'checkbox'"
            :model-value="arrVal(f.key)"
            :disabled="readonly"
            @update:model-value="(v: unknown[]) => setArr(f.key, v)"
          >
            <el-checkbox v-for="o in f.options ?? []" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
          </el-checkbox-group>
          <!-- 下拉单/多选 -->
          <el-select
            v-else-if="f.type === 'select' || f.type === 'select-multi'"
            :model-value="f.type === 'select' ? strVal(f.key) : arrVal(f.key)"
            :multiple="f.type === 'select-multi'"
            :placeholder="f.placeholder ?? '请选择'"
            clearable
            :disabled="readonly"
            style="width: 100%"
            @update:model-value="(v: unknown) => set(f.key, v)"
          >
            <el-option v-for="o in f.options ?? []" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
          <!-- 单图（上传 + 预览 + URL 直填） -->
          <template v-else-if="f.type === 'image'">
            <ImageField
              :model-value="strVal(f.key)"
              :readonly="readonly"
              @update:model-value="(v: string) => set(f.key, v)"
            />
          </template>
          <!-- 多图（max 限数量） -->
          <template v-else-if="f.type === 'image-list'">
            <div v-for="(img, i) in arrVal(f.key)" :key="i" class="image-row">
              <ImageField
                :model-value="String(img ?? '')"
                :readonly="readonly"
                @update:model-value="(v: string) => setArr(f.key, arrVal(f.key).map((x, j) => (j === i ? v : x)))"
              />
              <el-button type="danger" plain :disabled="readonly" @click="removeImage(f.key, i)">删</el-button>
            </div>
            <el-button
              size="small"
              type="primary"
              plain
              :disabled="readonly || (!!f.max && arrVal(f.key).length >= f.max)"
              @click="addImage(f.key)"
            >
              添加图片{{ f.max ? `（${arrVal(f.key).length}/${f.max}）` : '' }}
            </el-button>
          </template>
          <!-- 动态列表（递归渲染行内字段） -->
          <template v-else-if="f.type === 'list'">
            <div v-if="!canNest(f) && (f.itemFields?.length ?? 0) > 0" class="hint">嵌套层级已达上限（3 层）</div>
            <div v-for="(row, i) in arrVal(f.key)" :key="i" class="list-row" :class="{ 'row-error': Object.keys(errors).some((k) => k.startsWith(`${f.key}.${i}.`)) }">
              <div class="list-row-head">
                <span>第 {{ i + 1 }} 行</span>
                <el-button size="small" type="danger" text :disabled="readonly" @click="removeRow(f.key, i)">删除行</el-button>
              </div>
              <SampleForm
                v-if="canNest(f)"
                :fields="f.itemFields ?? []"
                :model-value="(row as Record<string, unknown>) ?? {}"
                :readonly="readonly"
                :depth="(depth ?? 0) + 1"
                @update:model-value="(v: Record<string, unknown>) => updateRow(f.key, i, v)"
              />
            </div>
            <el-button
              size="small"
              type="primary"
              plain
              :disabled="readonly || (!!f.maxRows && arrVal(f.key).length >= f.maxRows)"
              @click="addRow(f)"
            >
              添加行{{ f.maxRows ? `（${arrVal(f.key).length}/${f.maxRows}）` : '' }}
            </el-button>
          </template>
          <div v-if="strErr(f.key) && f.type !== 'list'" class="error-text">{{ strErr(f.key) }}</div>
          <div v-if="rowErr(f) && f.type === 'list'" class="error-text">{{ rowErr(f) }}</div>
        </div>
      </div>
    </template>

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
.group-divider { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; opacity: .75; margin-top: 4px; }
.group-divider::before, .group-divider::after { content: ''; flex: 1; height: 1px; background: rgba(128, 128, 128, 0.25); }
.field-row { display: flex; gap: 12px; align-items: flex-start; }
.field-row.has-error .field-label { color: var(--el-color-danger); }
.field-label { flex: none; width: 110px; text-align: right; font-size: 13px; line-height: 28px; }
.req { color: var(--el-color-danger); margin-left: 2px; }
.field-control { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.image-row { display: flex; gap: 8px; align-items: center; }
.thumb { flex: none; width: 44px; height: 44px; border-radius: 4px; border: 1px solid rgba(128, 128, 128, 0.25); }
.list-row { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; padding: 8px 10px; }
.list-row.row-error { border-color: var(--el-color-danger); }
.list-row-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; opacity: .7; padding-bottom: 6px; }
.error-text { font-size: 12px; color: var(--el-color-danger); }
.hint { font-size: 12px; opacity: .6; }

/* D-Q2 AI 文案助手 */
.ai-bar { display: flex; align-items: center; gap: 10px; }
.ai-hint { font-size: 12px; opacity: .6; }
.ai-polish-row { display: flex; align-items: center; gap: 8px; }
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.diff-cap { font-size: 12px; opacity: .7; margin-bottom: 4px; }
</style>
