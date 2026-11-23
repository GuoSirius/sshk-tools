<script setup lang="ts">
/**
 * 控件管理页（plans/13 阶段 C）：复合控件 CRUD。
 * - 分类口径（用户 2026-11-23 定版）：基础=原子控件（17 种 FieldType，设计器内直接用）；
 *   复合=基础控件或已有复合控件组合而成；内置=系统播种只读禁删禁改；自定义=本页增删改查
 * - 列表含 来源（内置/自定义）与 引用计数 列；删除前主进程反查 forms.controlsUsed 拦截
 * - 编辑 = 元信息 + 根容器类型（list/repeater/table）+ 字段设计器（itemFields 可插复合控件引用）
 * - 双层校验：前端 key/label/类型校验不过不发 IPC；后端白名单收口兜底
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState, ConfirmDialog, TimeText, ListPageShell, ListPagination, useTablePage } from '@sshk/ui-kit'
import { FieldSchemaDesigner } from '@sshk/form-schema/ui'
import {
  CONTAINER_TYPES, FIELD_TYPE_LABEL, KEY_RE, KEY_RESERVED,
  type FieldDef, type FieldType,
} from '@sshk/form-schema'
import { inMsRange, type ControlRecord, type FormRecord } from '@sshk/shared'
import { host } from '../host'

const rows = ref<ControlRecord[]>([])
const forms = ref<FormRecord[]>([])
const loading = ref(false)
const selected = ref<ControlRecord[]>([])

const table = useTablePage<ControlRecord, { kw: string; builtinFilter: string; dateRange: [string, string] | null }>({
  fetch: async () => rows.value,
  rowKey: (r) => r._id,
  filters: () => ({ kw: '', builtinFilter: 'all', dateRange: null }),
  clientFilter: (list, f) => {
    const k = f.kw.trim().toLowerCase()
    return list.filter((row) => {
      if (k && !(row.label.toLowerCase().includes(k) || row.key.toLowerCase().includes(k))) return false
      if (f.builtinFilter !== 'all' && (f.builtinFilter === 'builtin') !== row.builtin) return false
      if (!inMsRange(row.updatedAt, f.dateRange?.[0], f.dateRange?.[1])) return false
      return true
    })
  },
  pageSize: 10,
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [cs, fs] = await Promise.all([host.formControl.list(), host.form.list()])
    rows.value = cs
    forms.value = fs
    await table.refresh()
    table.page.value = 1
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(() => { void load() })

/** 引用计数：反查 forms.controlsUsed */
function refCount(key: string): number {
  return forms.value.filter((f) => (f.controlsUsed ?? []).includes(key)).length
}
/** 设计器可插入的复合控件清单：排除自身（其余循环引用由主进程展开校验拦截） */
const controlOptions = computed(() =>
  rows.value.filter((c) => c._id !== editId.value).map((c) => ({ key: c.key, label: c.label })))

// ── 编辑弹框 ──
const editOpen = ref(false)
const editId = ref<string | null>(null)
const editBuiltin = ref(false)
const editLabel = ref('')
const editKey = ref('')
const editDesc = ref('')
const rootType = ref<FieldType>('repeater')
const itemFields = ref<FieldDef[]>([])
const tips = ref<{ label: string; key: string }>({ label: '', key: '' })
const editing = computed(() => Boolean(editId.value))
const viewing = ref(false)
const ROOT_TYPE_OPTIONS: FieldType[] = ['repeater', 'table']

function openCreate(): void {
  editId.value = null
  editBuiltin.value = false
  editLabel.value = ''
  editKey.value = ''
  editDesc.value = ''
  rootType.value = 'repeater'
  itemFields.value = []
  tips.value = { label: '', key: '' }
  viewing.value = false
  editOpen.value = true
}
function openEdit(row: ControlRecord, readonly = false): void {
  editId.value = readonly ? null : row._id
  editBuiltin.value = row.builtin
  editLabel.value = row.label
  editKey.value = row.key
  editDesc.value = row.description ?? ''
  const root = (row.root ?? {}) as FieldDef
  rootType.value = CONTAINER_TYPES.includes(root.type) ? root.type : 'repeater'
  itemFields.value = Array.isArray(root.itemFields) ? root.itemFields : []
  tips.value = { label: '', key: '' }
  viewing.value = readonly
  editOpen.value = true
}

/** 前端校验（双层校验第一层）：不过直接停留，不发 IPC */
function frontValidate(): boolean {
  const label = editLabel.value.trim()
  const key = editKey.value.trim()
  const t: { label: string; key: string } = { label: '', key: '' }
  if (!label) t.label = '控件名称不能为空'
  if (!key) t.key = 'key 不能为空'
  else if (!KEY_RE.test(key) || KEY_RESERVED.has(key)) t.key = 'key 只能含字母/数字/下划线，且不以数字开头'
  else if (rows.value.some((c) => c.key === key && c._id !== editId.value)) t.key = 'key 已存在'
  tips.value = t
  return !t.label && !t.key
}

async function onSave(): Promise<void> {
  if (!frontValidate()) return
  const key = editKey.value.trim()
  try {
    await host.formControl.save({
      _id: editId.value ?? undefined,
      key,
      label: editLabel.value.trim(),
      description: editDesc.value.trim() || undefined,
      root: { key, label: editLabel.value.trim(), type: rootType.value, itemFields: itemFields.value },
    })
    editOpen.value = false
    await load()
    ElMessage.success('控件已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ── 删除 / 批量删除（二次确认；后端另有引用反查拦截）──
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
function removeOne(row: ControlRecord): void {
  if (row.builtin) { ElMessage.warning('内置控件不可删除'); return }
  askConfirm('删除控件', [row.label], async () => {
    await host.formControl.remove({ id: row._id })
    await load()
    ElMessage.success('已删除')
  })
}
function batchRemove(): void {
  const targets = selected.value.filter((r) => !r.builtin)
  if (!targets.length) { ElMessage.warning('请先勾选要删除的自定义控件（内置控件不可删除）'); return }
  askConfirm('批量删除控件', targets.map((r) => r.label), async () => {
    for (const r of targets) await host.formControl.remove({ id: r._id })
    selected.value = []
    await load()
    ElMessage.success('已删除所选控件')
  })
}
function onSelectionChange(list: ControlRecord[]): void { selected.value = list }
</script>

<template>
  <ListPageShell :loading="loading || table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="名称 / key" style="width: 180px" @keyup.enter="table.search" />
      </div>
      <div class="f-item">
        <span class="f-label">来源</span>
        <el-select v-model="table.draft.value.builtinFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="内置" value="builtin" />
          <el-option label="自定义" value="custom" />
        </el-select>
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
      <el-button size="small" type="primary" plain @click="openCreate">新建控件</el-button>
      <el-button size="small" type="danger" plain :disabled="selected.filter((r) => !r.builtin).length === 0" @click="batchRemove">批量删除</el-button>
    </template>

    <el-table v-if="rows.length > 0" :data="table.data.value" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
      <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column type="selection" width="38" reserve-selection :selectable="(row: ControlRecord) => !row.builtin" />
      <el-table-column prop="label" label="名称" min-width="140" show-overflow-tooltip />
      <el-table-column label="key" width="100">
        <template #default="{ row }"><code>{{ row.key }}</code></template>
      </el-table-column>
      <el-table-column label="根类型" width="130" align="center">
        <template #default="{ row }">{{ FIELD_TYPE_LABEL[(row.root as FieldDef)?.type] ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="来源" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.builtin ? 'info' : 'success'" effect="plain">{{ row.builtin ? '内置' : '自定义' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="引用" width="64" align="center">
        <template #default="{ row }">{{ refCount(row.key) }}</template>
      </el-table-column>
      <el-table-column label="版本" width="64" align="center">
        <template #default="{ row }">v{{ row.version }}</template>
      </el-table-column>
      <el-table-column label="描述" min-width="140" show-overflow-tooltip>
        <template #default="{ row }"><span v-if="row.description">{{ row.description }}</span><span v-else style="opacity:.5">—</span></template>
      </el-table-column>
      <el-table-column label="更新时间" width="150"><template #default="{ row }"><TimeText :value="row.updatedAt" /></template></el-table-column>
      <el-table-column label="操作" width="150" align="center" fixed="right">
        <template #default="{ row }">
          <div class="op-row">
            <template v-if="row.builtin">
              <el-button size="small" type="primary" plain @click="openEdit(row, true)">查看</el-button>
              <el-tooltip content="内置控件只读，不可修改或删除">
                <el-button size="small" type="danger" plain disabled>删除</el-button>
              </el-tooltip>
            </template>
            <template v-else>
              <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
            </template>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <EmptyState v-else description="还没有复合控件；新建控件组合基础字段，供表单设计器插入复用" action-text="新建控件" @action="openCreate" />

    <!-- 新建/编辑弹框：元信息 + 根容器类型 + itemFields 设计器（查看态 readonly） -->
    <el-dialog
      v-model="editOpen"
      :title="viewing ? '查看控件（内置）' : editing ? '编辑控件' : '新建控件'"
      width="860px"
      top="6vh"
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-width="auto" size="small">
        <el-form-item label="名称" required>
          <div class="field-col">
            <el-input v-model="editLabel" :disabled="viewing || editBuiltin" placeholder="控件名称" />
            <div v-if="tips.label" class="ce-field-tip">{{ tips.label }}</div>
          </div>
        </el-form-item>
        <el-form-item label="key" required>
          <div class="field-col">
            <el-input v-model="editKey" :disabled="viewing || editBuiltin" placeholder="引用键，如 contact_group" />
            <div v-if="tips.key" class="ce-field-tip">{{ tips.key }}</div>
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editDesc" :disabled="viewing || editBuiltin" placeholder="用途说明（可选）" />
        </el-form-item>
        <el-form-item label="根类型">
          <el-select v-model="rootType" :disabled="viewing || editBuiltin" style="width: 180px">
            <el-option v-for="t in ROOT_TYPE_OPTIONS" :key="t" :label="FIELD_TYPE_LABEL[t]" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="designer-wrap">
        <FieldSchemaDesigner
          :model-value="itemFields"
          :readonly="viewing || editBuiltin"
          :controls="viewing || editBuiltin ? undefined : controlOptions"
          @update:model-value="itemFields = $event"
        />
      </div>
      <template #footer>
        <el-button size="small" @click="editOpen = false">{{ viewing ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!viewing && !editBuiltin" size="small" type="primary" @click="onSave">保存</el-button>
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
.designer-wrap { height: 420px; display: flex; }
.designer-wrap > * { flex: 1; }
</style>
