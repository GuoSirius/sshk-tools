<script lang="ts">
/** 区块 / 片段摆放类型（P6-4 抽到 compose-types.ts；此处 re-export 保持原消费面） */
export type { SlotDef, FragmentOption, PlacementItem } from './compose-types'
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FragmentOption, PlacementItem, SlotDef } from './compose-types'
import { VueDraggable } from 'vue-draggable-plus'
import { Delete, Rank } from '@element-plus/icons-vue'
import { FormHint } from '@sshk/ui-kit'

/**
 * 统一组合编辑器（R19/R20）：区块布局 + 片段摆放 —— 拖拽排序 / 重复次数 / 移动区块。
 * 区块清单（slots）来自模板族 meta slots:（B1）；fragmentOptions 已由父级按黑白名单过滤；
 * placement.data 的编辑由父级处理（edit-data 事件），本组件只管布局。
 */
const props = withDefaults(
  defineProps<{ slots: SlotDef[]; fragmentOptions: FragmentOption[]; modelValue: PlacementItem[]; readonly?: boolean }>(),
  { readonly: false },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: PlacementItem[]): void
  (e: 'editData', item: PlacementItem): void
}>()

const pickFragment = ref('')
const pickSlot = ref('')
let uidSeed = 0

/** 落点区块选定后，片段下拉按 slot.type ↔ 片段 type 匹配过滤（无 type 约束时全给） */
const pickOptions = computed<FragmentOption[]>(() => {
  const slotType = props.slots.find((s) => s.key === (pickSlot.value || props.slots[0]?.key))?.type
  if (!slotType) return props.fragmentOptions
  return props.fragmentOptions.filter((o) => !o.type || o.type === slotType)
})

function itemsOf(slot: string): PlacementItem[] {
  return props.modelValue.filter((p) => p.slot === slot).sort((a, b) => a.order - b.order)
}
function emitChange(list: PlacementItem[]): void {
  emit('update:modelValue', list.map((p) => ({ ...p })))
}
/** 区块内重排：重设该区块 order（其余区块不动） */
function onSlotReorder(slotKey: string, arr: PlacementItem[]): void {
  const others = props.modelValue.filter((p) => p.slot !== slotKey)
  const reordered = arr.map((p, i) => ({ ...p, slot: slotKey, order: i }))
  emitChange([...others, ...reordered])
}
function addPlacement(): void {
  if (props.readonly) return
  const opt = props.fragmentOptions.find((o) => o.id === pickFragment.value)
  if (!opt) return
  const slotKey = pickSlot.value || props.slots[0]?.key || ''
  if (!slotKey) return
  const slotType = props.slots.find((s) => s.key === slotKey)?.type
  if (slotType && opt.type && opt.type !== slotType) return // 槽位类型不匹配（下拉已过滤，双保险）
  emitChange([
    ...props.modelValue,
    { uid: `p_${Date.now()}_${uidSeed++}`, fragmentId: opt.id, label: opt.label, slot: slotKey, order: itemsOf(slotKey).length, repeat: 1 },
  ])
  pickFragment.value = ''
}
function moveTo(p: PlacementItem, slotKey: string): void {
  if (slotKey === p.slot) return
  emitChange(props.modelValue.map((x) => (x.uid === p.uid ? { ...x, slot: slotKey, order: itemsOf(slotKey).length } : x)))
}
function removePlacement(p: PlacementItem): void {
  if (props.readonly) return
  const rest = props.modelValue.filter((x) => x.uid !== p.uid).map((x) => ({ ...x }))
  for (const s of props.slots) {
    rest.filter((x) => x.slot === s.key).sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i })
  }
  emitChange(rest)
}
function setRepeat(p: PlacementItem, v: number | undefined): void {
  emitChange(props.modelValue.map((x) => (x.uid === p.uid ? { ...x, repeat: Math.max(1, Math.floor(v ?? 1)) } : x)))
}
</script>

<template>
  <div class="compose" :class="{ readonly }">
    <div class="toolbar">
      <el-select v-model="pickFragment" size="small" filterable placeholder="选择片段" class="pick">
        <el-option v-for="f in pickOptions" :key="f.id" :value="f.id" :label="f.label" />
      </el-select>
      <el-select v-model="pickSlot" size="small" placeholder="落点区块" class="pick-sm">
        <el-option v-for="s in slots" :key="s.key" :value="s.key" :label="s.label || s.key" />
      </el-select>
      <el-button size="small" type="primary" plain :disabled="readonly || !pickFragment" @click="addPlacement">添加</el-button>
      <FormHint inline>拖拽 ≡ 区块内排序；次数 = 重复渲染</FormHint>
    </div>
    <div class="blocks">
      <div v-for="s in slots" :key="s.key" class="block">
        <div class="block-head">
          <span class="block-name">{{ s.label || s.key }}</span>
          <code class="block-key">{{ s.key }}</code>
          <span class="block-count">{{ itemsOf(s.key).length }} 项</span>
        </div>
        <VueDraggable
          v-if="itemsOf(s.key).length"
          :model-value="itemsOf(s.key)"
          :handle="'.handle'"
          :animation="180"
          :disabled="readonly"
          ghost-class="drag-ghost"
          class="block-body"
          @update:model-value="(arr: PlacementItem[]) => onSlotReorder(s.key, arr)"
        >
          <div v-for="p in itemsOf(s.key)" :key="p.uid" class="placement">
            <span class="handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
            <span class="lbl" :title="p.label">{{ p.label }}</span>
            <el-input-number
              :model-value="p.repeat"
              size="small"
              :min="1"
              :max="99"
              controls-position="right"
              class="repeat"
              @update:model-value="(v: number | undefined) => setRepeat(p, v)"
            />
            <el-select :model-value="p.slot" size="small" class="slot-sel" @update:model-value="(v: string) => moveTo(p, v)">
              <el-option v-for="s2 in slots" :key="s2.key" :value="s2.key" :label="`→ ${s2.label || s2.key}`" />
            </el-select>
            <el-button size="small" text type="primary" @click="emit('editData', p)">数据</el-button>
            <el-button v-if="!readonly" size="small" text type="danger" :icon="Delete" @click="removePlacement(p)" />
          </div>
        </VueDraggable>
        <div v-else class="block-empty">空区块 —— 上方选择片段与落点后「添加」</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compose { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; }
.pick { width: 220px; }
.pick-sm { width: 130px; }
.blocks { display: flex; flex-direction: column; gap: 8px; overflow: auto; min-height: 0; }
.block { border: 1px solid rgba(128,128,128,.2); border-radius: 6px; overflow: hidden; }
.block-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(128,128,128,.08); font-size: 13px; }
.block-name { font-weight: 600; }
.block-key { font-size: 11px; opacity: .6; }
.block-count { margin-left: auto; font-size: 12px; opacity: .6; }
.block-body { display: flex; flex-direction: column; }
.placement { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid rgba(128,128,128,.12); font-size: 13px; }
.placement:first-child { border-top: none; }
.handle { cursor: grab; color: var(--el-text-color-secondary); display: inline-flex; padding: 2px; border-radius: 4px; }
.handle:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repeat { width: 90px; flex: none; }
.slot-sel { width: 110px; flex: none; }
.block-empty { padding: 10px; font-size: 12px; opacity: .5; text-align: center; }
.drag-ghost { opacity: .5; background: var(--el-color-primary-light-9, rgba(64,158,255,.08)); }
.readonly .handle { cursor: default; }
</style>
