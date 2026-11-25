<script lang="ts">
/** 区块 / 片段摆放类型（P6-4 抽到 compose-types.ts；此处 re-export 保持原消费面） */
export type { SlotDef, FragmentOption, PlacementItem } from '../compose-types'
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FragmentOption, PlacementItem, SlotDef } from '../compose-types'
import { VueDraggable } from 'vue-draggable-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowRight, Delete, Rank } from '@element-plus/icons-vue'
import { FormHint } from '@sshk/ui-kit'

/**
 * 统一组合编辑器（R19/R20）：区块布局 + 片段摆放 —— 拖拽排序 / 备注名 / 移动区块。
 * 区块清单（slots）= 模板族 meta slots: + 模板 njk 源码 slot_*（源码新增即时生效）；fragmentOptions 已由父级按黑白名单过滤；
 * placement.data 的编辑由父级处理（edit-data 事件），本组件只管布局。
 * mailMode（2026-11-25 用户反馈）：备注名输入与「片段数据」仅邮件组装场景出现——
 * 模板/片段的布局配置为内存态、无处保存，出现可编辑项反而误导。
 */
const props = withDefaults(
  defineProps<{
    slots: SlotDef[]
    fragmentOptions: FragmentOption[]
    modelValue: PlacementItem[]
    readonly?: boolean
    mailMode?: boolean
    /** 备注名校验失败（保存尝试后仍未填）的 placement uid 集合，标红输入框 */
    aliasErrors?: Set<string>
  }>(),
  { readonly: false, mailMode: false, aliasErrors: () => new Set<string>() },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: PlacementItem[]): void
  (e: 'editData', item: PlacementItem): void
}>()

/** 每个区块头部各自的片段选择（#198 ⑦：下拉收进区块头、sticky 吸顶，滚动时仍可就地添加） */
const pickBySlot = ref<Record<string, string>>({})
let uidSeed = 0

/** 区块展开折叠（2026-11-25 需求 3.12）：本地态、默认全展开，不影响 placement 数据 */
const collapsedKeys = ref<Set<string>>(new Set())
function toggleBlock(key: string): void {
  const next = new Set(collapsedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedKeys.value = next
}

/** 按区块类型过滤片段选项（无 type 约束时全给），供各区块头部独立下拉使用 */
function pickOptions(slotKey: string): FragmentOption[] {
  const slotType = props.slots.find((s) => s.key === slotKey)?.type
  if (!slotType) return props.fragmentOptions
  return props.fragmentOptions.filter((o) => !o.type || o.type === slotType)
}

/** 源码新增/删除 slot 后清理失效的按区块选择（有效选择保留，不因连续添加而清空） */
watch(() => props.slots, (slots) => {
  const keys = new Set(slots.map((s) => s.key))
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(pickBySlot.value)) if (keys.has(k)) next[k] = v
  pickBySlot.value = next
}, { immediate: true })

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
function addPlacement(slotKey: string): void {
  if (props.readonly) return
  const opt = pickOptions(slotKey).find((o) => o.id === pickBySlot.value[slotKey])
  if (!opt) {
    ElMessage.warning('请先选择片段')
    return
  }
  const slotType = props.slots.find((s) => s.key === slotKey)?.type
  if (slotType && opt.type && opt.type !== slotType) {
    ElMessage.warning(`片段类型「${opt.type}」与区块类型「${slotType}」不匹配`)
    return
  }
  emitChange([
    ...props.modelValue,
    { uid: `p_${Date.now()}_${uidSeed++}`, fragmentId: opt.id, label: opt.label, slot: slotKey, order: itemsOf(slotKey).length },
  ])
  // 连续添加保留该区块的片段选择
}
function moveTo(p: PlacementItem, slotKey: string): void {
  if (slotKey === p.slot) return
  emitChange(props.modelValue.map((x) => (x.uid === p.uid ? { ...x, slot: slotKey, order: itemsOf(slotKey).length } : x)))
}
async function removePlacement(p: PlacementItem): Promise<void> {
  if (props.readonly) return
  try {
    await ElMessageBox.confirm(`确定删除布局中的「${p.label}」？`, '删除片段', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      closeOnClickModal: false,
      closeOnPressEscape: false,
    })
  } catch {
    return
  }
  const rest = props.modelValue.filter((x) => x.uid !== p.uid).map((x) => ({ ...x }))
  for (const s of props.slots) {
    rest.filter((x) => x.slot === s.key).sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i })
  }
  emitChange(rest)
}
function setAlias(p: PlacementItem, v: string): void {
  emitChange(props.modelValue.map((x) => (x.uid === p.uid ? { ...x, alias: v } : x)))
}
</script>

<template>
  <div class="compose" :class="{ readonly }">
    <FormHint inline>拖拽 ≡ 区块内排序；「片段数据」= 该片段独立表单数据（留空回落模板数据）{{ mailMode ? '；备注名用于区分同片段的多次使用，必填' : '' }}</FormHint>
    <div class="blocks">
      <div v-for="s in slots" :key="s.key" class="block">
        <!-- 区块头 sticky 吸顶（#198 ⑦）：片段下拉 + 添加随滚动常驻，就地添加不用来回滚 -->
        <div class="block-head">
          <el-button size="small" text class="fold-btn" :aria-label="collapsedKeys.has(s.key) ? '展开区块' : '折叠区块'" @click="toggleBlock(s.key)">
            <el-icon><ArrowDown v-if="!collapsedKeys.has(s.key)" /><ArrowRight v-else /></el-icon>
          </el-button>
          <span class="block-name">{{ s.label || s.key }}</span>
          <code class="block-key">{{ s.key }}</code>
          <el-select
            v-model="pickBySlot[s.key]"
            size="small"
            filterable
            clearable
            placeholder="选择片段"
            class="head-pick"
            @change="() => {}"
          >
            <el-option v-for="f in pickOptions(s.key)" :key="f.id" :value="f.id" :label="f.label" />
          </el-select>
          <el-button size="small" type="primary" plain :disabled="readonly || !pickBySlot[s.key]" @click="addPlacement(s.key)">添加</el-button>
          <span class="block-count">{{ itemsOf(s.key).length }} 项</span>
        </div>
        <VueDraggable
          v-if="!collapsedKeys.has(s.key) && itemsOf(s.key).length"
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
            <!-- 备注名（2026-11-25 用户反馈：替代原「次数」，区分同片段多次使用；仅 mail 场景可编辑保存 -->
            <el-input
              v-if="mailMode"
              :model-value="p.alias"
              size="small"
              clearable
              placeholder="备注名"
              class="alias"
              :class="{ 'alias-error': aliasErrors.has(p.uid) }"
              @update:model-value="(v: string) => setAlias(p, v)"
            />
            <el-select :model-value="p.slot" size="small" class="slot-sel" @update:model-value="(v: string) => moveTo(p, v)">
              <el-option v-for="s2 in slots" :key="s2.key" :value="s2.key" :label="`→ ${s2.label || s2.key}`" />
            </el-select>
            <el-button v-if="mailMode" size="small" text type="primary" @click="emit('editData', p)">片段数据</el-button>
            <el-button v-if="!readonly" size="small" text type="danger" :icon="Delete" @click="removePlacement(p)" />
          </div>
        </VueDraggable>
        <div v-else-if="!collapsedKeys.has(s.key)" class="block-empty">空区块 —— 在上方选择片段后「添加」</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compose { display: flex; flex-direction: column; gap: 8px; min-height: 0; height: 100%; }
.blocks { display: flex; flex-direction: column; gap: 8px; padding-right: 3px; overflow: auto; min-height: 0; flex: 1; }
.block { flex: none; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; }
/* sticky 吸顶（#198 ⑦）：滚动区块列表时头部片段下拉常驻可用；z-index 盖住下方行 */
.block-head {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 6px; padding: 5px 10px;
  background: var(--el-bg-color, rgba(30,30,30,.98));
  border-radius: 6px 6px 0 0; font-size: 13px;
}
.fold-btn { flex: none; width: 18px; height: 18px; padding: 0; margin-right: 2px; }
.block-name { font-weight: 600; white-space: nowrap; }
.block-key { font-size: 11px; opacity: .6; white-space: nowrap; }
.head-pick { width: 200px; flex: none; }
.block-count { margin-left: auto; font-size: 12px; opacity: .6; white-space: nowrap; }
.block-body { display: flex; flex-direction: column; }
.placement { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid rgba(128,128,128,.12); font-size: 13px; }
.placement:first-child { border-top: none; }
.handle { cursor: grab; color: var(--el-text-color-secondary); display: inline-flex; padding: 2px; border-radius: 4px; }
.handle:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alias { width: 120px; flex: none; }
.alias.alias-error :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.slot-sel { width: 110px; flex: none; }
.block-empty { padding: 10px; font-size: 12px; opacity: .5; text-align: center; }
.drag-ghost { opacity: .5; background: var(--el-color-primary-light-9, rgba(64,158,255,.08)); }
.readonly .handle { cursor: default; }
</style>
