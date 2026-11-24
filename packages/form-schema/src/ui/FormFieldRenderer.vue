<script setup lang="ts">
import { computed, type Component } from 'vue'
import { CONTAINER_TYPES, validateModel, type FieldDef } from '../index'
import { RichTextEditor, type RichTextImageLibrary } from '@sshk/rich-text'
import { FormHint } from '@sshk/ui-kit'

/**
 * 通用递归表单渲染器（plans/13 B0 自 edm-studio SampleForm 拆壳重组）：
 * 按 fields schema 渲染 17 类控件，实时校验标红；list 行内递归渲染（depth 限 3 层防套娃）。
 * EDM 特有逻辑已外提，本组件可被任意宿主复用：
 * - AI 填充/润色等字段级行为经 `polishable` + `polish` 事件 / `toolbar` 插槽外提；
 * - 单图控件经 `imageField` 组件 prop 注入（缺省回落 URL 直填输入框）；
 * - 富文本上传桥接与 stateKey 前缀经 `imageLibrary` / `richStateKeyPrefix` 注入。
 */
const props = withDefaults(
  defineProps<{
    fields: FieldDef[]
    modelValue: Record<string, unknown>
    readonly?: boolean
    depth?: number
    /** 富文本图片库桥接（上传/图片库菜单）；不传则富文本降级为无上传编辑器 */
    imageLibrary?: RichTextImageLibrary
    /** 富文本位置记忆 stateKey 前缀（按 stateKey 分桶口径，2026-11-23 终审保留） */
    richStateKeyPrefix?: string
    /** 单图控件组件（v-model:modelValue + readonly；另转发 imageLibrary→library、imageStateKey→state-key）；
     *  缺省回落 URL 直填。共享实现见本包 ui/ImageField.vue */
    imageField?: Component
    /** 图片字段 FilePicker 设置持久化键（转发注入控件的 state-key，按宿主隔离如 edm::/forms::） */
    imageStateKey?: string
    /** richtext 字段下方渲染「AI 润色」入口并上抛 polish 事件（EDM 接线用） */
    polishable?: boolean
    /** 润色请求进行中（EDM aiLoading 透传，按钮 loading 态） */
    polishLoading?: boolean
  }>(),
  { readonly: false, depth: 0, imageLibrary: undefined, richStateKeyPrefix: '', imageField: undefined, imageStateKey: '', polishable: false, polishLoading: false },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, unknown>): void
  (e: 'polish', field: FieldDef): void
}>()

const errors = computed(() => validateModel(props.fields, props.modelValue))

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
function boolVal(key: string): boolean {
  return props.modelValue[key] === true
}
function numVal(key: string): number | undefined {
  const v = props.modelValue[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
/** table 单元格：行对象某列的值 → 字符串 */
function cellVal(row: Record<string, unknown>, colKey: string): string {
  const v = row?.[colKey]
  return v == null || typeof v === 'object' ? '' : String(v)
}
function cellErr(f: FieldDef, i: number, colKey: string): string | undefined {
  return errors.value[`${f.key}.${i}.${colKey}`]
}
function isContainer(f: FieldDef): boolean {
  return CONTAINER_TYPES.includes(f.type)
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

function onPolish(f: FieldDef): void {
  emit('polish', f)
}
</script>

<template>
  <div class="form-renderer">
    <!-- 顶层工具行插槽（EDM：AI 填充按钮；嵌套递归实例自然为空） -->
    <slot name="toolbar" />
    <template v-for="{ f, showGroup } in rows" :key="f.key">
      <div v-if="showGroup" class="group-divider"><span>{{ f.group }}</span></div>
      <div class="field-row" :class="{ 'has-error': rowErr(f) }">
        <div class="field-label">{{ f.label }}<span v-if="f.required" class="req">*</span></div>
        <div class="field-control">
          <!-- 文本类 -->
          <el-input clearable
            v-if="f.type === 'input'"
            :model-value="strVal(f.key)"
            :placeholder="f.placeholder"
            :disabled="readonly"
            @update:model-value="(v: string) => set(f.key, v)"
          />
          <!-- 链接 URL -->
          <el-input clearable
            v-else-if="f.type === 'url'"
            :model-value="strVal(f.key)"
            :placeholder="f.placeholder"
            :disabled="readonly"
            @update:model-value="(v: string) => set(f.key, v)"
          />
          <!-- 数字 -->
          <el-input-number
            v-else-if="f.type === 'number'"
            :model-value="numVal(f.key)"
            :min="f.min"
            :max="f.max"
            :disabled="readonly"
            controls-position="right"
            style="width: 100%"
            @update:model-value="(v: number | undefined) => set(f.key, v)"
          />
          <!-- 日期 -->
          <el-date-picker
            v-else-if="f.type === 'date'"
            :model-value="strVal(f.key) || undefined"
            type="date"
            value-format="YYYY-MM-DD"
            :placeholder="f.placeholder ?? '选择日期'"
            :disabled="readonly"
            style="width: 100%"
            @update:model-value="(v: unknown) => set(f.key, v)"
          />
          <!-- 颜色 -->
          <el-color-picker
            v-else-if="f.type === 'color'"
            :model-value="strVal(f.key) || undefined"
            :disabled="readonly"
            @update:model-value="(v: string | null) => set(f.key, v ?? '')"
          />
          <!-- 开关 -->
          <el-switch
            v-else-if="f.type === 'switch'"
            :model-value="boolVal(f.key)"
            :disabled="readonly"
            @update:model-value="(v: boolean) => set(f.key, v)"
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
          <template v-else-if="f.type === 'richtext'">
            <RichTextEditor
              :model-value="strVal(f.key)"
              :readonly="readonly"
              :image-library="imageLibrary"
              :state-key="`${richStateKeyPrefix}${f.key}`"
              @update:model-value="(v: string) => set(f.key, v)"
            />
            <!-- AI 润色入口经 polishable 开关（EDM 接线；通用宿主关闭） -->
            <div v-if="polishable && !readonly" class="polish-row">
              <FormHint inline>保持标签结构与链接不变，仅改写文字；预览确认后才写回</FormHint>
              <el-button size="small" text type="primary" :loading="polishLoading" @click="onPolish(f)">AI 润色</el-button>
            </div>
          </template>
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
          <!-- 单图（注入组件优先，缺省回落 URL 直填）；library/state-key 转发注入控件 -->
          <template v-else-if="f.type === 'image'">
            <component
              :is="imageField"
              v-if="imageField"
              :model-value="strVal(f.key)"
              :readonly="readonly"
              :library="imageLibrary"
              :state-key="imageStateKey"
              @update:model-value="(v: string) => set(f.key, v)"
            />
            <el-input v-else clearable
              :model-value="strVal(f.key)"
              placeholder="图片 URL"
              :disabled="readonly"
              @update:model-value="(v: string) => set(f.key, v)"
            />
          </template>
          <!-- 多图（max 限数量） -->
          <template v-else-if="f.type === 'image-list'">
            <div v-for="(img, i) in arrVal(f.key)" :key="i" class="image-row">
              <component
                :is="imageField"
                v-if="imageField"
                :model-value="String(img ?? '')"
                :readonly="readonly"
                :library="imageLibrary"
                :state-key="imageStateKey"
                @update:model-value="(v: string) => setArr(f.key, arrVal(f.key).map((x, j) => (j === i ? v : x)))"
              />
              <el-input v-else clearable
                :model-value="String(img ?? '')"
                placeholder="图片 URL"
                :disabled="readonly"
                @update:model-value="(v: string) => setArr(f.key, arrVal(f.key).map((x, j) => (j === i ? v : x)))"
              />
              <el-button size="small" type="danger" plain :disabled="readonly" @click="removeImage(f.key, i)">删</el-button>
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
          <!-- 重复块(repeater)：递归渲染行内字段；历史 list 已统一为 repeater -->
          <template v-else-if="f.type === 'repeater'">
            <FormHint v-if="!canNest(f) && (f.itemFields?.length ?? 0) > 0">嵌套层级已达上限（3 层）</FormHint>
            <div v-for="(row, i) in arrVal(f.key)" :key="i" class="list-row" :class="{ 'row-error': Object.keys(errors).some((k) => k.startsWith(`${f.key}.${i}.`)) }">
              <div class="list-row-head">
                <span>第 {{ i + 1 }} 行</span>
                <el-button size="small" type="danger" text :disabled="readonly" @click="removeRow(f.key, i)">删除行</el-button>
              </div>
              <FormFieldRenderer
                v-if="canNest(f)"
                :fields="f.itemFields ?? []"
                :model-value="(row as Record<string, unknown>) ?? {}"
                :readonly="readonly"
                :depth="(depth ?? 0) + 1"
                :image-library="imageLibrary"
                :rich-state-key-prefix="`${richStateKeyPrefix}${f.key}:${i}:`"
                :image-field="imageField"
                :image-state-key="imageStateKey"
                :polishable="polishable"
                :polish-loading="polishLoading"
                @update:model-value="(v: Record<string, unknown>) => updateRow(f.key, i, v)"
                @polish="onPolish"
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
          <!-- 数据表格（列定义 columns，第一版平铺，单元格类型 input/url/richtext） -->
          <template v-else-if="f.type === 'table'">
            <div v-for="(row, i) in arrVal(f.key)" :key="i" class="list-row" :class="{ 'row-error': Object.keys(errors).some((k) => k.startsWith(`${f.key}.${i}.`)) }">
              <div class="list-row-head">
                <span>第 {{ i + 1 }} 行</span>
                <el-button size="small" type="danger" text :disabled="readonly" @click="removeRow(f.key, i)">删除行</el-button>
              </div>
              <div v-for="c in f.columns ?? []" :key="c.key" class="table-cell">
                <div class="table-cell-label">{{ c.label }}<code>{{ c.key }}</code></div>
                <RichTextEditor
                  v-if="c.cellType === 'richtext'"
                  :model-value="cellVal((row as Record<string, unknown>) ?? {}, c.key)"
                  :readonly="readonly"
                  :image-library="imageLibrary"
                  :state-key="`${richStateKeyPrefix}${f.key}:${i}:${c.key}`"
                  @update:model-value="(v: string) => updateRow(f.key, i, { ...((row as Record<string, unknown>) ?? {}), [c.key]: v })"
                />
                <el-input v-else clearable
                  :model-value="cellVal((row as Record<string, unknown>) ?? {}, c.key)"
                  :placeholder="c.cellType === 'url' ? '链接地址' : ''"
                  :disabled="readonly"
                  @update:model-value="(v: string) => updateRow(f.key, i, { ...((row as Record<string, unknown>) ?? {}), [c.key]: v })"
                />
                <div v-if="cellErr(f, i, c.key)" class="error-text">{{ cellErr(f, i, c.key) }}</div>
              </div>
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
          <div v-if="strErr(f.key) && !isContainer(f)" class="error-text">{{ strErr(f.key) }}</div>
          <div v-if="rowErr(f) && isContainer(f)" class="error-text">{{ rowErr(f) }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.form-renderer { display: flex; flex-direction: column; gap: 10px; }
.group-divider { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; opacity: .75; margin-top: 4px; }
.group-divider::before, .group-divider::after { content: ''; flex: 1; height: 1px; background: rgba(128, 128, 128, 0.25); }
.field-row { display: flex; gap: 12px; align-items: flex-start; }
.field-row.has-error .field-label { color: var(--el-color-danger); }
.field-label { flex: none; width: 88px; text-align: right; font-size: 13px; line-height: 28px; }
.req { color: var(--el-color-danger); margin-left: 2px; }
.field-control { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.image-row { display: flex; gap: 8px; align-items: center; }
.list-row { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; padding: 8px 10px; }
.list-row.row-error { border-color: var(--el-color-danger); }
.list-row-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; opacity: .7; padding-bottom: 6px; }
.table-cell { display: flex; flex-direction: column; gap: 4px; }
.table-cell-label { font-size: 12px; opacity: .7; display: flex; gap: 6px; align-items: center; }
.table-cell-label code { font-size: 11px; opacity: .6; }
.error-text { font-size: 12px; color: var(--el-color-danger); }
.polish-row { display: flex; align-items: center; justify-content: end; gap: 8px; }
</style>
