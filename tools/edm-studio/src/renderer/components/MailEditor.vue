<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { FormHint } from '@sshk/ui-kit'
import SampleForm from './SampleForm.vue'
import { CodeEditor } from '@sshk/code-editor'
import ComposeEditor from './ComposeEditor.vue'
import type { FragmentOption, PlacementItem, SlotDef } from './ComposeEditor.vue'
import { normalizeFields, type FieldDef } from '../sample-schema'
import { api } from '../tool-api'
import type { MailRow } from '../tool-api'
import { brands, fragments, frgvVersions, templates, tplVersionsAll } from '../store'

/**
 * 邮件编辑器（R20 分步）：① 基本信息（名称/来源/品牌）→ ② 模板版本 → ③ 片段布局（拖拽）→ ④ 预览确认。
 * 右栏实时预览（mail:preview 草稿渲染，不落库）；底部「保存」= 纯落库，「保存并生成」= 保存+njk+juice+minify（§6.2）。
 * 片段清单按品牌 + 黑白名单（复刻 repository policyAllows：匹配 {tv._id, tv.templateId}）过滤。
 */
const props = defineProps<{ visible: boolean; mail: MailRow | null }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved', id: string): void
}>()

const step = ref(1)
const draft = ref<{ _id: string; name: string; origin: 'system' | 'custom'; brandId: string; templateVersionId: string }>({
  _id: '', name: '', origin: 'custom', brandId: '', templateVersionId: '',
})
const placements = ref<PlacementItem[]>([])
const mailDataText = ref('{}')
const previewHtml = ref('')
const previewing = ref(false)
const saving = ref(false)
let uidSeed = 0

const STEP_LABELS = ['基本信息', '选择模板', '片段布局', '预览确认']

function policyAllows(policy: { blacklist?: string[]; whitelist?: string[] } | undefined, ids: string[]): boolean {
  if (!policy) return true
  if ((policy.blacklist ?? []).some((x) => ids.includes(x))) return false
  const wl = policy.whitelist ?? []
  if (wl.length === 0) return true
  return wl.some((x) => ids.includes(x))
}

function toPlacements(bindings: MailRow['bindings']): PlacementItem[] {
  return (bindings ?? []).map((b, i) => {
    const fv = frgvVersions.value.find((v) => v._id === b.fragmentVersionId)
    const fragName = fragments.value.find((f) => f._id === fv?.fragmentId)?.name ?? b.fragmentVersionId.slice(0, 10)
    return {
      uid: `p_${Date.now()}_${uidSeed++}`,
      fragmentId: b.fragmentVersionId,
      label: `${fragName} / ${fv?.label ?? ''}`,
      slot: b.slot,
      order: b.order ?? i,
      repeat: b.repeat ?? 1,
      data: b.data,
    }
  })
}

watch(
  () => props.visible,
  (open) => {
    if (!open) return
    const m = props.mail
    draft.value = m
      ? { _id: m._id, name: String(m.name ?? ''), origin: m.origin ?? 'custom', brandId: m.brandId ?? '', templateVersionId: m.templateVersionId ?? '' }
      : { _id: '', name: '', origin: 'custom', brandId: '', templateVersionId: '' }
    placements.value = m ? toPlacements(m.bindings) : []
    mailDataText.value = m?.data ? JSON.stringify(m.data, null, 2) : '{}'
    previewHtml.value = ''
    step.value = m ? 3 : 1
  },
)

const brandOptions = computed(() => brands.value.map((b) => ({ value: b._id, label: `${b.name}（${b.code}）` })))
const templateOptions = computed(() =>
  tplVersionsAll.value
    .filter((v) => v.brandId === draft.value.brandId)
    .map((v) => ({ value: v._id, label: `${templateName(v.templateId ?? '')} / ${v.label ?? `v${v.version}`}` })),
)
function templateName(templateId: string): string {
  return templates.value.find((t) => t._id === templateId)?.name ?? templateId.slice(0, 10)
}

const currentTv = computed(() => tplVersionsAll.value.find((v) => v._id === draft.value.templateVersionId))
const templateSlots = computed<SlotDef[]>(() =>
  (currentTv.value?.slots ?? []).map((s) => ({ key: s.key, label: s.type || s.key, type: s.type })),
)
const fragmentOptions = computed<FragmentOption[]>(() => {
  const tv = currentTv.value
  if (!tv) return []
  const ids = [tv._id, tv.templateId ?? '']
  const fragName = (fid: string): string => fragments.value.find((f) => f._id === fid)?.name ?? fid.slice(0, 10)
  return frgvVersions.value
    .filter((v) => v.brandId === draft.value.brandId)
    .filter((v) => policyAllows(v.policy, ids))
    .map((v) => ({ id: v._id, label: `${fragName(v.fragmentId ?? '')} / ${v.label ?? `v${v.version}`}`, type: v.type }))
})

/** 跨品牌硬规定：用户切换品牌时清空旧品牌的模板与片段布局，避免残留混用 */
function onBrandChange(): void {
  draft.value.templateVersionId = ''
  placements.value = []
  previewHtml.value = ''
}

function onTemplateChange(): void {
  const first = templateSlots.value[0]?.key ?? ''
  placements.value = placements.value.map((p, i) => ({
    ...p,
    slot: templateSlots.value.some((s) => s.key === p.slot) ? p.slot : first,
    order: i,
  }))
  void refreshPreview()
}

function stepNext(): void {
  if (step.value === 1) {
    if (!draft.value.name.trim()) { ElMessage.warning('名称必填'); return }
    if (!draft.value.brandId) { ElMessage.warning('请选择品牌'); return }
  }
  if (step.value === 2 && !draft.value.templateVersionId) { ElMessage.warning('请选择模板版本'); return }
  step.value = Math.min(4, step.value + 1)
  if (step.value >= 3) void refreshPreview()
}

async function refreshPreview(): Promise<void> {
  if (!draft.value.templateVersionId) return
  previewing.value = true
  try {
    const res = (await api('mail:preview', {
      templateVersionId: draft.value.templateVersionId,
      placements: placements.value.map((p) => ({
        fragmentVersionId: p.fragmentId, slot: p.slot, order: p.order, repeat: p.repeat, data: p.data,
      })),
      mailData: parseMailData(),
    })) as { html: string }
    previewHtml.value = res.html
  } catch (err) {
    ElMessage.warning(`预览失败：${(err as Error).message}`)
  } finally {
    previewing.value = false
  }
}

function parseMailData(): Record<string, unknown> {
  try {
    return (JSON.parse(mailDataText.value) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

function buildPayload(): Record<string, unknown> {
  return {
    _id: draft.value._id,
    name: draft.value.name.trim(),
    origin: draft.value.origin,
    brandId: draft.value.brandId,
    templateVersionId: draft.value.templateVersionId,
    bindings: placements.value.map((p) => ({
      slot: p.slot, fragmentVersionId: p.fragmentId, order: p.order, repeat: p.repeat, data: p.data,
    })),
    data: parseMailData(),
  }
}

async function persist(): Promise<string> {
  await api('mail:save', buildPayload())
  return draft.value._id
}

async function onSave(generate: boolean): Promise<void> {
  if (!draft.value.name.trim() || !draft.value.brandId || !draft.value.templateVersionId) {
    ElMessage.warning('名称、品牌、模板版本必填（步骤 1/2）')
    return
  }
  saving.value = true
  try {
    await persist()
    if (generate) {
      await api('mail:generate', { _id: draft.value._id })
      ElMessage.success('已保存并生成三阶段产物')
    } else {
      ElMessage.success('邮件已保存')
    }
    emit('saved', draft.value._id)
    emit('update:visible', false)
  } catch (err) {
    ElMessage.error(`${generate ? '生成' : '保存'}失败：${(err as Error).message}`)
  } finally {
    saving.value = false
  }
}

/* placement 独立数据编辑（Q12）：片段 fields schema → SampleForm；无 schema → YAML */
const placementData = ref<{ open: boolean; uid: string; fields: FieldDef[]; obj: Record<string, unknown>; yamlText: string }>({
  open: false, uid: '', fields: [], obj: {}, yamlText: '',
})
function openPlacementData(item: PlacementItem): void {
  const fv = frgvVersions.value.find((v) => v._id === item.fragmentId)
  const fields = normalizeFields((fv?.fields as unknown) ?? [])
  const obj = { ...(item.data ?? fv?.sampleData ?? {}) }
  placementData.value = { open: true, uid: item.uid, fields, obj, yamlText: JSON.stringify(obj, null, 2) }
}
function savePlacementData(): void {
  const st = placementData.value
  let data: Record<string, unknown>
  if (st.fields.length) {
    data = { ...st.obj }
  } else {
    try {
      data = (JSON.parse(st.yamlText) as Record<string, unknown>) ?? {}
    } catch (err) {
      ElMessage.error(`JSON 解析失败：${(err as Error).message}`)
      return
    }
  }
  placements.value = placements.value.map((p) => (p.uid === st.uid ? { ...p, data } : p))
  st.open = false
  void refreshPreview()
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="mail ? '编辑邮件' : '新增邮件'"
    width="1020px"
    top="4vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <el-steps :active="step - 1" simple finish-status="success" class="steps">
      <el-step v-for="s in STEP_LABELS" :key="s" :title="s" />
    </el-steps>

    <div class="body">
      <div class="left">
        <!-- ① 基本信息 -->
        <el-form v-show="step === 1" label-width="auto">
          <el-form-item label="名称" required><el-input clearable v-model="draft.name" placeholder="邮件名称" /></el-form-item>
          <el-form-item label="来源">
            <el-radio-group v-model="draft.origin">
              <el-radio value="custom">自定义</el-radio>
              <el-radio value="system">系统（官方产出）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="品牌" required>
            <el-select v-model="draft.brandId" filterable style="width: 100%" placeholder="选择品牌" @change="onBrandChange">
              <el-option v-for="b in brandOptions" :key="b.value" :value="b.value" :label="b.label" />
            </el-select>
          </el-form-item>
        </el-form>

        <!-- ② 模板 -->
        <el-form v-show="step === 2" label-width="auto">
          <el-form-item label="模板版本" required>
            <el-select v-model="draft.templateVersionId" filterable style="width: 100%" placeholder="选择模板版本" @change="onTemplateChange">
              <el-option v-for="t in templateOptions" :key="t.value" :value="t.value" :label="t.label" />
            </el-select>
          </el-form-item>
          <el-form-item label="区块">
            <el-tag v-for="s in templateSlots" :key="s.key" size="small" class="slot-tag">{{ s.label || s.key }}</el-tag>
            <FormHint v-if="!templateSlots.length" inline>该模板未声明 slots 区块</FormHint>
          </el-form-item>
          <el-form-item label="模板数据">
            <CodeEditor :model-value="mailDataText" language="json" height="160px" @update:model-value="(v: string) => (mailDataText = v)" @save="onSave(false)" />
            <FormHint>模板级数据（片段未单独填数据时的回落，Q12）</FormHint>
          </el-form-item>
        </el-form>

        <!-- ③ 片段布局 -->
        <div v-show="step === 3" class="layout-pane">
          <ComposeEditor
            v-if="templateSlots.length"
            v-model="placements"
            :slots="templateSlots"
            :fragment-options="fragmentOptions"
            @edit-data="openPlacementData"
          />
          <el-empty v-else description="请先在步骤 2 选择模板版本" :image-size="70" />
        </div>

        <!-- ④ 预览确认 -->
        <div v-show="step === 4" class="preview-tip">
          <el-alert type="info" :closable="false" title="确认整体效果后，点底部「保存」或「保存并生成」" />
        </div>
      </div>

      <!-- 右栏实时预览（步骤 3/4） -->
      <div v-if="step >= 3" class="right">
        <div class="pv-bar">
          <FormHint inline>草稿渲染（不落库）</FormHint>
          <el-button size="small" type="success" plain :loading="previewing" class="push-right" @click="refreshPreview">刷新预览</el-button>
        </div>
        <iframe v-if="previewHtml" class="pv" :srcdoc="previewHtml" />
        <el-empty v-else description="添加片段后自动预览" :image-size="70" />
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <el-button :disabled="step <= 1" @click="step--">上一步</el-button>
        <el-button v-if="step < 4" type="primary" plain @click="stepNext">下一步</el-button>
        <span class="spacer" />
        <el-button @click="emit('update:visible', false)">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave(false)">保存</el-button>
        <el-button type="success" :loading="saving" @click="onSave(true)">保存并生成</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="placementData.open" title="片段数据" width="560px" append-to-body :close-on-click-modal="false" :close-on-press-escape="false">
    <SampleForm v-if="placementData.fields.length" v-model="placementData.obj" :fields="placementData.fields" />
    <CodeEditor v-else :model-value="placementData.yamlText" language="json" height="320px" @update:model-value="(v: string) => (placementData.yamlText = v)" @save="savePlacementData" />
    <template #footer>
      <el-button @click="placementData.open = false">取消</el-button>
      <el-button type="primary" @click="savePlacementData">保存并刷新预览</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.steps { margin-bottom: 12px; }
.body { display: flex; gap: 12px; height: 480px; }
.left { flex: 1; min-width: 0; overflow: auto; }
.layout-pane { height: 100%; overflow: auto; }
.right { width: 40%; flex: none; display: flex; flex-direction: column; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 6px; min-width: 0; }
.pv-bar { display: flex; align-items: center; gap: 8px; flex: none; padding-bottom: 6px; }
/* 刷新预览居右，描述居左 */
.pv-bar .push-right { margin-left: auto; }
.pv { flex: 1; width: 100%; border: none; background: #fff; border-radius: 4px; }
.slot-tag { margin-right: 6px; }
.preview-tip { padding-top: 8px; }
.footer { display: flex; align-items: center; }
.footer .spacer { flex: 1; }
.footer .el-button + .el-button { margin-left: 8px; }
</style>
