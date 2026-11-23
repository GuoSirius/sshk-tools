<script setup lang="ts">
/**
 * 表单管理页（plans/13 B1）：表单定义 CRUD + 字段设计器 + 数据预览。
 * - 列表铁律口径：筛选 .f-item（180px/时间 360px datetimerange）、末尾 查询(primary)+重置、
 *   操作栏独立行居右、顺序 筛选栏→操作栏→表格→分页；草稿/生效分离（useTablePage）
 * - 双层校验：前端 validateSchema 不过不发 IPC（停留 + toast）；后端另有白名单收口兜底
 * - 危险操作（删除/批量删除）ConfirmDialog 二次确认
 * - 预览：expandFields 展开复合控件占位后交给 FormFieldRenderer（applyDefaults 补默认值）
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState, ConfirmDialog, TimeText, ListPageShell, ListPagination, useTablePage } from '@sshk/ui-kit'
import { FieldSchemaDesigner, FormFieldRenderer } from '@sshk/form-schema/ui'
import { applyDefaults, expandFields, normalizeFields, validateSchema, type FieldDef } from '@sshk/form-schema'
import { inMsRange, type ControlRecord, type FormRecord } from '@sshk/shared'
import { host } from '../host'

const rows = ref<FormRecord[]>([])
const controls = ref<ControlRecord[]>([])
const loading = ref(false)
const selected = ref<FormRecord[]>([])

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
  editOpen.value = true
}
function openEdit(row: FormRecord): void {
  editId.value = row._id
  editName.value = row.name
  editDesc.value = row.description ?? ''
  editFields.value = normalizeFields(row.fields)
  nameTip.value = ''
  editOpen.value = true
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
    })
    editOpen.value = false
    await load()
    ElMessage.success('表单已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ── 预览弹框（用户 2026-11-24 口径）：固定高度 60vh；表单/数据双 tab；
//    表单可交互（改值实时同步数据 tab）；数据 tab 编辑 JSON，合法即回写表单 ──
const previewOpen = ref(false)
const previewRow = ref<FormRecord | null>(null)
const previewFields = ref<FieldDef[]>([])
const previewModel = ref<Record<string, unknown>>({})
const previewError = ref('')
const previewTab = ref<'form' | 'data'>('form')
const previewDataText = ref('')
const previewDataTip = ref('')

function syncDataText(): void {
  previewDataText.value = JSON.stringify(previewModel.value, null, 2)
  previewDataTip.value = ''
}
function onPreviewFormUpdate(v: Record<string, unknown>): void {
  previewModel.value = v
  syncDataText()
}
function onPreviewDataInput(): void {
  try {
    const parsed = JSON.parse(previewDataText.value) as Record<string, unknown>
    previewModel.value = parsed ?? {}
    previewDataTip.value = ''
  } catch {
    previewDataTip.value = 'JSON 解析失败，修正后自动同步到表单'
  }
}

function openPreview(row: FormRecord): void {
  previewRow.value = row
  previewError.value = ''
  previewTab.value = 'form'
  try {
    const controlMap = new Map(controls.value.map((c) => [c.key, c.root as FieldDef]))
    const expanded = expandFields(normalizeFields(row.fields), (key) => controlMap.get(key))
    previewFields.value = expanded
    previewModel.value = applyDefaults(expanded, { ...(row.sampleModel ?? {}) })
    syncDataText()
  } catch (err) {
    previewError.value = (err as Error).message
    previewFields.value = []
  }
  previewOpen.value = true
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
      <el-table-column label="操作" width="180" align="center" fixed="right">
        <template #default="{ row }">
          <div class="op-row">
            <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="success" plain @click="openPreview(row)">预览</el-button>
            <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <EmptyState v-else description="还没有表单定义；新建表单并设计字段，供 EDM 等工具按库取用" action-text="新建表单" @action="openCreate" />

    <!-- 新建/编辑弹框：元信息 + 字段设计器 -->
    <el-dialog
      v-model="editOpen"
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
      <div class="designer-wrap">
        <FieldSchemaDesigner v-model="editFields" :controls="controlOptions" />
      </div>
      <template #footer>
        <el-button size="small" @click="editOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 预览弹框：展开复合控件后渲染；表单可交互 ↔ 数据 JSON 双向同步 -->
    <el-dialog v-model="previewOpen" :title="`预览：${previewRow?.name ?? ''}`" width="720px" top="6vh" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false">
      <el-alert v-if="previewError" type="error" :title="previewError" :closable="false" />
      <template v-else>
        <div class="preview-switch">
          <el-radio-group v-model="previewTab" size="small">
            <el-radio-button value="form">表单</el-radio-button>
            <el-radio-button value="data">数据</el-radio-button>
          </el-radio-group>
          <span v-if="previewTab === 'data'" class="muted" style="font-size: 12px">编辑 JSON，合法后自动同步到表单</span>
        </div>
        <div v-show="previewTab === 'form'" class="preview-body">
          <FormFieldRenderer :fields="previewFields" :model-value="previewModel" @update:model-value="onPreviewFormUpdate" />
        </div>
        <div v-show="previewTab === 'data'" class="preview-data-wrap">
          <el-input v-model="previewDataText" type="textarea" class="preview-data-input" @input="onPreviewDataInput" />
          <div v-if="previewDataTip" class="ce-field-tip">{{ previewDataTip }}</div>
        </div>
      </template>
    </el-dialog>

    <ConfirmDialog v-model:open="confirmOpen" :title="confirmTitle" :targets="confirmTargets" confirm-text="删除" @confirm="onConfirmed" />

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
.preview-switch { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.preview-body { height: 60vh; overflow: auto; padding: 4px 2px; box-sizing: border-box; }
.preview-data-wrap { height: 60vh; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; }
.preview-data-input { flex: 1; min-height: 0; }
.preview-data-input :deep(.el-textarea__inner) { height: 100%; resize: none; font-family: ui-monospace, Consolas, Menlo, monospace; font-size: 12px; }
</style>
