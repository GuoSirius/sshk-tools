<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, ListPageShell, ListPagination, TableOpsColumn, TimeText, useTablePage, useToolId } from '@sshk/ui-kit'
import { ShareDialog } from '@sshk/share-core/ui'
import { readShareTicket, isTicketAlive } from '@sshk/share-core/ui'
import { inMsRange, toFileName } from '@sshk/shared'
import { brands, mails, templates, tplVersionsAll, loadMails } from '../store'
import { api, confirmRemove, osApi, type MailRow } from '../tool-api'
import ComposeDialog from '../components/ComposeDialog.vue'

/**
 * 邮件管理页（2026-11-25 重构）：
 * 表格 9 列（邮件名/操作固定列），行操作 6 项（内联 分享/编辑/组装，更多 导出/另存为/删除）。
 * 新增/编辑只填邮件名（去分步），确认后新邮件自动进组装弹框（Q3）；组装/预览/导出/复制统一走 ComposeDialog。
 * 分享：顶层=所有列表项（root=outputs），行级=每封独立 root（Q5）；分享状态区分顶层/行级并可复制链接。
 * 导出四形态：template（模板源码）/assembled/inlined/final，单封与批量均以邮件名为目录打 zip（修订 14）。
 */
const toolId = useToolId()
const editorOpen = ref(false)
const editorMail = ref<MailRow | null>(null)

// ── 列表状态（useTablePage 统一承载筛选+分页）──
const table = useTablePage<MailRow, { kw: string; origin: string; brand: string; dateRange: [string, string] | null }>({
  fetch: async () => mails.value,
  rowKey: (r) => r._id,
  filters: () => ({ kw: '', origin: 'all', brand: 'all', dateRange: null }),
  clientFilter: (list, f) => {
    const k = f.kw.trim().toLowerCase()
    return list.filter((row) => {
      if (k && !row.name.toLowerCase().includes(k)) return false
      if (f.origin !== 'all' && (row.origin ?? 'custom') !== f.origin) return false
      if (f.brand !== 'all' && row.brandId !== f.brand) return false
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
watch(mails, () => {
  void table.refresh().then(() => selection.prune(new Set(mails.value.map(rowKey))))
})
function syncSelection(tableRows: MailRow[]): void {
  selection.clear()
  selection.selectMany(tableRows.map(rowKey))
}

function brandLabel(brandId: string): string {
  const b = brands.value.find((x) => x._id === brandId)
  return b ? b.name : brandId.slice(0, 10) + '…'
}
function tplVersionLabel(tvId: string): string {
  const v = tplVersionsAll.value.find((t) => t._id === tvId)
  return v ? (v.label ?? `v${v.version}`) : tvId.slice(0, 12) + '…'
}
function tplName(tvId: string): string {
  const v = tplVersionsAll.value.find((t) => t._id === tvId)
  return v ? (templates.value.find((t) => t._id === v.templateId)?.name ?? '—') : '—'
}

const brandOptions = computed(() => {
  const map = new Map<string, string>()
  for (const b of brands.value) map.set(b._id, b.name)
  return [...map].map(([value, label]) => ({ value, label }))
})

// ── 新增/编辑：只填邮件名（去分步）──
const nameDialog = reactive({ open: false, editing: null as MailRow | null, name: '', saving: false })
function openEditor(row?: MailRow): void {
  if (row) {
    // 编辑：只改名，确认后回列表
    Object.assign(nameDialog, { open: true, editing: row, name: row.name })
  } else {
    Object.assign(nameDialog, { open: true, editing: null, name: '' })
  }
}
async function onNameConfirm(): Promise<void> {
  const name = nameDialog.name.trim()
  if (!name) { ElMessage.warning('邮件名称必填'); return }
  nameDialog.saving = true
  try {
    if (nameDialog.editing) {
      // 改名走独立通道：不碰 bindings/品牌，跨品牌校验只在组装环节（#198 ②）
      await api('mail:rename', { _id: nameDialog.editing._id, name })
      await loadMails()
      nameDialog.open = false
      ElMessage.success('邮件名称已更新')
    } else {
      // 新增：只建空白邮件（brandId/templateVersionId 由组装弹框内选），确认后自动进组装（Q3）
      const created = (await api('mail:save', { name, origin: 'custom', brandId: '', templateVersionId: '', bindings: [], data: {} })) as MailRow
      await loadMails()
      nameDialog.open = false
      editorMail.value = created
      editorOpen.value = true
    }
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { nameDialog.saving = false }
}

/** 组装弹框 saved 回调：刷新列表（新建邮件在弹框内选品牌/模板后落库） */
async function onEditorSaved(): Promise<void> {
  await loadMails()
}

/** 另存为（§4.6）：以某邮件为基础新建，确认后打开组装弹框快速修改 */
const saveAsDialog = reactive({ open: false, source: null as MailRow | null, name: '', saving: false })
function openSaveAs(row: MailRow): void {
  Object.assign(saveAsDialog, { open: true, source: row, name: `${row.name} 副本`, saving: false })
}
async function onSaveAsConfirm(): Promise<void> {
  const name = saveAsDialog.name.trim()
  if (!name) { ElMessage.warning('名称必填'); return }
  const src = saveAsDialog.source
  if (!src) return
  saveAsDialog.saving = true
  try {
    const created = (await api('mail:save', {
      name, origin: src.origin ?? 'custom', brandId: src.brandId, templateVersionId: src.templateVersionId,
      bindings: src.bindings ?? [], data: src.data ?? {},
    })) as MailRow
    await loadMails()
    saveAsDialog.open = false
    editorMail.value = created
    editorOpen.value = true
    ElMessage.success('已另存为新邮件，可快速修改')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saveAsDialog.saving = false }
}

// ── 导出（单封/批量统一 zip，每封目录含四形态）──
async function exportMail(row: MailRow): Promise<void> {
  try {
    if (!row.outputs?.final) { ElMessage.warning('该邮件尚未生成产物'); return }
    const save = await osApi().pickSave({ fileName: `${row.name || 'mail'}.zip`, extensions: ['zip'] })
    if (!save) return
    const res = (await api('mail:export', { ids: [row._id], outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已导出 ${res.count} 封（含四形态）：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}
function selectedRows(): MailRow[] {
  return mails.value.filter((m) => selection.has(m._id))
}
async function batchExport(): Promise<void> {
  try {
    const rows = selectedRows().filter((row) => row.outputs?.final)
    if (rows.length === 0) { ElMessage.warning('请先勾选已生成产物的邮件'); return }
    const save = await osApi().pickSave({ fileName: `sshk-mails-${toFileName()}.zip`, extensions: ['zip'] })
    if (!save) return
    const res = (await api('mail:export', { ids: rows.map((r) => r._id), outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已批量导出 ${res.count} 封（zip 含四形态）：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}
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

// ── 分享：顶层=所有列表项；行级=每封独立 root（Q5）──
const shareDialog = reactive({ open: false, root: '', entry: '', label: '邮件产物', loading: false, mailId: '' })
let topRoot = ''
async function resolveTopRoot(): Promise<string> {
  if (topRoot) return topRoot
  try {
    const resolved = (await api('share:resolve')) as { root: string }
    topRoot = resolved.root
  } catch { topRoot = '' }
  return topRoot
}
async function openShare(row?: MailRow): Promise<void> {
  shareDialog.loading = true
  try {
    const resolved = (await api('share:resolve', row ? { mailId: row._id } : {})) as { root: string; entry: string; label: string }
    Object.assign(shareDialog, { open: true, root: resolved.root, entry: resolved.entry, label: resolved.label, mailId: row?._id ?? '' })
    if (!row) topRoot = resolved.root
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { shareDialog.loading = false }
}
/** 分享状态：未分享 / 已分享(顶层) / 已分享(行级)；按四元组键读票（顶层 label=邮件产物，行级=单封邮件产物） */
function shareState(row: MailRow): 'none' | 'top' | 'row' {
  const root = topRoot
  if (!root) return 'none'
  const top = readShareTicket(toolId.value, '邮件产物', root, '')
  const own = readShareTicket(toolId.value, '单封邮件产物', `${root}/${row._id}`, '')
  if (isTicketAlive(own)) return 'row'
  if (isTicketAlive(top)) return 'top'
  return 'none'
}
function copyShareLink(row: MailRow): void {
  const root = topRoot
  if (!root) { ElMessage.warning('请先生成邮件产物'); return }
  const ticket = readShareTicket(toolId.value, '单封邮件产物', `${root}/${row._id}`, '')
    ?? readShareTicket(toolId.value, '邮件产物', root, '')
  if (!ticket?.urls?.length) { ElMessage.warning('该邮件尚无有效分享链接'); return }
  void osApi().clipboardWrite(ticket.urls[0]!)
  ElMessage.success('分享链接已复制')
}
onMounted(() => {
  void resolveTopRoot()
  // 菜单切换（内容管理↔邮件管理）会重挂载本页：store 的 ensureLoaded 有 loaded 标记只跑一次，
  // 数据不会自动刷新，这里每次挂载都拉一次列表保证最新
  void loadMails()
})
watch(mails, () => { void resolveTopRoot() })

// ── 操作列（内联 ≤3：分享/编辑/组装；更多：导出/另存为/删除）──
const ops = computed(() => [
  { key: 'share', label: '分享', type: 'success' as const },
  { key: 'edit', label: '编辑', type: 'primary' as const },
  { key: 'compose', label: '组装', type: 'primary' as const },
])
const moreOps = [
  { key: 'export', label: '导出', type: 'warning' as const },
  { key: 'saveAs', label: '另存为', type: 'warning' as const },
  { key: 'delete', label: '删除', type: 'danger' as const },
]
function onAction(key: string, row: MailRow): void {
  if (key === 'share') void openShare(row)
  else if (key === 'edit') openEditor(row)
  else if (key === 'compose') { editorMail.value = row; editorOpen.value = true }
  else if (key === 'export') void exportMail(row)
  else if (key === 'saveAs') openSaveAs(row)
  else if (key === 'delete') void confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })
}
</script>

<template>
  <ListPageShell flush :loading="table.loading.value">
    <template #filter>
      <div class="f-item"><span class="f-label">搜索</span><el-input v-model="table.draft.value.kw" size="small" clearable placeholder="名称" style="width: 180px" @keyup.enter="table.search" /></div>
      <div class="f-item"><span class="f-label">来源</span><el-select v-model="table.draft.value.origin" size="small" style="width: 180px"><el-option label="全部" value="all" /><el-option label="系统" value="system" /><el-option label="自定义" value="custom" /></el-select></div>
      <div class="f-item"><span class="f-label">品牌</span><el-select v-model="table.draft.value.brand" size="small" filterable style="width: 180px"><el-option label="全部" value="all" /><el-option v-for="b in brandOptions" :key="b.value" :label="b.label" :value="b.value" /></el-select></div>
      <div class="f-item"><span class="f-label">生成时间</span><el-date-picker v-model="table.draft.value.dateRange" size="small" type="datetimerange" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" value-format="YYYY-MM-DD HH:mm:ss" :default-time="[new Date(2000,0,1,0,0,0), new Date(2000,0,1,23,59,59)]" style="width: 360px" /></div>
      <el-button size="small" type="primary" @click="table.search">查询</el-button>
      <el-button size="small" @click="table.reset">重置</el-button>
    </template>

    <template #ops>
      <el-button size="small" type="warning" plain :disabled="selection.count.value === 0" @click="batchExport">批量导出（{{ selection.count.value }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selection.count.value === 0" @click="batchRemove">批量删除（{{ selection.count.value }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="primary" plain @click="openEditor()">新增邮件</el-button>
      <el-button size="small" type="success" plain :loading="shareDialog.loading" @click="openShare()">分享产物</el-button>
    </template>

    <el-table v-if="table.data.value.length > 0" :data="table.data.value" size="small" height="100%" :row-key="rowKey" @selection-change="syncSelection">
      <el-table-column type="index" label="#" width="46" align="center" fixed="left" :index="(i: number) => (table.page.value - 1) * table.pageSize.value + i + 1" />
      <el-table-column type="selection" width="40" reserve-selection fixed="left" />
      <el-table-column prop="name" label="邮件名" min-width="140" fixed="left" show-overflow-tooltip />
      <el-table-column label="来源" width="76" align="center"><template #default="{ row }"><el-tag size="small" :type="row.origin === 'system' ? 'warning' : 'info'">{{ row.origin === 'system' ? '系统' : '自定义' }}</el-tag></template></el-table-column>
      <el-table-column label="品牌" width="120" show-overflow-tooltip><template #default="{ row }"><span class="muted">{{ brandLabel(row.brandId) }}</span></template></el-table-column>
      <el-table-column label="模板" width="120" show-overflow-tooltip><template #default="{ row }"><span class="muted">{{ tplName(row.templateVersionId) }}</span></template></el-table-column>
      <el-table-column label="版本" width="80"><template #default="{ row }"><span class="muted">{{ tplVersionLabel(row.templateVersionId) }}</span></template></el-table-column>
      <el-table-column label="生成时间" width="150"><template #default="{ row }"><TimeText :value="row.lastGeneratedAt" placeholder="未生成" /></template></el-table-column>
      <el-table-column label="更新时间" width="150"><template #default="{ row }"><TimeText :value="row.updatedAt" placeholder="—" /></template></el-table-column>
      <el-table-column label="分享状态" width="120" align="center">
        <template #default="{ row }">
          <!-- 未分享=tag；已分享=直接给「复制链接」，颜色+tip 区分公用(顶层·蓝)/私有(行级·橙) -->
          <el-tag v-if="shareState(row) === 'none'" size="small" type="info" effect="plain">未分享</el-tag>
          <el-tooltip
            v-else
            :content="shareState(row) === 'top' ? '公用分享：全部邮件共用一个链接' : '私有分享：仅本封邮件的独立链接'"
            placement="top"
          >
            <el-button size="small" text :type="shareState(row) === 'top' ? 'primary' : 'warning'" @click="copyShareLink(row)">复制链接</el-button>
          </el-tooltip>
        </template>
      </el-table-column>
      <TableOpsColumn :actions="ops" :more="moreOps" width="180" fixed="right" @action="(key: string, row: Record<string, unknown>) => onAction(key, row as unknown as MailRow)" />
    </el-table>
    <EmptyState v-else :description="mails.length === 0 ? '还没有邮件；点「新增邮件」填名称后进入组装' : '没有符合条件的邮件，试试调整筛选条件'" />

    <template #footer>
      <span class="muted foot-hint">产物覆盖式 · ShareHub 安全分享（TTL/可撤销）· 导出 zip 含四形态</span>
      <ListPagination v-model:page="table.page.value" v-model:pageSize="table.pageSize.value" :total="table.total.value" />
    </template>

    <!-- 统一组装弹框（scene=mail） -->
    <ComposeDialog v-model:visible="editorOpen" scene="mail" :mail="editorMail" @saved="onEditorSaved" />

    <!-- 新增/编辑邮件名弹框 -->
    <el-dialog v-model="nameDialog.open" :title="nameDialog.editing ? '编辑邮件名' : '新增邮件'" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto"><el-form-item label="邮件名" required><el-input v-model="nameDialog.name" clearable placeholder="邮件名称" @keyup.enter="onNameConfirm" /></el-form-item></el-form>
      <template #footer><el-button @click="nameDialog.open = false">取消</el-button><el-button type="primary" :loading="nameDialog.saving" @click="onNameConfirm">确认</el-button></template>
    </el-dialog>

    <!-- 另存为弹框 -->
    <el-dialog v-model="saveAsDialog.open" title="另存为新邮件" width="420px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto"><el-form-item label="新邮件名" required><el-input v-model="saveAsDialog.name" clearable placeholder="新邮件名称" /></el-form-item></el-form>
      <p class="muted">将以「{{ saveAsDialog.source?.name ?? '' }}」的模板/片段/数据为基础复制，确认后进入组装快速修改。</p>
      <template #footer><el-button @click="saveAsDialog.open = false">取消</el-button><el-button type="primary" :loading="saveAsDialog.saving" @click="onSaveAsConfirm">确认</el-button></template>
    </el-dialog>

    <!-- 分享弹框 -->
    <ShareDialog v-model:open="shareDialog.open" :tool-id="toolId" :label="shareDialog.label" :default-root="shareDialog.root" :default-entry="shareDialog.entry" />
  </ListPageShell>
</template>

<style scoped>
.muted { opacity: 0.6; font-size: 12px; }
.foot-hint { margin-right: auto; margin-top: 6px; }
</style>
