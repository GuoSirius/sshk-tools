<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { VueDraggable } from 'vue-draggable-plus'
import { Delete, Plus, Rank } from '@element-plus/icons-vue'
import {
  CONTAINER_TYPES, FIELD_TYPE_LABEL,
  retypeField, validateSchema,
  type FieldDef, type FieldType, type TableColumn,
} from '../sample-schema'

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

/** 类型清单/标签统一取 sample-schema 唯一真相源，新增类型只改一处（体检 #21） */
const TYPES = Object.keys(FIELD_TYPE_LABEL) as FieldType[]
const LABEL = FIELD_TYPE_LABEL
const CHOICE: FieldType[] = ['radio', 'checkbox', 'select', 'select-multi']
/** 需要「占位提示」的类型白名单（其余类型显示该属性无意义） */
const PLACEHOLDER_TYPES: FieldType[] = ['input', 'textarea', 'url', 'number', 'date', 'select', 'select-multi']

function typeLabel(f: FieldDef | undefined): string {
  return f ? LABEL[f.type] : ''
}

/** structuredClone 无法克隆 Vue reactive 代理（DataCloneError），FieldDef 均为纯 JSON，用 JSON 深拷贝 */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

const fields = ref<FieldDef[]>(deepClone(props.modelValue ?? []))
/** 稳定 uid（与业务 key 解耦）：key 可改、可拖拽，选中态不串行错位（体检 #6） */
const uid = ((): (() => number) => {
  let n = 0
  return () => ++n
})()
const rowUid = ref<number[]>(fields.value.map(() => uid()))
/** 单调递增计数器：删中间字段后新增不再生成重复 key（体检 #1） */
let keySeq = ((): number => {
  let max = 0
  for (const f of fields.value) {
    const m = /^field_(\d+)$/.exec(f.key)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
})()
const selectedUid = ref<number | null>(rowUid.value[0] ?? null)

// 父级外部重置（如 saveFields 丢弃非法字段后回写）时同步内部副本，避免脏字段"复活"（体检 #4）
watch(() => props.modelValue, (v) => {
  fields.value = deepClone(v ?? [])
  rowUid.value = fields.value.map(() => uid())
  selectedUid.value = rowUid.value[0] ?? null
})

function emitChange(): void {
  refreshErrors()
  emit('update:modelValue', deepClone(fields.value))
}

function addField(): void {
  if (props.readonly) return
  const n = ++keySeq
  fields.value.push({ key: `field_${n}`, label: `新字段 ${n}`, type: 'input' })
  rowUid.value.push(uid())
  selectedUid.value = rowUid.value[rowUid.value.length - 1]!
  emitChange()
}

/** 删除字段：危险操作二次确认（禁遮罩/禁 ESC，用户铁律） */
async function removeField(i: number): Promise<void> {
  if (props.readonly) return
  const f = fields.value[i]
  if (!f) return
  try {
    await ElMessageBox.confirm(`确认删除字段「${f.label || f.key}」？此操作不可撤销。`, '删除字段', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消',
      closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch {
    return
  }
  fields.value.splice(i, 1)
  const [gone] = rowUid.value.splice(i, 1)
  if (selectedUid.value === gone) selectedUid.value = rowUid.value[Math.min(i, rowUid.value.length - 1)] ?? null
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
  if (props.readonly) return
  const cur = fields.value[i]
  if (!cur) return
  fields.value[i] = retypeField(cur, t) // 按类型白名单重建，旧属性不残留（体检 #3）
  emitChange()
}
/** 拖拽结束：SortableJS 已重排 fields，uid 数组按相同 oldIndex→newIndex 移动，选中态不错位（体检 #6） */
function onDragEnd(evt: { oldIndex?: number | null; newIndex?: number | null }): void {
  const { oldIndex, newIndex } = evt
  if (oldIndex != null && newIndex != null && oldIndex !== newIndex) {
    const [moved] = rowUid.value.splice(oldIndex, 1)
    if (moved != null) rowUid.value.splice(newIndex, 0, moved)
  }
  emitChange()
}

function setItemFields(i: number, arr: FieldDef[]): void {
  if (props.readonly) return
  const cur = fields.value[i]
  if (!cur) return
  fields.value[i] = { ...cur, itemFields: arr }
  emitChange()
}

function nextOptionValue(i: number): string {
  const used = new Set((fields.value[i]?.options ?? []).map((o) => o.value))
  let n = (fields.value[i]?.options ?? []).length + 1
  while (used.has(`opt${n}`)) n++
  return `opt${n}`
}
function addOption(i: number): void {
  if (props.readonly) return
  const v = nextOptionValue(i)
  patchField(i, { options: [...(fields.value[i]?.options ?? []), { label: `选项${v}`, value: v }] })
}
function updateOption(i: number, oi: number, patch: { label?: string; value?: string }): void {
  if (props.readonly) return
  const opts = (fields.value[i]?.options ?? []).map((o, k) => (k === oi ? { ...o, ...patch } : o))
  patchField(i, { options: opts })
}
function removeOption(i: number, oi: number): void {
  if (props.readonly) return
  patchField(i, { options: (fields.value[i]?.options ?? []).filter((_, k) => k !== oi) })
}

// ── table 列定义编辑 ──
function nextColumnKey(i: number): string {
  const used = new Set((fields.value[i]?.columns ?? []).map((c) => c.key))
  let n = (fields.value[i]?.columns ?? []).length + 1
  while (used.has(`col${n}`)) n++
  return `col${n}`
}
function addColumn(i: number): void {
  if (props.readonly) return
  const key = nextColumnKey(i)
  patchField(i, { columns: [...(fields.value[i]?.columns ?? []), { key, label: key, cellType: 'input' }] })
}
function updateColumn(i: number, ci: number, patch: Partial<TableColumn>): void {
  if (props.readonly) return
  const cols = (fields.value[i]?.columns ?? []).map((c, k) => (k === ci ? { ...c, ...patch } : c))
  patchField(i, { columns: cols })
}
function removeColumn(i: number, ci: number): void {
  if (props.readonly) return
  patchField(i, { columns: (fields.value[i]?.columns ?? []).filter((_, k) => k !== ci) })
}

/** 与设计器左侧红字同源：用共享 validateSchema 的当前字段错误项（按 uid 索引映射） */
const schemaErrors = ref<Record<string, string>>({})
function refreshErrors(): void {
  schemaErrors.value = validateSchema(fields.value)
}
function errAt(i: number, prop: string): string | undefined {
  return schemaErrors.value[`${i}.${prop}`]
}
/** 统计子字段错误项数量（validateSchema 递归写入 `i.itemFields.<sub>.<prop>`） */
function hasNestedError(i: number): number {
  const prefix = `${i}.itemFields.`
  return Object.keys(schemaErrors.value).filter((k) => k.startsWith(prefix)).length
}
function selIndex(): number {
  return selectedUid.value == null ? -1 : rowUid.value.indexOf(selectedUid.value)
}
function selField(): FieldDef | undefined {
  const i = selIndex()
  return i >= 0 ? fields.value[i] : undefined
}
refreshErrors()
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
        @end="onDragEnd"
      >
        <div
          v-for="(f, index) in fields"
          :key="rowUid[index]"
          class="field-item"
          :class="{ active: selectedUid === rowUid[index], danger: errAt(index, 'key') }"
          @click="selectedUid = rowUid[index] ?? null"
        >
          <span class="handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
          <div class="meta">
            <div class="row1">
              <span class="type-badge" :data-t="f.type">{{ typeLabel(f) }}</span>
              <span class="lbl">{{ f.label || '(未命名)' }}</span>
              <span v-if="f.required" class="req">必填</span>
            </div>
            <div class="row2"><code>{{ f.key }}</code><span v-if="errAt(index, 'key')" class="err">{{ errAt(index, 'key') }}</span></div>
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
        <el-form label-width="auto" size="small" class="prop-form">
          <el-form-item label="key">
            <el-input clearable :model-value="selField()!.key" :disabled="readonly" @update:model-value="(v: string) => patchField(selIndex(), { key: v })" />
            <div v-if="errAt(selIndex(), 'key')" class="field-err">{{ errAt(selIndex(), 'key') }}</div>
          </el-form-item>
          <el-form-item label="标签">
            <el-input clearable :model-value="selField()!.label" :disabled="readonly" @update:model-value="(v: string) => patchField(selIndex(), { label: v })" />
            <div v-if="errAt(selIndex(), 'label')" class="field-err">{{ errAt(selIndex(), 'label') }}</div>
          </el-form-item>
          <el-form-item label="类型">
            <el-select :model-value="selField()!.type" :disabled="readonly" style="width: 100%" @update:model-value="(v: unknown) => onTypeChange(selIndex(), v as FieldType)">
              <el-option v-for="t in TYPES" :key="t" :value="t" :label="LABEL[t]" />
            </el-select>
          </el-form-item>
          <el-form-item label="分组名">
            <el-input clearable :model-value="selField()!.group ?? ''" :disabled="readonly" placeholder="相邻同名分组折叠为分隔" @update:model-value="(v: string) => patchField(selIndex(), { group: v || undefined })" />
          </el-form-item>
          <el-form-item label="必填">
            <el-switch :model-value="!!selField()!.required" :disabled="readonly" @update:model-value="(v: boolean) => patchField(selIndex(), { required: v })" />
          </el-form-item>
          <el-form-item v-if="PLACEHOLDER_TYPES.includes(selField()!.type)" label="占位提示">
            <el-input clearable :model-value="selField()!.placeholder ?? ''" :disabled="readonly" @update:model-value="(v: string) => patchField(selIndex(), { placeholder: v || undefined })" />
          </el-form-item>

          <template v-if="['input', 'textarea', 'richtext'].includes(selField()!.type)">
            <el-form-item label="最小长度">
              <el-input-number :model-value="selField()!.minLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { minLength: v || undefined })" />
            </el-form-item>
            <el-form-item label="最大长度">
              <el-input-number :model-value="selField()!.maxLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { maxLength: v || undefined })" />
              <div v-if="errAt(selIndex(), 'maxLength')" class="field-err">{{ errAt(selIndex(), 'maxLength') }}</div>
            </el-form-item>
          </template>
          <el-form-item v-if="selField()!.type === 'input'" label="正则校验">
            <el-input clearable :model-value="selField()!.pattern ?? ''" :disabled="readonly" placeholder="如 ^https?://" @update:model-value="(v: string) => patchField(selIndex(), { pattern: v || undefined })" />
          </el-form-item>

          <template v-if="selField()!.type === 'number'">
            <el-form-item label="最小值">
              <el-input-number :model-value="selField()!.min ?? undefined" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { min: v ?? undefined })" />
            </el-form-item>
            <el-form-item label="最大值">
              <el-input-number :model-value="selField()!.max ?? undefined" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { max: v ?? undefined })" />
            </el-form-item>
          </template>

          <template v-if="CHOICE.includes(selField()!.type)">
            <el-form-item label="选项">
              <div class="opts">
                <div v-for="(o, oi) in selField()!.options ?? []" :key="oi" class="opt-row">
                  <el-input clearable :model-value="o.label" size="small" placeholder="显示" :disabled="readonly" @update:model-value="(v: string) => updateOption(selIndex(), oi, { label: v })" />
                  <el-input clearable :model-value="o.value" size="small" placeholder="值" :disabled="readonly" @update:model-value="(v: string) => updateOption(selIndex(), oi, { value: v })" />
                  <el-button v-if="!readonly" size="small" type="danger" text :icon="Delete" @click="removeOption(selIndex(), oi)" />
                </div>
                <el-button v-if="!readonly" size="small" plain :icon="Plus" @click="addOption(selIndex())">添加选项</el-button>
              </div>
              <div v-if="errAt(selIndex(), 'options')" class="field-err">{{ errAt(selIndex(), 'options') }}</div>
            </el-form-item>
          </template>
          <el-form-item v-if="selField()!.type === 'checkbox'" label="最多选">
            <el-input-number :model-value="selField()!.maxChecked ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { maxChecked: v || undefined })" />
          </el-form-item>
          <el-form-item v-if="selField()!.type === 'select-multi'" label="最多选">
            <el-input-number :model-value="selField()!.maxSelected ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { maxSelected: v || undefined })" />
          </el-form-item>
          <el-form-item v-if="selField()!.type === 'image-list'" label="最多张">
            <el-input-number :model-value="selField()!.max ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { max: v || undefined })" />
          </el-form-item>

          <!-- 容器通用：list / repeater / table 的行数上下限 -->
          <template v-if="CONTAINER_TYPES.includes(selField()!.type)">
            <el-form-item label="最少行">
              <el-input-number :model-value="selField()!.minRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { minRows: v || undefined })" />
            </el-form-item>
            <el-form-item label="最多行">
              <el-input-number :model-value="selField()!.maxRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patchField(selIndex(), { maxRows: v || undefined })" />
              <div v-if="errAt(selIndex(), 'maxRows')" class="field-err">{{ errAt(selIndex(), 'maxRows') }}</div>
            </el-form-item>
          </template>

          <!-- list / repeater：嵌套子字段（用简单控件组合出产品卡/图文卡等复杂结构） -->
          <el-form-item v-if="['list', 'repeater'].includes(selField()!.type)" label="子字段">
            <div class="nested">
              <FieldSchemaDesigner
                :model-value="selField()!.itemFields ?? []"
                :readonly="readonly"
                nested
                @update:model-value="(v: FieldDef[]) => setItemFields(selIndex(), v)"
              />
            </div>
            <div v-if="hasNestedError(selIndex())" class="field-err">子字段有 {{ hasNestedError(selIndex()) }} 项待修正</div>
          </el-form-item>

          <!-- table：列定义（第一版平铺，不做合并单元格） -->
          <el-form-item v-if="selField()!.type === 'table'" label="表格列">
            <div class="opts">
              <div v-for="(c, ci) in selField()!.columns ?? []" :key="ci" class="col-row">
                <el-input clearable :model-value="c.key" size="small" placeholder="列 key" :disabled="readonly" @update:model-value="(v: string) => updateColumn(selIndex(), ci, { key: v })" />
                <el-input clearable :model-value="c.label" size="small" placeholder="列名" :disabled="readonly" @update:model-value="(v: string) => updateColumn(selIndex(), ci, { label: v })" />
                <el-select :model-value="c.cellType" size="small" style="width: 96px" :disabled="readonly" @update:model-value="(v: unknown) => updateColumn(selIndex(), ci, { cellType: v as TableColumn['cellType'] })">
                  <el-option value="input" label="文本" />
                  <el-option value="url" label="链接" />
                  <el-option value="richtext" label="富文本" />
                </el-select>
                <el-button v-if="!readonly" size="small" type="danger" text :icon="Delete" @click="removeColumn(selIndex(), ci)" />
              </div>
              <el-button v-if="!readonly" size="small" plain :icon="Plus" @click="addColumn(selIndex())">添加列</el-button>
            </div>
          </el-form-item>
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
.handle { cursor: grab; color: var(--el-text-color-secondary); flex: none; display: inline-flex; padding: 2px; border-radius: 4px; transition: background-color .15s, color .15s; }
.handle:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.handle:active { cursor: grabbing; }
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
.col-row { display: flex; gap: 6px; align-items: center; }
.col-row .el-input { flex: 1; min-width: 0; }
.field-err { color: var(--el-color-danger); font-size: 12px; line-height: 1.4; margin-top: 2px; }
.nested { border: 1px dashed var(--sshk-border, rgba(128,128,128,.3)); border-radius: 6px; padding: 6px; width: 100%; }
.prop-empty { opacity: .6; font-size: 13px; padding: 24px 0; text-align: center; }
.readonly .field-item { cursor: default; }
</style>
