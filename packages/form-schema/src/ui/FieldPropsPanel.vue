<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import { CONTAINER_TYPES, FIELD_CATALOG, FIELD_TYPE_LABEL, type FieldDef, type FieldType, type TableColumn } from '../index'

/**
 * 字段属性面板（plans/13 B0 自 FieldSchemaDesigner 拆出）：右侧选中字段的属性编辑。
 * 设计器（画布）持有字段数组与选中态，本面板只做单字段的 patch / retype / 解除控件引用。
 */
const props = withDefaults(
  defineProps<{
    field?: FieldDef
    /** 该字段在画布中的下标（错误映射键 `<index>.<prop>` 由设计器统一计算下发） */
    index: number
    errors: Record<string, string>
    readonly?: boolean
    /** 该字段若是复合控件引用，展示控件名；空 = 非引用节点 */
    controlLabel?: string
  }>(),
  { field: undefined, readonly: false, controlLabel: '' },
)
const emit = defineEmits<{
  (e: 'patch', patch: Partial<FieldDef>): void
  (e: 'retype', type: FieldType): void
}>()

const TYPES = FIELD_CATALOG.map((t) => t.type)
const LABEL = FIELD_TYPE_LABEL
const CHOICE: FieldType[] = ['radio', 'checkbox', 'select', 'select-multi']
/** 需要「占位提示」的类型白名单（其余类型显示该属性无意义） */
const PLACEHOLDER_TYPES: FieldType[] = ['input', 'textarea', 'url', 'number', 'date', 'select', 'select-multi']

/** 模板内非空视图：外层 v-if="field" 保证只在与非空时渲染；cf 保证 vue-tsc 类型收窄 */
const cf = computed<FieldDef>(() => props.field ?? ({ key: '', label: '', type: 'input' } as FieldDef))

function errAt(prop: string): string | undefined {
  return props.errors[`${props.index}.${prop}`]
}
/** 统计子字段错误项数量（validateSchema 递归写入 `<index>.itemFields.<sub>.<prop>`） */
const nestedErrorCount = computed(() => {
  const prefix = `${props.index}.itemFields.`
  return Object.keys(props.errors).filter((k) => k.startsWith(prefix)).length
})
function patch(p: Partial<FieldDef>): void {
  if (props.readonly) return
  emit('patch', p)
}
function onTypeChange(t: FieldType): void {
  if (props.readonly || !props.field) return
  emit('retype', t)
}

// ── 选项编辑（radio/checkbox/select*）──
function addOption(): void {
  const opts = props.field?.options ?? []
  const used = new Set(opts.map((o) => o.value))
  let n = opts.length + 1
  while (used.has(`opt${n}`)) n++
  patch({ options: [...opts, { label: `选项opt${n}`, value: `opt${n}` }] })
}
function updateOption(oi: number, p: { label?: string; value?: string }): void {
  const opts = (props.field?.options ?? []).map((o, k) => (k === oi ? { ...o, ...p } : o))
  patch({ options: opts })
}
function removeOption(oi: number): void {
  patch({ options: (props.field?.options ?? []).filter((_, k) => k !== oi) })
}

// ── table 列定义编辑 ──
function addColumn(): void {
  const cols = props.field?.columns ?? []
  const used = new Set(cols.map((c) => c.key))
  let n = cols.length + 1
  while (used.has(`col${n}`)) n++
  patch({ columns: [...cols, { key: `col${n}`, label: `col${n}`, cellType: 'input' }] })
}
function updateColumn(ci: number, p: Partial<TableColumn>): void {
  const cols = (props.field?.columns ?? []).map((c, k) => (k === ci ? { ...c, ...p } : c))
  patch({ columns: cols })
}
function removeColumn(ci: number): void {
  patch({ columns: (props.field?.columns ?? []).filter((_, k) => k !== ci) })
}

/** 解除复合控件引用：确认后回落为普通 repeater 容器（itemFields 清空，由用户自行填充） */
async function detachControl(): Promise<void> {
  if (props.readonly || !props.field?.controlKey) return
  try {
    await ElMessageBox.confirm(`解除对复合控件「${props.controlLabel || props.field.controlKey}」的引用？节点将回落为空容器。`, '解除引用', {
      type: 'warning', confirmButtonText: '解除', cancelButtonText: '取消',
      closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch {
    return
  }
  patch({ controlKey: undefined, itemFields: [] })
}

/** 供模板判断的类型快捷值 */
const type = (): FieldType => cf.value.type
</script>

<template>
  <template v-if="field">
    <div class="prop-title">
      字段属性
      <span v-if="cf.controlKey" class="ctl-badge">复合控件 · {{ controlLabel || cf.controlKey }}</span>
    </div>
    <el-form label-width="auto" size="small" class="prop-form">
      <el-form-item label="key">
        <el-input clearable :model-value="cf.key" :disabled="readonly" @update:model-value="(v: string) => patch({ key: v })" />
        <div v-if="errAt('key')" class="field-err">{{ errAt('key') }}</div>
      </el-form-item>
      <el-form-item label="标签">
        <el-input clearable :model-value="cf.label" :disabled="readonly" @update:model-value="(v: string) => patch({ label: v })" />
        <div v-if="errAt('label')" class="field-err">{{ errAt('label') }}</div>
      </el-form-item>
      <el-form-item label="类型">
        <el-select :model-value="cf.type" :disabled="readonly || !!cf.controlKey" style="width: 100%" @update:model-value="(v: unknown) => onTypeChange(v as FieldType)">
          <el-option v-for="t in TYPES" :key="t" :value="t" :label="LABEL[t]" />
        </el-select>
        <div v-if="cf.controlKey" class="ctl-actions">
          <el-button size="small" text type="warning" @click="detachControl">解除引用</el-button>
        </div>
      </el-form-item>
      <el-form-item label="分组名">
        <el-input clearable :model-value="cf.group ?? ''" :disabled="readonly" placeholder="相邻同名分组折叠为分隔" @update:model-value="(v: string) => patch({ group: v || undefined })" />
      </el-form-item>
      <el-form-item label="必填">
        <el-switch :model-value="!!cf.required" :disabled="readonly" @update:model-value="(v: boolean) => patch({ required: v })" />
      </el-form-item>
      <el-form-item v-if="PLACEHOLDER_TYPES.includes(type())" label="占位提示">
        <el-input clearable :model-value="cf.placeholder ?? ''" :disabled="readonly" @update:model-value="(v: string) => patch({ placeholder: v || undefined })" />
      </el-form-item>

      <template v-if="['input', 'textarea', 'richtext'].includes(type())">
        <el-form-item label="最小长度">
          <el-input-number :model-value="cf.minLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ minLength: v || undefined })" />
        </el-form-item>
        <el-form-item label="最大长度">
          <el-input-number :model-value="cf.maxLength ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ maxLength: v || undefined })" />
          <div v-if="errAt('maxLength')" class="field-err">{{ errAt('maxLength') }}</div>
        </el-form-item>
      </template>
      <el-form-item v-if="type() === 'input'" label="正则校验">
        <el-input clearable :model-value="cf.pattern ?? ''" :disabled="readonly" placeholder="如 ^https?://" @update:model-value="(v: string) => patch({ pattern: v || undefined })" />
      </el-form-item>

      <template v-if="type() === 'number'">
        <el-form-item label="最小值">
          <el-input-number :model-value="cf.min ?? undefined" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ min: v ?? undefined })" />
        </el-form-item>
        <el-form-item label="最大值">
          <el-input-number :model-value="cf.max ?? undefined" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ max: v ?? undefined })" />
        </el-form-item>
      </template>

      <template v-if="CHOICE.includes(type())">
        <el-form-item label="选项">
          <div class="opts">
            <div v-for="(o, oi) in cf.options ?? []" :key="oi" class="opt-row">
              <el-input clearable :model-value="o.label" size="small" placeholder="显示" :disabled="readonly" @update:model-value="(v: string) => updateOption(oi, { label: v })" />
              <el-input clearable :model-value="o.value" size="small" placeholder="值" :disabled="readonly" @update:model-value="(v: string) => updateOption(oi, { value: v })" />
              <el-button v-if="!readonly" size="small" type="danger" text :icon="Delete" @click="removeOption(oi)" />
            </div>
            <el-button v-if="!readonly" size="small" plain :icon="Plus" @click="addOption">添加选项</el-button>
          </div>
          <div v-if="errAt('options')" class="field-err">{{ errAt('options') }}</div>
        </el-form-item>
      </template>
      <el-form-item v-if="type() === 'checkbox'" label="最多选">
        <el-input-number :model-value="cf.maxChecked ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ maxChecked: v || undefined })" />
      </el-form-item>
      <el-form-item v-if="type() === 'select-multi'" label="最多选">
        <el-input-number :model-value="cf.maxSelected ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ maxSelected: v || undefined })" />
      </el-form-item>
      <el-form-item v-if="type() === 'image-list'" label="最多张">
        <el-input-number :model-value="cf.max ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ max: v || undefined })" />
      </el-form-item>

      <!-- 容器通用：list / repeater / table 的行数上下限 -->
      <template v-if="CONTAINER_TYPES.includes(type())">
        <el-form-item label="最少行">
          <el-input-number :model-value="cf.minRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ minRows: v || undefined })" />
        </el-form-item>
        <el-form-item label="最多行">
          <el-input-number :model-value="cf.maxRows ?? undefined" :min="1" :disabled="readonly" controls-position="right" @update:model-value="(v: number | undefined) => patch({ maxRows: v || undefined })" />
          <div v-if="errAt('maxRows')" class="field-err">{{ errAt('maxRows') }}</div>
        </el-form-item>
      </template>

      <!-- list / repeater：嵌套子字段（由设计器递归渲染，经 slot 交回画布） -->
      <el-form-item v-if="['list', 'repeater'].includes(type())" label="子字段">
        <div class="nested">
          <slot name="nested" />
        </div>
        <div v-if="nestedErrorCount > 0" class="field-err">子字段有 {{ nestedErrorCount }} 项待修正</div>
      </el-form-item>

      <!-- table：列定义（第一版平铺，不做合并单元格） -->
      <el-form-item v-if="type() === 'table'" label="表格列">
        <div class="opts">
          <div v-for="(c, ci) in cf.columns ?? []" :key="ci" class="col-row">
            <el-input clearable :model-value="c.key" size="small" placeholder="列 key" :disabled="readonly" @update:model-value="(v: string) => updateColumn(ci, { key: v })" />
            <el-input clearable :model-value="c.label" size="small" placeholder="列名" :disabled="readonly" @update:model-value="(v: string) => updateColumn(ci, { label: v })" />
            <el-select :model-value="c.cellType" size="small" style="width: 96px" :disabled="readonly" @update:model-value="(v: unknown) => updateColumn(ci, { cellType: v as TableColumn['cellType'] })">
              <el-option value="input" label="文本" />
              <el-option value="url" label="链接" />
              <el-option value="richtext" label="富文本" />
            </el-select>
            <el-button v-if="!readonly" size="small" type="danger" text :icon="Delete" @click="removeColumn(ci)" />
          </div>
          <el-button v-if="!readonly" size="small" plain :icon="Plus" @click="addColumn">添加列</el-button>
        </div>
      </el-form-item>
    </el-form>
  </template>
  <div v-else class="prop-empty">从左侧选择字段以编辑属性</div>
</template>

<style scoped>
.prop-title { font-weight: 600; font-size: 13px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.ctl-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, var(--el-color-warning) 16%, transparent); color: var(--el-color-warning); }
.ctl-actions { width: 100%; }
.prop-form { max-width: 520px; }
.opts { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.opt-row { display: flex; gap: 6px; align-items: center; }
.col-row { display: flex; gap: 6px; align-items: center; }
.col-row .el-input { flex: 1; min-width: 0; }
.field-err { color: var(--el-color-danger); font-size: 12px; line-height: 1.4; margin-top: 2px; }
.nested { border: 1px dashed var(--sshk-border, rgba(128,128,128,.3)); border-radius: 6px; padding: 6px; width: 100%; }
.prop-empty { opacity: .6; font-size: 13px; padding: 24px 0; text-align: center; }
</style>
