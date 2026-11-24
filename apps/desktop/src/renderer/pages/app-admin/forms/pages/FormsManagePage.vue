<script setup lang="ts">
/**
 * 表单管理页（plans/13 B1）：表单定义 CRUD + 字段设计器。
 * - 列表铁律口径：筛选 .f-item（180px/时间 360px datetimerange）、末尾 查询(primary)+重置、
 *   操作栏独立行居右、顺序 筛选栏→操作栏→表格→分页；草稿/生效分离（useTablePage）
 * - 双层校验：前端 validateSchema 不过不发 IPC（停留 + toast）；后端另有白名单收口兜底
 * - 危险操作（删除/批量删除）ConfirmDialog 二次确认
 * - 编辑弹框三态（2026-11-24，设计/表单/数据）：设计器 ↔ 试填表单 ↔ 数据 JSON 同步；
 *   sampleModel 随保存落库（无独立预览入口）；弹框尺寸走非 scoped 全局块 + 内联兜底
 * - 表单 tab 注入 EDM 同源图片能力（2026-11-24）：ImageField（选择图片/URL 直填/复制）+
 *   富文本 imageLibrary 桥接，全部收敛共享 FilePicker
 * - AI 润色接线（2026-11-24）：渲染器 polishable 内置开关打开，polishRichText 走
 *   @sshk/form-schema 共享纯函数，Provider/模型取模块配置 app.modules.formManager.ai.*
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState, ConfirmDialog, TimeText, ListPageShell, ListPagination, useTablePage, useToolId } from '@sshk/ui-kit'
import { FieldSchemaDesigner, FormFieldRenderer } from '@sshk/form-schema/ui'
import { createHostImageLibrary } from '@sshk/file-picker'
import { CodeEditor } from '@sshk/code-editor'
import { applyDefaults, expandFields, normalizeFields, polishRichText, validateModel, validateSchema, type ChatMessage, type FieldDef } from '@sshk/form-schema'
import { inMsRange, type ControlRecord, type FormRecord } from '@sshk/shared'
import { host } from '../host'
import ImageField from './ImageField.vue'

const rows = ref<FormRecord[]>([])
const controls = ref<ControlRecord[]>([])
const loading = ref(false)
const selected = ref<FormRecord[]>([])

// 工具 id（#129 铁律）：壳 AppAdminPage 按激活页动态 provideToolId（forms 组 → form-manager），
// 本页 useToolId() 直接读取；模块 id 单一来源 @app/shared module-ids，页面不再各自 provide 覆盖
const toolId = useToolId()
/** 图片库桥接：表单 tab 富文本上传/图片库 + 图片字段 FilePicker 全走共享 FilePicker（与 EDM 同源） */
const library = computed(() => createHostImageLibrary(toolId.value, host.upload, { includeLocalProfiles: true }))

// ── AI 润色（2026-11-24 用户需求，与 EDM SampleForm 同款接线）：渲染器 polishable 开关内置，
// Provider/模型取模块配置 app.modules.formManager.ai.*（工具设置「AI 助手」组），未指定回落应用激活 Provider
const AI_PROVIDER_KEY = 'app.modules.formManager.ai.providerId'
const AI_MODEL_KEY = 'app.modules.formManager.ai.model'
const aiLoading = ref(false)
let aiProvider: { _id: string } | null = null
let aiModelOverride = ''
async function ensureAiProvider(): Promise<boolean> {
  try {
    const wantId = String(await window.api.config.get(AI_PROVIDER_KEY) ?? '').trim()
    const list = await window.api.llm.providers()
    if (wantId) {
      aiProvider = list.find((p) => p.enabled && p._id === wantId) ?? null
    } else {
      // 跟随应用激活：读 app.llm.activeProviderId；拿不到再回落清单首个启用项
      let activeId = ''
      try { activeId = String(await window.api.config.get('app.llm.activeProviderId') ?? '').trim() } catch { /* 忽略 */ }
      aiProvider = list.find((p) => p.enabled && p._id === activeId) ?? list.find((p) => p.enabled) ?? null
    }
    aiModelOverride = String(await window.api.config.get(AI_MODEL_KEY) ?? '').trim()
  } catch {
    aiProvider = null
    aiModelOverride = ''
  }
  return Boolean(aiProvider)
}
async function aiChat(messages: ChatMessage[]): Promise<string> {
  if (!aiProvider) throw new Error('请先在「模型管理」配置并启用模型 Provider')
  // 模型链：模块级 ai.model 覆盖 → Provider 默认模型 → Provider 回退模型（main 侧组装）
  const res = await window.api.llm.chat(aiProvider, messages, aiModelOverride ? { model: aiModelOverride } : undefined)
  return res.content
}
/** AI 润色：richtext 字段旧/新并排预览，接受才写回（零改动放弃） */
const polishPreview = ref<{ open: boolean; key: string; label: string; before: string; after: string }>({
  open: false, key: '', label: '', before: '', after: '',
})
async function onPolish(f: FieldDef): Promise<void> {
  const before = String(editModel.value[f.key] ?? '')
  if (!before.trim()) {
    ElMessage.warning('该字段还没有内容，先填一些文字再润色')
    return
  }
  if (!(await ensureAiProvider())) {
    ElMessage.warning('未配置可用模型 Provider：请先在「模型管理」配置并启用')
    return
  }
  aiLoading.value = true
  try {
    const after = await polishRichText(before, aiChat)
    polishPreview.value = { open: true, key: f.key, label: f.label, before, after }
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}
function acceptPolish(): void {
  editModel.value = { ...editModel.value, [polishPreview.value.key]: polishPreview.value.after }
  polishPreview.value.open = false
  ElMessage.success('润色结果已写回')
}

// ── 列表状态（草稿/生效分离 + 分页，2026-11-20 定版口径）──
const table = useTablePage<FormRecord, { kw: string; dateRange: [string, string] | null }>({
  fetch: async () => rows.value,
  rowKey: (r) => r._id,
  filters: () => ({ kw: '', dateRange: null }),
  clientFilter: (list, f) => {
    const k = f.kw.trim().toLowerCase()
    return list.filter((row) => {
      if (k && !(row.name.toLowerCase().includes(k) || (row.description ?? '').toLowerCase().includes(k))) return false
      if (!inMsRange(row.updatedAt, f.dateRange?.[0], f.dateRange?.[1])) return false
      return true
    })
  },
  pageSize: 10,
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [list, cs] = await Promise.all([host.form.list(), host.formControl.list()])
    rows.value = list
    controls.value = cs
    await table.refresh()
    table.page.value = 1
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(() => { void load() })

/** 设计器可插入的复合控件清单（builtin + 自定义全量） */
const controlOptions = computed(() => controls.value.map((c) => ({ key: c.key, label: c.label })))

// ── 编辑弹框 ──
const editOpen = ref(false)
const editId = ref<string | null>(null)
const editName = ref('')
const editDesc = ref('')
const editFields = ref<FieldDef[]>([])
const nameTip = ref('')
const editing = computed(() => Boolean(editId.value))

function openCreate(): void {
  editId.value = null
  editName.value = ''
  editDesc.value = ''
  editFields.value = []
  nameTip.value = ''
  editTab.value = 'design'
  editModel.value = {}
  editDataText.value = ''
  editOpen.value = true
}
function openEdit(row: FormRecord): void {
  editId.value = row._id
  editName.value = row.name
  editDesc.value = row.description ?? ''
  editFields.value = normalizeFields(row.fields)
  nameTip.value = ''
  editTab.value = 'design'
  editModel.value = { ...(row.sampleModel ?? {}) }
  editDataText.value = ''
  editOpen.value = true
}

// ── 编辑弹框三态（设计/表单/数据，2026-11-24 口径，类似 EDM 示例）：设计器改字段后，
//    表单 tab 可交互试填；数据 tab 只读 JSON 代码编辑器实时镜像表单数据 ──
const editTab = ref<'design' | 'form' | 'data'>('design')
const editModel = ref<Record<string, unknown>>({})
const editDataText = ref('')
const editControlMap = computed(() => new Map(controls.value.map((c) => [c.key, c.root as FieldDef])))
/** 设计器字段展开复合控件占位（引用失效时回退原字段，不阻断试填） */
const editExpanded = computed<FieldDef[]>(() => {
  try {
    return expandFields(normalizeFields(editFields.value), (key) => editControlMap.value.get(key))
  } catch {
    return normalizeFields(editFields.value)
  }
})
function switchEditTab(mode: 'design' | 'form' | 'data'): void {
  if (mode === editTab.value) return
  if (mode === 'form') editModel.value = applyDefaults(editExpanded.value, { ...editModel.value })
  if (mode === 'data') editDataText.value = JSON.stringify(editModel.value, null, 2)
  editTab.value = mode
}
function onEditFormUpdate(v: Record<string, unknown>): void {
  editModel.value = v
  editDataText.value = JSON.stringify(v, null, 2)
}

/** 前端校验（双层校验第一层）：不过直接停留，不发 IPC */
function frontValidate(): boolean {
  nameTip.value = editName.value.trim() ? '' : '表单名称不能为空'
  if (nameTip.value) return false
  const errors = validateSchema(editFields.value)
  const first = Object.values(errors)[0]
  if (first) {
    ElMessage.error(`字段校验未通过：${first}（请在设计器中修正红字项）`)
    return false
  }
  // 仅「表单」tab 校验输入合法性（设计/数据 tab 不校验，2026-11-24 口径）：
  // 失败停留不发 IPC，具体红字由 FormFieldRenderer 内联展示
  if (editTab.value === 'form') {
    const errs = validateModel(editExpanded.value, editModel.value)
    const firstErr = Object.entries(errs)[0]
    if (firstErr) {
      ElMessage.error(`数据校验未通过：${firstErr[1]}（请修正表单中红字项后再保存）`)
      return false
    }
  }
  return true
}

async function onSave(): Promise<void> {
  if (!frontValidate()) return
  try {
    await host.form.save({
      _id: editId.value ?? undefined,
      name: editName.value.trim(),
      description: editDesc.value.trim() || undefined,
      fields: editFields.value,
      sampleModel: editModel.value,
    })
    editOpen.value = false
    await load()
    ElMessage.success('表单已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ── 删除 / 批量删除（二次确认）──
const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmTargets = ref<string[]>([])
let confirmAction: (() => Promise<void>) | null = null
function askConfirm(title: string, targets: string[], action: () => Promise<void>): void {
  confirmTitle.value = title
  confirmTargets.value = targets
  confirmAction = action
  confirmOpen.value = true
}
async function onConfirmed(): Promise<void> {
  if (confirmAction) await confirmAction()
  confirmAction = null
}
function removeOne(row: FormRecord): void {
  askConfirm('删除表单', [row.name], async () => {
    await host.form.remove({ id: row._id })
    await load()
    ElMessage.success('已删除')
  })
}
function batchRemove(): void {
  if (!selected.value.length) { ElMessage.warning('请先勾选要删除的表单'); return }
  askConfirm('批量删除表单', selected.value.map((r) => r.name), async () => {
    for (const r of selected.value) await host.form.remove({ id: r._id })
    selected.value = []
    await load()
    ElMessage.success('已删除所选表单')
  })
}
function onSelectionChange(list: FormRecord[]): void { selected.value = list }
</script>

<template>
  <ListPageShell :loading="loading || table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="名称 / 描述" style="width: 180px" @keyup.enter="table.search" />
      </div>
      <div class="f-item">
        <span class="f-label">时间</span>
        <el-date-picker
          v-model="table.draft.value.dateRange"
          size="small"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DD HH:mm:ss"
          :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
          style="width: 360px"
        />
      </div>
      <el-button size="small" type="primary" @click="table.search">查询</el-button>
      <el-button size="small" @click="table.reset">重置</el-button>
    </template>

    <template #ops>
      <el-button size="small" type="primary" plain @click="openCreate">新建表单</el-button>
      <el-button size="small" type="danger" plain :disabled="selected.length === 0" @click="batchRemove">批量删除（{{ selected.length }}）</el-button>
    </template>

    <el-table v-if="rows.length > 0" :data="table.data.value" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
      <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column type="selection" width="38" reserve-selection />
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip>
        <template #default="{ row }"><span v-if="row.description">{{ row.description }}</span><span v-else style="opacity:.5">—</span></template>
      </el-table-column>
      <el-table-column label="字段数" width="80" align="center">
        <template #default="{ row }">{{ (row.fields ?? []).length }}</template>
      </el-table-column>
      <el-table-column label="版本" width="64" align="center">
        <template #default="{ row }">v{{ row.version }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="150"><template #default="{ row }"><TimeText :value="row.createdAt" /></template></el-table-column>
      <el-table-column label="更新时间" width="150"><template #default="{ row }"><TimeText :value="row.updatedAt" /></template></el-table-column>
      <el-table-column label="操作" width="130" align="center" fixed="right">
        <template #default="{ row }">
          <div class="op-row">
            <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <EmptyState v-else description="还没有表单定义；新建表单并设计字段，供 EDM 等工具按库取用" action-text="新建表单" @action="openCreate" />

    <!-- 新建/编辑弹框：元信息 + 设计/表单/数据三态（表单可试填 ↔ 数据 JSON 同步） -->
    <el-dialog
      v-model="editOpen"
      class="preview-dialog"
      :title="editing ? '编辑表单' : '新建表单'"
      width="860px"
      top="6vh"
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-width="auto" size="small">
        <el-form-item label="名称" required>
          <div class="field-col">
            <el-input v-model="editName" placeholder="表单名称" />
            <div v-if="nameTip" class="ce-field-tip">{{ nameTip }}</div>
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editDesc" placeholder="用途说明（可选）" />
        </el-form-item>
      </el-form>
      <div class="preview-switch">
        <el-radio-group :model-value="editTab" size="small" @change="(m: unknown) => switchEditTab(m as 'design' | 'form' | 'data')">
          <el-radio-button value="design">设计</el-radio-button>
          <el-radio-button value="form" :disabled="!editFields.length">表单</el-radio-button>
          <el-radio-button value="data">数据</el-radio-button>
        </el-radio-group>
        <span v-if="editTab === 'data'" class="muted" style="font-size: 12px">数据只读；在「表单」tab 试填后自动同步</span>
      </div>
      <div v-show="editTab === 'design'" class="designer-wrap">
        <FieldSchemaDesigner v-model="editFields" :controls="controlOptions" />
      </div>
      <div v-show="editTab === 'form'" class="preview-body" style="height: 440px">
        <FormFieldRenderer
          :fields="editExpanded"
          :model-value="editModel"
          :image-library="library"
          rich-state-key-prefix="forms:"
          :image-field="ImageField"
          polishable
          :polish-loading="aiLoading"
          @polish="onPolish"
          @update:model-value="onEditFormUpdate"
        />
      </div>
      <div v-show="editTab === 'data'" class="preview-data-wrap" style="height: 440px">
        <CodeEditor :model-value="editDataText" language="json" path="form-sample.json" readonly height="100%" />
      </div>
      <template #footer>
        <el-button size="small" @click="editOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <ConfirmDialog v-model:open="confirmOpen" :title="confirmTitle" :targets="confirmTargets" confirm-text="删除" @confirm="onConfirmed" />

    <!-- AI 润色预览（与 EDM SampleForm 同款）：旧/新并排，接受才写回 -->
    <el-dialog
      v-model="polishPreview.open"
      :title="`AI 润色预览 · ${polishPreview.label}（接受才写回）`"
      width="720px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="diff-grid">
        <div>
          <div class="diff-cap">润色前</div>
          <CodeEditor :model-value="polishPreview.before" language="html" height="240px" readonly />
        </div>
        <div>
          <div class="diff-cap">润色后</div>
          <CodeEditor :model-value="polishPreview.after" language="html" height="240px" readonly />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="polishPreview.open = false">放弃</el-button>
        <el-button size="small" type="primary" @click="acceptPolish">接受并写回</el-button>
      </template>
    </el-dialog>

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" />
    </template>
  </ListPageShell>
</template>

<style scoped>
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
.field-col { width: 100%; display: flex; flex-direction: column; gap: 4px; }
.ce-field-tip { font-size: 12px; color: var(--el-color-danger); line-height: 1.4; }
.designer-wrap { height: 440px; display: flex; }
.designer-wrap > * { flex: 1; }
.preview-switch { display: flex; align-items: center; gap: 10px; margin-left: 1px; margin-bottom: 8px; }
.preview-body { height: 60vh; overflow: auto; padding: 4px 2px; box-sizing: border-box; }
.preview-data-wrap { height: 60vh; box-sizing: border-box; }
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.diff-cap { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
</style>

<!-- 弹框内容区尺寸走非 scoped 全局块（teleport 弹框节点样式 scoped 选择器不可靠，项目口径）；
     关键高度同时内联兜底，防 tab 切换弹框高度坍塌 -->
<style>
.preview-dialog .preview-body { height: 60vh; overflow: auto; padding: 4px 2px; box-sizing: border-box; }
.preview-dialog .preview-data-wrap { height: 60vh; box-sizing: border-box; }
</style>
