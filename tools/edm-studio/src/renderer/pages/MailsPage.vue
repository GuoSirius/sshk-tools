<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, TimeText, useTablePage, useToolId } from '@sshk/ui-kit'
import { ShareDialog } from '@sshk/share-core/ui'
import { EDM_OUTPUT_FILES, inMsRange, toFileName } from '@sshk/shared'
import { brands, mails, tplVersionsAll, loadMails } from '../state'
import { api, confirmRemove, osApi, type MailRow } from '../tool-store'
import MailEditor from '../components/MailEditor.vue'

/**
 * 邮件管理页（R20，§6.3 拍板语义）：
 * 列表：名称/来源/品牌/模板版本/片段数/生成时间；操作 = 生成 | 导出 | 更多(编辑/复制为新邮件/打开产物/删除)。
 * 编辑走 MailEditor 分步流程；导出 zip 含各形态 html；分享复用局域网 token 通道。
 *
 * P6-1 收尾（#156）：接 useTablePage（草稿/生效筛选+分页）/ListPageShell/ListPagination/TableOpsColumn
 * 公共组件栈（布局 CSS 全部上收 theme.css .lp-*）；批量勾选单一真相 = useSelection（§七），
 * 批量删除/导出读 selection，删除成功后 prune 防「幽灵计数」。
 * 数据源 = state 单例 mails（shell ensureLoaded / 编辑器 saved 回调里 loadMails），
 * fetch 只回读该 ref，watch 到集合替换后本地 refresh（不再发 IPC，零重复请求）。
 */
const toolId = useToolId()
const editorOpen = ref(false)
const editorMail = ref<MailRow | null>(null)
const mailGenerating = ref('')

// ── 列表状态（P6-1：useTablePage 统一承载 草稿/生效筛选 + 客户端分页）──
const table = useTablePage<MailRow, { kw: string; origin: string; brand: string; dateRange: [string, string] | null }>({
  // 数据源：state.loadMails 写入 mails 单例；fetch 直返镜像（客户端过滤/分页由本组件承载，无 IPC）
  fetch: async () => mails.value,
  rowKey: (r) => r._id,
  filters: () => ({ kw: '', origin: 'all', brand: 'all', dateRange: null }),
  clientFilter: (list, f) => {
    const k = f.kw.trim().toLowerCase()
    return list.filter((row) => {
      if (k && !row.name.toLowerCase().includes(k)) return false
      if (f.origin !== 'all' && (row.origin ?? 'custom') !== f.origin) return false
      if (f.brand !== 'all' && row.brandId !== f.brand) return false
      // 时间范围：毫秒闭区间（shared 统一封装，规范精确到秒）；限定范围时未生成邮件不参与
      if (f.dateRange) {
        if (!row.lastGeneratedAt) return false
        if (!inMsRange(row.lastGeneratedAt, f.dateRange[0], f.dateRange[1])) return false
      }
      return true
    })
  },
  selection: true,
})
const rowKey = table.rowKey
const selection = table.selection!
// 集合被 loadMails 整体替换时本地重切分页（fetch 无 IPC，零重复请求），并清理已不存在的勾选
watch(mails, () => {
  void table.refresh().then(() => selection.prune(new Set(mails.value.map(rowKey))))
})

/** 批量勾选单一真相 = useSelection（§七）：el-table selection-change 全量同步（reserve-selection 跨页保留） */
function syncSelection(tableRows: MailRow[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

function brandLabel(brandId: string): string {
  const b = brands.value.find((x) => x._id === brandId)
  return b ? b.name : brandId.slice(0, 10) + '…'
}
function tplLabel(id: string): string {
  const v = tplVersionsAll.value.find((t) => t._id === id)
  return v ? (v.label ?? `v${v.version}`) : id.slice(0, 12) + '…'
}
function placementCount(row: MailRow): number {
  return row.bindings?.length ?? 0
}

const brandOptions = computed(() => {
  const map = new Map<string, string>()
  for (const b of brands.value) map.set(b._id, b.name)
  return [...map].map(([value, label]) => ({ value, label }))
})

function openEditor(row?: MailRow): void {
  editorMail.value = row ?? null
  editorOpen.value = true
}

async function onEditorSaved(): Promise<void> {
  await loadMails()
}

async function generateMail(row: MailRow): Promise<void> {
  mailGenerating.value = row._id
  try {
    await api('mail:generate', { _id: row._id })
    await loadMails()
    ElMessage.success('三阶段产物已生成（覆盖式）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { mailGenerating.value = '' }
}

/** 复制为新邮件（§6.3）：以此为参考深拷一份，简单修改即成新邮件 */
async function duplicateMail(row: MailRow): Promise<void> {
  try {
    await api('mail:save', {
      name: `${row.name} 副本`,
      origin: 'custom',
      brandId: row.brandId,
      templateVersionId: row.templateVersionId,
      bindings: row.bindings ?? [],
      data: row.data ?? {},
    })
    await loadMails()
    ElMessage.success('已复制为新邮件，可编辑后生成')
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function openOutput(row: MailRow): Promise<void> {
  if (row.outputs?.final) await osApi().shellOpen(`outputs/edm/${row._id}/${EDM_OUTPUT_FILES.final}`)
}

// ── 导出（单封 .html(final) / 批量 .zip 含各形态 html）──
async function exportMail(row: MailRow): Promise<void> {
  try {
    if (!row.outputs?.final) { ElMessage.warning('该邮件尚未生成产物'); return }
    const save = await osApi().pickSave({ fileName: `${row.name || 'mail'}.html`, extensions: ['html'] })
    if (!save) return
    const res = (await api('mail:export', { ids: [row._id], outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已导出 ${res.count} 封：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 勾选单一真相（§七）：从 useSelection 反查行集合；已生成产物者才可导出 */
function selectedRows(): MailRow[] {
  return mails.value.filter((m) => selection.has(m._id))
}

async function batchExport(): Promise<void> {
  try {
    const rows = selectedRows().filter((row) => row.outputs?.final)
    if (rows.length === 0) { ElMessage.warning('请先勾选已生成产物的邮件'); return }
    const date = toFileName()
    const save = await osApi().pickSave({ fileName: `sshk-mails-${date}.zip`, extensions: ['zip'] })
    if (!save) return
    const res = (await api('mail:export', { ids: rows.map((r) => r._id), outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已批量导出 ${res.count} 封（zip 含各形态 html）：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定；危险操作二次确认）；删除后 prune 清理失效勾选（§七） */
async function batchRemove(): Promise<void> {
  const rows = selectedRows()
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的邮件'); return }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${rows.length} 封邮件？记录将归档。`, '批量删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
    })
  } catch { return }
  for (const row of rows) await api('mail:remove', { _id: row._id })
  await loadMails()
  ElMessage.success(`已删除 ${rows.length} 封邮件`)
}

// ── 分享（plans/09 ShareHub）：工具只解析产物根目录，分享本体交给宿主 ShareHub + ShareDialog ──
const shareDialog = reactive({ open: false, root: '', entry: '', label: '邮件产物', loading: false })
async function openShare(): Promise<void> {
  shareDialog.loading = true
  try {
    const resolved = await api('share:resolve') as { root: string; entry: string; label: string }
    Object.assign(shareDialog, { open: true, root: resolved.root, entry: resolved.entry, label: resolved.label })
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { shareDialog.loading = false }
}

// ── 操作列（TableOpsColumn：≤3 内联 + 更多下拉；语义配色 §2.5）──
// 行内「生成」的 per-row loading 态以 disabled 兜底（TableOpsColumn 无 per-row loading；
// 生成期间禁用全部行生成按钮防并发，完成即恢复）。
const ops = computed(() => [
  { key: 'generate', label: '生成', type: 'primary' as const, disabled: mailGenerating.value !== '' },
  { key: 'export', label: '导出', type: 'success' as const },
])
const moreOps = [
  { key: 'edit', label: '编辑', type: 'primary' as const },
  { key: 'duplicate', label: '复制为新邮件', type: 'success' as const },
  { key: 'copyCode', label: '复制代码', type: 'warning' as const },
  { key: 'open', label: '打开产物', type: 'info' as const },
  { key: 'delete', label: '删除', type: 'danger' as const },
]

// ── 复制代码（F-03，requirement.txt：复制渲染/juice/压缩后的最终代码）──
// 三形态选择弹框：assembled=组合原始 / inlined=内联资源 / final=juice 压缩（邮件发送形态）
const COPY_FORMS = [
  { value: 'assembled', label: '原始组合（assembled）' },
  { value: 'inlined', label: '内联资源（inlined）' },
  { value: 'final', label: '压缩最终（final）' },
] as const
const copyCode = reactive({ open: false, mail: null as MailRow | null, form: 'final' as (typeof COPY_FORMS)[number]['value'], loading: false })
function openCopyCode(row: MailRow): void {
  if (!row.outputs?.final) { ElMessage.warning('尚未生成产物，请先「生成」'); return }
  Object.assign(copyCode, { open: true, mail: row, form: 'final' })
}
async function doCopyCode(): Promise<void> {
  if (!copyCode.mail) return
  copyCode.loading = true
  try {
    const html = await api<string>('mail:readOutput', { _id: copyCode.mail._id, form: copyCode.form })
    await osApi().clipboardWrite(html)
    ElMessage.success(`已复制${COPY_FORMS.find((f) => f.value === copyCode.form)?.label ?? ''}代码（${html.length} 字符）`)
    copyCode.open = false
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { copyCode.loading = false }
}

function onAction(key: string, row: MailRow): void {
  if (key === 'generate') void generateMail(row)
  else if (key === 'export') void exportMail(row)
  else if (key === 'edit') openEditor(row)
  else if (key === 'duplicate') void duplicateMail(row)
  else if (key === 'copyCode') openCopyCode(row)
  else if (key === 'open') void openOutput(row)
  else if (key === 'delete') void confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })
}
</script>

<template>
  <ListPageShell flush :loading="table.loading.value">
    <template #filter>
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="table.draft.value.kw" size="small" clearable placeholder="名称" style="width: 180px" @keyup.enter="table.search" />
      </div>
      <div class="f-item">
        <span class="f-label">来源</span>
        <el-select v-model="table.draft.value.origin" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="系统" value="system" />
          <el-option label="自定义" value="custom" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">品牌</span>
        <el-select v-model="table.draft.value.brand" size="small" filterable style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option v-for="b in brandOptions" :key="b.value" :label="b.label" :value="b.value" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">生成时间</span>
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
      <el-button size="small" type="success" plain :disabled="selection.count.value === 0" @click="batchExport">批量导出（{{ selection.count.value }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selection.count.value === 0" @click="batchRemove">批量删除（{{ selection.count.value }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="primary" plain @click="openEditor()">新增邮件</el-button>
      <el-button size="small" type="success" plain :loading="shareDialog.loading" @click="openShare">分享产物</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
      <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column type="selection" width="40" reserve-selection />
      <el-table-column prop="name" label="邮件" min-width="140" show-overflow-tooltip />
      <el-table-column label="来源" width="76" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.origin === 'system' ? 'warning' : 'info'">{{ row.origin === 'system' ? '系统' : '自定义' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="品牌" width="120" show-overflow-tooltip>
        <template #default="{ row }"><span class="muted">{{ brandLabel(row.brandId) }}</span></template>
      </el-table-column>
      <el-table-column label="模板版本" width="110">
        <template #default="{ row }"><span class="muted">{{ tplLabel(row.templateVersionId) }}</span></template>
      </el-table-column>
      <el-table-column label="片段" width="60" align="center">
        <template #default="{ row }"><span class="muted">{{ placementCount(row) }}</span></template>
      </el-table-column>
      <el-table-column label="生成时间" width="150">
        <template #default="{ row }"><TimeText :value="row.lastGeneratedAt" placeholder="未生成" /></template>
      </el-table-column>
      <TableOpsColumn :actions="ops" :more="moreOps" width="220" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as MailRow)" />
    </el-table>
    <EmptyState
      v-else
      :description="mails.length === 0 ? '还没有邮件；点「新增邮件」走 名称→来源→品牌→模板→片段布局→数据→生成 的完整流程' : '没有符合条件的邮件，试试调整筛选条件'"
    />

    <template #footer>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" :page-sizes="[10, 20, 50]" />
      <span class="muted foot-hint">产物覆盖式（D19）· ShareHub 安全分享（TTL/可撤销）· 导出 zip 含各形态 html</span>
    </template>

    <!-- 编辑器与分享弹框（el-dialog teleport 到 body，锚点留在表格区无视觉影响） -->
    <MailEditor v-model:visible="editorOpen" :mail="editorMail" @saved="onEditorSaved" />
    <ShareDialog
      v-model:open="shareDialog.open"
      :tool-id="toolId"
      :label="shareDialog.label"
      :default-root="shareDialog.root"
      :default-entry="shareDialog.entry"
    />
    <!-- 复制代码弹框（F-03：三形态选择，写入剪贴板） -->
    <el-dialog v-model="copyCode.open" title="复制邮件代码" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-radio-group v-model="copyCode.form">
        <el-radio v-for="f in COPY_FORMS" :key="f.value" :value="f.value">{{ f.label }}</el-radio>
      </el-radio-group>
      <p class="muted" style="margin-top: 8px">取「{{ copyCode.mail?.name ?? '' }}」当前已生成的产物代码写入剪贴板。</p>
      <template #footer>
        <el-button @click="copyCode.open = false">取消</el-button>
        <el-button type="primary" :loading="copyCode.loading" @click="doCopyCode">复制</el-button>
      </template>
    </el-dialog>
  </ListPageShell>
</template>

<style scoped>
.muted { opacity: 0.6; font-size: 12px; }
/* footer 提示语推到最左（.lp-foot 默认居右）：等价旧 space-between 布局 */
.foot-hint { margin-right: auto; }
</style>
