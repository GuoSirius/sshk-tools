<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { VueDraggable } from 'vue-draggable-plus'
import { Delete, Plus, Rank } from '@element-plus/icons-vue'
import {
  FIELD_TYPE_LABEL, retypeField, validateSchema,
  type FieldDef, type FieldType,
} from '../index'
import FieldPropsPanel from './FieldPropsPanel.vue'
import type { CompositeControlOption } from './types'

/**
 * 字段设计器画布（plans/13 B0 自 edm-studio FieldSchemaDesigner 重组）：可视化逐项新增/编辑/
 * 拖拽排序表单 fields schema，v-model 双向绑定 FieldDef[]；右侧属性面板拆至 FieldPropsPanel。
 * 列表用 vue-draggable-plus（SortableJS 封装）；嵌套子字段递归复用本组件。
 * 复合控件（阶段 C）：传入 controls 后出现「插入复合控件」下拉，插入 controlKey 占位节点。
 */
const props = withDefaults(
  defineProps<{
    modelValue: FieldDef[]
    readonly?: boolean
    nested?: boolean
    /** 可插入的复合控件清单（控件管理/表单管理按 controlsUsed 或全库下发） */
    controls?: CompositeControlOption[]
  }>(),
  { readonly: false, nested: false, controls: undefined },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: FieldDef[]): void }>()

const LABEL = FIELD_TYPE_LABEL

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
/** 画布根元素：新增行滚动定位的查询作用域（嵌套设计器 uid 各自计数，禁全局 querySelector） */
const rootEl = ref<HTMLElement | null>(null)

// 父级外部重置（如 saveFields 丢弃非法字段后回写）时同步内部副本，避免脏字段"复活"（体检 #4）。
// 选中态保持（用户 2026-11-24）：v-model 回显 echo 不再把选中重置到第一个——
// 按 key 定位原选中项（拖拽排序后仍跟得住）；key 正被编辑（旧 key 不在）且行数未变时按原下标保持；
// 字段真被删了/外部重置收缩了列表才回落第一个。
watch(() => props.modelValue, (v) => {
  const prevIdx = selIndex()
  const prevKey = prevIdx >= 0 ? fields.value[prevIdx]?.key ?? null : null
  const prevLen = fields.value.length
  fields.value = deepClone(v ?? [])
  rowUid.value = fields.value.map(() => uid())
  const byKey = prevKey != null ? fields.value.findIndex((f) => f.key === prevKey) : -1
  const keep = byKey >= 0 ? byKey
    : (fields.value.length === prevLen && prevIdx >= 0 && prevIdx < fields.value.length ? prevIdx : -1)
  selectedUid.value = keep >= 0 ? rowUid.value[keep]! : (rowUid.value[0] ?? null)
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
  scrollToSelected()
}

/** 插入复合控件引用占位节点：type 固定 repeater，渲染/校验前经 expandFields 展开 */
function insertControl(c: CompositeControlOption): void {
  if (props.readonly) return
  const n = ++keySeq
  fields.value.push({ key: `ctrl_${n}`, label: c.label, type: 'repeater', controlKey: c.key })
  rowUid.value.push(uid())
  selectedUid.value = rowUid.value[rowUid.value.length - 1]!
  emitChange()
  scrollToSelected()
}

/** 新增/插入后自动滚动到新行（用户 2026-11-24）：selectedUid 已指向新行，nextTick 等 DOM
 *  渲染后在本设计器作用域内按 uid 定位（data-fuid；嵌套设计器 uid 各自计数可能撞号，
 *  必须限根元素内查询），block:'nearest' 只滚必要的最小距离 */
function scrollToSelected(): void {
  const u = selectedUid.value
  if (u == null) return
  void nextTick(() => {
    rootEl.value?.querySelector(`[data-fuid="${u}"]`)?.scrollIntoView({ block: 'nearest' })
  })
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

/** 与设计器左侧红字同源：用共享 validateSchema 的当前字段错误项（按 uid 索引映射） */
const schemaErrors = ref<Record<string, string>>({})
function refreshErrors(): void {
  schemaErrors.value = validateSchema(fields.value)
}
function errAt(i: number, prop: string): string | undefined {
  return schemaErrors.value[`${i}.${prop}`]
}
function selIndex(): number {
  return selectedUid.value == null ? -1 : rowUid.value.indexOf(selectedUid.value)
}
const selField = computed<FieldDef | undefined>(() => {
  const i = selIndex()
  return i >= 0 ? fields.value[i] : undefined
})
refreshErrors()
</script>

<template>
  <div ref="rootEl" class="designer" :class="{ readonly: readonly }">
    <!-- 左：字段列表（画布） -->
    <div class="list-pane">
      <div class="list-head">
        <span>字段（{{ fields.length }}）</span>
        <div class="head-actions">
          <el-dropdown v-if="controls?.length && !readonly" trigger="click" @command="insertControl">
            <el-button size="small" plain>复合控件</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="c in controls" :key="c.key" :command="c">{{ c.label }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button v-if="!readonly" size="small" type="primary" plain :icon="Plus" @click="addField">新增字段</el-button>
        </div>
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
          :data-fuid="rowUid[index]"
          :class="{ active: selectedUid === rowUid[index], danger: errAt(index, 'key') }"
          @click="selectedUid = rowUid[index] ?? null"
        >
          <span class="handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
          <div class="meta">
            <div class="row1">
              <span class="type-badge" :data-t="f.type">{{ f.controlKey ? '复合' : LABEL[f.type] }}</span>
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

    <!-- 右：属性面板（拆至 FieldPropsPanel） -->
    <div class="prop-pane">
      <FieldPropsPanel
        :field="selField"
        :index="selIndex()"
        :errors="schemaErrors"
        :readonly="readonly"
        :control-label="controls?.find((c) => c.key === selField?.controlKey)?.label ?? ''"
        @patch="(p) => patchField(selIndex(), p)"
        @retype="(t) => onTypeChange(selIndex(), t)"
      >
        <template #nested>
          <FieldSchemaDesigner
            :model-value="selField?.itemFields ?? []"
            :readonly="readonly"
            nested
            :controls="controls"
            @update:model-value="(v: FieldDef[]) => setItemFields(selIndex(), v)"
          />
        </template>
      </FieldPropsPanel>
    </div>
  </div>
</template>

<style scoped>
.designer { display: flex; gap: 12px; flex: 1; min-height: 0; }
.list-pane { width: 300px; flex: none; display: flex; flex-direction: column; border: 1px solid var(--sshk-border, rgba(128,128,128,.2)); border-radius: 6px; min-height: 0; }
.list-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--sshk-border, rgba(128,128,128,.2)); font-weight: 600; font-size: 13px; }
.head-actions { display: flex; align-items: center; gap: 6px; }
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
.readonly .field-item { cursor: default; }
</style>
