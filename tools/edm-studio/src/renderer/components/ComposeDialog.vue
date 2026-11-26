<script setup lang="ts">
/**
 * 统一组装弹框（2026-11-25 需求 3.9-3.13）：邮件组装 / 模板预览 / 片段预览三场景共用一套布局。
 * - 顶部两行联动下拉：来源+品牌 / 模板+版本（mail 场景；template/fragment 由外部受控适配）
 * - tab：插槽块（默认，ComposeEditor 含折叠）/ 组装预览（iframe srcdoc）
 * - 底部：mail=[取消/确认(保存数据)/生成(先存再生成)/导出(依赖生成)/复制(final)]
 *          template/fragment=[取消/关闭/确认(保存并刷新预览)/导出/复制]
 * mail 场景内部走 useComposeDialog 自管；template/fragment 由外部 props 受控。
 */
import { computed, ref } from 'vue'
import { FormHint } from '@sshk/ui-kit'
import { CodeEditor } from '@sshk/code-editor'
import ComposeEditor from './ComposeEditor.vue'
import PlacementDataDialog from './PlacementDataDialog.vue'
import SampleForm from './SampleForm.vue'
import { useComposeDialog } from '../composables/useComposeDialog'
import type { MailRow } from '../tool-api'
import type { FragmentOption, PlacementItem, SlotDef } from '../compose-types'

type Scene = 'mail' | 'template' | 'fragment'

const props = withDefaults(defineProps<{
  visible: boolean
  scene: Scene
  mail?: MailRow | null
  /** 外部受控（template/fragment 场景）：插槽清单 */
  slots?: SlotDef[]
  fragmentOptions?: FragmentOption[]
  placements?: PlacementItem[]
  previewHtml?: string
  /** 外部受控标题 */
  title?: string
}>(), { mail: null, slots: () => [], fragmentOptions: () => [], placements: () => [], previewHtml: '', title: '' })

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved', id: string): void
  (e: 'update:placements', v: PlacementItem[]): void
  (e: 'editData', item: PlacementItem): void
  (e: 'confirm'): void
  (e: 'export'): void
  (e: 'copy'): void
  (e: 'close'): void
}>()

// mail 场景：内部 composable 自管（传 mail 快照，saved 上抛）
const mailDeps = useComposeDialog({
  visible: () => props.visible && props.scene === 'mail',
  mail: () => props.mail ?? null,
  onSaved: (id) => emit('saved', id),
})
// 解构成顶层 ref：模板只自动解包顶层 ref，不解析 mailDeps.xxx 的嵌套 ref
const {
  draft, mailDataText, previewing, saving, activeTab: innerTab,
  originOptions, brandOptions, templateOptions, versionOptions, placementData, aliasErrors,
  mailDataFields, mailDataObj,
} = mailDeps

// 场景统一视图：mail 取内部态，template/fragment 取外部 props
const slots = computed<SlotDef[]>(() => (props.scene === 'mail' ? mailDeps.templateSlots.value : props.slots))
const fragmentOptions = computed<FragmentOption[]>(() => (props.scene === 'mail' ? mailDeps.fragmentOptions.value : props.fragmentOptions))
const placements = computed<PlacementItem[]>(() => (props.scene === 'mail' ? mailDeps.placements.value : props.placements))
const previewHtml = computed(() => (props.scene === 'mail' ? mailDeps.previewHtml.value : props.previewHtml))
/** tab 可写代理：mail 走内部态，template/fragment 外部受控也存一份本地态 */
const activeTab = computed<'slots' | 'preview' | 'mailData'>({
  get: () => innerTab.value,
  set: (v) => { innerTab.value = v },
})
/** 模板数据 tab 内部双形态：表单（fields schema）/ JSON（#201） */
const dataTab = ref<'form' | 'json'>('form')

function updatePlacements(v: PlacementItem[]): void {
  if (props.scene === 'mail') mailDeps.placements.value = v
  else emit('update:placements', v)
}
function switchTab(tab: 'slots' | 'preview' | 'mailData'): void {
  if (props.scene === 'mail') mailDeps.switchTab(tab)
  else if (tab === 'preview') emit('confirm') // 外部受控：切预览触发父级保存并刷新预览
}

const titleText = computed(() => props.title || (props.scene === 'mail' ? (props.mail ? '编辑邮件' : '新增邮件') : props.scene === 'template' ? '模板预览' : '片段预览'))
const isMail = computed(() => props.scene === 'mail')

function doClose(): void {
  // telesсope dialog 关闭统一走 doClose（v-model setter no-op，避免最小化等形态回发误关）
  emit('update:visible', false)
  emit('close')
}
function onConfirm(): void {
  if (isMail.value) void mailDeps.doConfirm()
  else emit('confirm') // template/fragment：保存并刷新预览，不关弹框
}
async function onGenerate(): Promise<void> {
  if (!isMail.value) return
  await mailDeps.doGenerate()
}
function onExport(): void {
  if (isMail.value) void mailDeps.doExport(props.mail ?? null)
  else emit('export') // 外部场景：导出当前预览，父级承接
}
function onCopy(): void {
  if (isMail.value) void mailDeps.doCopy(props.mail ?? null)
  else emit('copy') // 外部场景：复制当前预览，父级承接
}
function openEditData(item: PlacementItem): void {
  if (isMail.value) mailDeps.openPlacementData(item)
  else emit('editData', item) // template/fragment：交父级打开其 placement 数据弹框
}
function saveEditData(data: Record<string, unknown>): void {
  if (isMail.value) mailDeps.savePlacementData(data)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="titleText"
    width="1060px"
    top="4vh"
    class="compose-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => { if (!v) doClose() }"
  >
    <!-- 场景特有选择器（template/fragment 的宿主模板选择等） -->
    <slot name="selector-extra" />

    <!-- mail 场景顶部两行联动下拉（#198 ④⑤）：两列等宽栅格；模板族/版本拆两个下拉；组装弹框不改邮件名 -->
    <template v-if="isMail">
      <div class="selector-grid">
        <el-form-item label="来源" class="sel-item">
          <el-select v-model="draft.origin" size="small" @change="mailDeps.onOriginChange">
            <el-option v-for="o in originOptions" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="品牌" class="sel-item">
          <el-select v-model="draft.brandId" size="small" filterable placeholder="选择品牌" @change="mailDeps.onBrandChange">
            <el-option v-for="b in brandOptions" :key="b.value" :value="b.value" :label="b.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="模板" class="sel-item">
          <el-select v-model="draft.templateId" size="small" filterable placeholder="选择模板" :disabled="!draft.brandId" @change="mailDeps.onTemplateFamilyChange">
            <el-option v-for="t in templateOptions" :key="t.value" :value="t.value" :label="t.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本" class="sel-item">
          <el-select v-model="draft.templateVersionId" size="small" filterable placeholder="选择版本" :disabled="!draft.templateId" @change="mailDeps.onTemplateChange">
            <el-option v-for="v in versionOptions" :key="v.value" :value="v.value" :label="v.label" />
          </el-select>
        </el-form-item>
      </div>
    </template>

    <!-- tab 区：mail=插槽块/组装预览双 tab；模板/片段布局配置只留插槽块（2026-11-25 反馈 6：
         组装后回主页预览，且内存态无处保存，不出现「片段数据」「备注名」等可编辑项） -->
    <el-tabs
      v-model="activeTab"
      class="compose-tabs"
      :class="{ 'no-tabs': !isMail }"
      @tab-change="(name: string | number) => switchTab(name as 'slots' | 'preview')"
    >
      <el-tab-pane label="插槽块" name="slots">
        <div class="slot-layout">
          <div class="slot-editor">
            <ComposeEditor
              v-if="slots.length"
              :model-value="placements"
              :slots="slots"
              :fragment-options="fragmentOptions"
              :mail-mode="isMail"
              :alias-errors="aliasErrors"
              @update:model-value="updatePlacements"
              @edit-data="openEditData"
            />
            <el-empty v-else description="请先选择模板版本（模板未声明 slots 区块）" :image-size="70" />
          </div>
        </div>
      </el-tab-pane>
      <!-- 模板数据 tab（#201）：邮件级模板变量（主题/preheader 等）每封邮件独立，表单默认 + JSON 兜底 -->
      <el-tab-pane v-if="isMail" label="模板数据" name="mailData">
        <div class="mail-data">
          <div class="md-head mx-[1px]">
            <FormHint detail="邮件级模板变量（如主题、preheader），每封邮件独立；模板 njk 里的同名变量从这里取值，片段未填「片段数据」时也回落到这里。" />
            <el-radio-group v-model="dataTab" size="small" class="flex-none">
              <el-radio-button value="form">表单</el-radio-button>
              <el-radio-button value="json">JSON</el-radio-button>
            </el-radio-group>
          </div>
          <div class="md-body">
            <SampleForm
              v-if="dataTab === 'form' && mailDataFields.length"
              :model-value="mailDataObj"
              :fields="mailDataFields"
              :show-ai-fill="false"
              @update:model-value="mailDeps.onMailDataFormChange"
            />
            <el-empty v-else-if="dataTab === 'form'" description="当前模板未声明 fields（meta.yaml fields:），请切 JSON 编辑" :image-size="70" />
            <CodeEditor
              v-if="dataTab === 'json'"
              :model-value="mailDataText"
              language="json"
              height="100%"
              @update:model-value="(v: string) => (mailDataText = v)"
              @save="mailDeps.refreshPreview()"
            />
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="isMail" label="组装预览" name="preview">
        <div class="preview-bar">
          <FormHint inline>草稿渲染（不落库）</FormHint>
          <el-button v-if="isMail" size="small" type="success" plain :loading="previewing" @click="mailDeps.refreshPreview">刷新预览</el-button>
        </div>
        <iframe v-if="previewHtml" class="preview-frame" :srcdoc="previewHtml" />
        <el-empty v-else description="切到本 tab 自动生成预览" :image-size="70" />
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div class="footer">
        <template v-if="isMail">
          <el-button type="primary" :loading="saving" @click="onConfirm">保存</el-button>
          <el-button type="success" :loading="saving" @click="onGenerate">生成</el-button>
        </template>
        <template v-else>
          <el-button type="primary" @click="onConfirm">保存并刷新预览</el-button>
        </template>
        <el-button type="warning" @click="onExport">导出</el-button>
        <el-button type="warning" @click="onCopy">复制</el-button>
        <el-button @click="doClose">取消</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- placement 独立数据编辑（mail 场景；#200 双 tab：表单/JSON） -->
  <PlacementDataDialog
    v-if="isMail"
    :open="placementData.open"
    :fields="placementData.fields"
    :data="placementData.data"
    @update:open="(v: boolean) => (placementData.open = v)"
    @save="saveEditData"
  />
</template>

<style scoped>
/* 顶部两列等宽栅格（#198 ⑤）：selector-extra 场景特有选择器也纳入等宽列 */
.selector-grid { flex: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; row-gap: 4px; }
.sel-item { margin-bottom: 0; min-width: 0; }
.sel-item :deep(.el-select), .sel-item :deep(.el-input) { width: 100%; }

.compose-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 模板/片段布局配置（内存态）：只留插槽块内容，tab 头隐藏 */
.compose-tabs.no-tabs :deep(.el-tabs__header) { display: none; }
.compose-tabs.no-tabs :deep(.el-tabs__content) { padding-top: 0; }
.compose-tabs :deep(.el-tabs__header) { flex: none; margin-bottom: 0; }
.compose-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; padding-top: 8px; }
.compose-tabs :deep(.el-tab-pane) { height: 100%; }

/* 滚动区仅限插槽编辑区 / 组装预览（#198 ⑥）：弹框整体不滚，header/footer/选择器固定 */
.slot-layout { display: flex; height: 100%; min-height: 0; }
.slot-editor { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
/* 模板数据 tab（#201）：头行说明+形态切换固定，下方表单/JSON 填充剩余高度 */
.mail-data { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.md-head { display: flex; align-items: center; justify-content: space-between; flex: none; }
.md-body { flex: 1; min-height: 0; display: flex; }
.md-body > * { flex: 1; min-width: 0; min-height: 0; }
.md-body :deep(.code-editor) { height: 100% !important; }
.preview-bar { display: flex; align-items: center; justify-content: end; gap: 8px; padding-bottom: 6px; }
.preview-frame { width: 100%; height: 100%; border: 1px solid rgba(128,128,128,.2); border-radius: 4px; background: #fff; }
.footer { display: flex; align-items: center; justify-content: center; }
.footer .el-button + .el-button { margin-left: 8px; }
</style>

<!-- 非 scoped 全局块：弹框 teleport 到 body，scoped 数据属性打不到弹框节点（本项目既定口径） -->
<style>
/* 组装弹框固定高度（#198 ③）：全项目硬性要求——大内容弹框给视口百分比高度，
   滚动交给内部自绘区（slot-editor / preview），弹框整体与 body 不滚动。
   先例 ToolManifestDialog .manifest-shell { height: min(66vh, 640px) }。 */
.el-dialog.compose-dialog { height: min(84vh, 780px); max-height: none; overflow: hidden; }
.el-dialog.compose-dialog .el-dialog__body { display: flex; flex-direction: column; overflow: hidden; flex: 1; min-height: 0; }
</style>
