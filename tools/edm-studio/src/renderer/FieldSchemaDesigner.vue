<script setup lang="ts">
import { ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Delete, Plus, Rank } from '@element-plus/icons-vue'
import { type FieldDef, type FieldType } from './sample-schema'

/**
 * 字段设计器（R15 增强）：可视化逐项新增 / 编辑 meta.yaml 的 fields schema，
 * 替代手搓 YAML；支持拖拽排序。v-model 双向绑定 FieldDef[]。
 * 列表用 vue-draggable-plus（SortableJS 封装，Vue3 原生，拖拽更顺滑）；选项 / 嵌套子字段递归复用本组件。
 */
const props = withDefaults(
  defineProps<{ modelValue: FieldDef[]; readonly?: boolean; nested?: boolean }>(),
  { readonly: false, nested: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: FieldDef[]): void }>()

const TYPES: FieldType[] = [
  'input', 'textarea', 'richtext', 'radio', 'checkbox',
  'select', 'select-multi', 'image', 'image-list', 'list',
]
const LABEL: Record<FieldType, string> = {
  input: '单行文本', textarea: '多行文本', richtext: '富文本',
  radio: '单选', checkbox: '多选', select: '下拉单选', 'select-multi': '下拉多选',
  image: '单图', 'image-list': '多图', list: '动态列表',
}
const CHOICE: FieldType[] = ['radio', 'checkbox', 'select', 'select-multi']

function typeLabel(f: FieldDef | undefined): string {
  return f ? LABEL[f.type] : ''
}

const fields = ref<FieldDef[]>(structuredClone(props.modelValue ?? []))
const selected = ref<number>(-1)

function emitChange(): void {
  emit('update:modelValue', structuredClone(fields.value))
}

function addField(): void {
  if (props.readonly) return
  const n = fields.value.length + 1
  fields.value.push({ key: `field_${n}`, label: `新字段 ${n}`, type: 'input' })
  selected.value = fields.value.length - 1
  emitChange()
}
function removeField(i: number): void {
  if (props.readonly) return
  fields.value.splice(i, 1)
  if (selected.value >= fields.value.length) selected.value = fields.value.length - 1
  emitChange()
}
function patchField(i: number, patch: Partial<FieldDef>): void {
  if (props.readonly) return
  const cur = fields.value[i]
  if (!cur) return
  fields.value[i] = { ...cur, ...patch }
  emitChange()
}
function onTypeChange(i: number, t: FieldType): void {
  const patch: Partial<FieldDef> = { type: t }
  if (!CHOICE.includes(t)) patch.options = undefined
  if (t !== 'list') patch.itemFields = undefined
  patchField(i, patch)
}
function setItemFields(i: number, arr: FieldDef[]): void {
  if (props.readonly) return
  const cur = fields.value[i]
  if (!cur) return
  fields.value[i] = { ...cur, itemFields: arr }
  emitChange()
}

function addOption(i: number): void {
  const f = fields.value[i]
  if (!f) return
  const opts = [...(f.options ?? [])]
  opts.push({ label: `选项${opts.length + 1}`, value: `opt${opts.length + 1}` })
  patchField(i, { options: opts })
}
function updateOption(i: number, oi: number, patch: { label?: string; value?: string }): void {
  const f = fields.value[i]
  if (!f) return
  const opts = (f.options ?? []).map((o, k) => (k === oi ? { ...o, ...patch } : o))
  patchField(i, { options: opts })
}
function removeOption(i: number, oi: number): void {
  const f = fields.value[i]
  if (!f) return
  patchField(i, { options: (f.options ?? []).filter((_, k) => k !== oi) })
}

function keyError(i: number): string | undefined {
  const f = fields.value[i]
  if (!f) return undefined
  if (!f.key.trim()) return 'key 不能为空'
  if (fields.value.some((x, k) => k !== i && x.key === f.key)) return 'key 重复'
  return undefined
}
function selField(): FieldDef | undefined {
  return selected.value >= 0 ? fields.value[selected.value] : undefined
}
</script>

<template>
  <div class="designer" :class="{ readonly: readonly }">
    <!-- 左：字段列表 -->
    <div class="list-pane">
      <div class="list-head">
        <span>字段（{{ fields.length }}）</span>
        <el-button v-if="!readonly" size="small" type="primary" plain :icon="Plus" @click="addField">新增字段</el-button>
      </div>
      <VueDraggable
        v-if="fields.length"
        v-model="fields"
        :handle="'.handle'"
        :animation="180"
        :disabled="readonly"
        ghost-class="drag-ghost"
        class="list-body"
        @end="emitChange"
      >
        <div
          v-for="(f, index) in fields"
          :key="f.key"
          class="field-item"
          :class="{ active: selected === index, danger: keyError(index) }"
          @click="selected = index"
        >
          <span class="handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
          <div class="meta">
            <div class="row1">
              <span class="type-badge" :data-t="f.type">{{ typeLabel(f) }}</span>
              <span class="lbl">{{ f.label || '(未命名)' }}</span>
              <span v-if="f.required" class="req">必填</span>
            </div>
            <div class="row2"><code>{{ f.key }}</code><span v-if="keyError(index)" class="err">{{ keyError(index) }}</span></div>
          </div>
          <el-button
            v-if="!readonly"
            size="small"
            type="danger"
            text
            :icon="Delete"
            @click.stop="removeField(index)"
          />
        </div>
      </VueDraggable>
      <div v-else class="empty">暂无字段，点右上「新增字段」开始</div>
    </div>

    <!-- 右：属性面板 -->
    <div class="prop-pane">
      <template v-if="selField()">
        <div class="prop-title">字段属性</div>
        <el-form label-width="92px" size="small" class="prop-form">
          <el-form-item label="key">
            <el-input :model-value="selField()!.key" :disabled="readonly" @update:model-value="(v: string) => patchField(selected, { key: v })" />
          </el-form-item>
          <el-form-item label="标签">
            <el-input :model-value="selField()!.label" :disabled="readonly" @update:model-value="(v: string) => patchField(selected, { label: v })" />
          </el-form-item>
          <el-form-item label="类型">
            <el-select :model-value="selField()!.type" :disabled="readonly" style="width: 100%" @update:model-value="(v: unknown) => onTypeChange(selected, v as FieldType)">
              <el-option v-for="t in TYPES" :key="t" :value="t" :label="LABEL[t]" />
            </el-select>
          </el-form-item>
          <el-form-item label="必填">
            <el-switch :model-value="!!selField()!.required" :disabled="readonly" @update:model-value="(v: boolean) => patchField(selected, { required: v })" />
          </el-form-item>
          <el-form-item label="占位提示">
            <el-input :model-value="selField()!.placeholder ?? ''" :disabled="readonly" @update:model-value="(v: string) => patchField(selected, { placeholder: v || undefined })" />
          </el-form-item>

          <template v-if="['input', 'textarea', 'richtext'].includes(selField()!.type)">
            <el-form-item label="最小长度">
              <el-input-number :model-value="selField()!.minLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { minLength: v || undefined })" />
            </el-form-item>
            <el-form-item label="最大长度">
              <el-input-number :model-value="selField()!.maxLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { maxLength: v || undefined })" />
            </el-form-item>
          </template>
          <el-form-item v-if="selField()!.type === 'input'" label="正则校验">
            <el-input :model-value="selField()!.pattern ?? ''" :disabled="readonly" placeholder="如 ^https?://" @update:model-value="(v: string) => patchField(selected, { pattern: v || undefined })" />
          </el-form-item>

          <template v-if="CHOICE.includes(selField()!.type)">
            <el-form-item label="选项">
              <div class="opts">
                <div v-for="(o, oi) in selField()!.options ?? []" :key="oi" class="opt-row">
                  <el-input :model-value="o.label" size="small" placeholder="显示" :disabled="readonly" @update:model-value="(v: string) => updateOption(selected, oi, { label: v })" />
                  <el-input :model-value="o.value" size="small" placeholder="值" :disabled="readonly" @update:model-value="(v: string) => updateOption(selected, oi, { value: v })" />
                  <el-button v-if="!readonly" size="small" type="danger" text :icon="Delete" @click="removeOption(selected, oi)" />
                </div>
                <el-button v-if="!readonly" size="small" plain :icon="Plus" @click="addOption(selected)">添加选项</el-button>
              </div>
            </el-form-item>
          </template>
          <el-form-item v-if="selField()!.type === 'checkbox'" label="最多选">
            <el-input-number :model-value="selField()!.maxChecked ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { maxChecked: v || undefined })" />
          </el-form-item>
          <el-form-item v-if="selField()!.type === 'select-multi'" label="最多选">
            <el-input-number :model-value="selField()!.maxSelected ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { maxSelected: v || undefined })" />
          </el-form-item>
          <el-form-item v-if="selField()!.type === 'image-list'" label="最多张">
            <el-input-number :model-value="selField()!.max ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { max: v || undefined })" />
          </el-form-item>

          <template v-if="selField()!.type === 'list'">
            <el-form-item label="最少行">
              <el-input-number :model-value="selField()!.minRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { minRows: v || undefined })" />
            </el-form-item>
            <el-form-item label="最多行">
              <el-input-number :model-value="selField()!.maxRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selected, { maxRows: v || undefined })" />
            </el-form-item>
            <el-form-item label="子字段">
              <div class="nested">
                <FieldSchemaDesigner
                  :model-value="selField()!.itemFields ?? []"
                  :readonly="readonly"
                  nested
                  @update:model-value="(v: FieldDef[]) => setItemFields(selected, v)"
                />
              </div>
            </el-form-item>
          </template>
        </el-form>
      </template>
      <div v-else class="prop-empty">从左侧选择字段以编辑属性</div>
    </div>
  </div>
</template>

<style scoped>
.designer { display: flex; gap: 12px; flex: 1; min-height: 0; }
.list-pane { width: 300px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--sshk-border, rgba(128,128,128,.2)); border-radius: 6px; min-height: 0; }
.list-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--sshk-border, rgba(128,128,128,.2)); font-weight: 600; font-size: 13px; }
.list-body { flex: 1; overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.field-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--sshk-border, rgba(128,128,128,.2)); border-radius: 6px; background: var(--sshk-panel, #fff); cursor: pointer; }
.field-item.active { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 14%, transparent); }
.drag-ghost { opacity: .5; background: var(--el-color-primary-light-9, rgba(64, 158, 255, 0.08)); }
.field-item.danger { border-color: var(--el-color-danger); }
.handle { cursor: grab; color: var(--el-text-color-secondary); flex: none; display: inline-flex; }
.meta { flex: 1; min-width: 0; }
.row1 { display: flex; align-items: center; gap: 6px; }
.row2 { font-size: 12px; opacity: .65; display: flex; gap: 8px; align-items: center; }
.type-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, var(--el-color-primary) 16%, transparent); color: var(--el-color-primary); flex: none; }
.lbl { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req { font-size: 11px; color: var(--el-color-danger); flex: none; }
.err { color: var(--el-color-danger); }
.empty { padding: 24px 8px; text-align: center; opacity: .6; font-size: 12px; }

.prop-pane { flex: 1; min-width: 0; border: 1px solid var(--sshk-border, rgba(128,128,128,.2)); border-radius: 6px; padding: 10px 12px; overflow: auto; }
.prop-title { font-weight: 600; font-size: 13px; margin-bottom: 10px; }
.prop-form { max-width: 520px; }
.opts { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.opt-row { display: flex; gap: 6px; align-items: center; }
.nested { border: 1px dashed var(--sshk-border, rgba(128,128,128,.3)); border-radius: 6px; padding: 6px; }
.prop-empty { opacity: .6; font-size: 13px; padding: 24px 0; text-align: center; }
.readonly .field-item { cursor: default; }
</style>
