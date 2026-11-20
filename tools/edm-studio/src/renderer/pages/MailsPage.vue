<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText, ShareDialog, useToolId } from '@sshk/ui-kit'
import { inMsRange } from '@sshk/shared'
import { brands, mails, tplVersionsAll, loadMails } from '../state'
import { api, confirmRemove, osApi, type MailRow } from '../shared'
import MailEditor from '../MailEditor.vue'

/**
 * 邮件管理页（R20，§6.3 拍板语义）：
 * 列表：名称/来源/品牌/模板版本/片段数/生成时间；操作 = 生成 | 导出 | 更多(编辑/复制为新邮件/打开产物/删除)。
 * 编辑走 MailEditor 分步流程；导出 zip 含各形态 html；分享复用局域网 token 通道。
 *
 * 2026-11-20 列表页规范改造：筛选栏（草稿态/生效态分离）→ 操作栏 → 表格 → 分页；
 * 时间范围精确到秒并走 shared inMsRange 闭区间；ShareDialog tool-id 走 provide/inject 单一来源。
 */
const toolId = useToolId()
const editorOpen = ref(false)
const editorMail = ref<MailRow | null>(null)
const mailGenerating = ref('')

// ── 分页（底部分页固定；# 序号跨页连续） ──
const currentPage = ref(1)
const pageSize = ref(10)

// ── 批量选择（翻页不清空：reserve-selection） ──
const selectedMails = ref<MailRow[]>([])
function onSelectionChange(rows: MailRow[]): void { selectedMails.value = rows }

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

// ── 列表筛选（控件=草稿态，点查询才生效；重置=清空并立即生效）──
const kw = ref('')
const originFilter = ref('all')
const brandFilter = ref('all')
const dateRange = ref<[string, string] | null>(null)
const applied = ref({ kw: '', origin: 'all', brand: 'all', dateRange: null as [string, string] | null })
function doSearch(): void {
  applied.value = { kw: kw.value.trim(), origin: originFilter.value, brand: brandFilter.value, dateRange: dateRange.value }
  currentPage.value = 1
}
function resetFilters(): void {
  kw.value = ''
  originFilter.value = 'all'
  brandFilter.value = 'all'
  dateRange.value = null
  doSearch()
}
const brandOptions = computed(() => {
  const map = new Map<string, string>()
  for (const b of brands.value) map.set(b._id, b.name)
  return [...map].map(([value, label]) => ({ value, label }))
})
const filteredMails = computed(() => {
  const f = applied.value
  const k = f.kw.toLowerCase()
  return mails.value.filter((row) => {
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
})
const pagedMails = computed(() => filteredMails.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

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
  if (row.outputs?.final) await osApi().shellOpen(`outputs/edm/${row._id}/final.html`)
}

// ── 导出（单封 .html(final) / 批量 .zip 含各形态 html） ──
async function exportMail(row: MailRow): Promise<void> {
  try {
    if (!row.outputs?.final) { ElMessage.warning('该邮件尚未生成产物'); return }
    const save = await osApi().pickSave({ fileName: `${row.name || 'mail'}.html`, extensions: ['html'] })
    if (!save) return
    const res = (await api('mail:export', { ids: [row._id], outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已导出 ${res.count} 封：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function batchExport(): Promise<void> {
  try {
    const rows = selectedMails.value.filter((row) => row.outputs?.final)
    if (rows.length === 0) { ElMessage.warning('请先勾选已生成产物的邮件'); return }
    const date = new Date().toLocaleDateString('sv-SE')
    const save = await osApi().pickSave({ fileName: `sshk-mails-${date}.zip`, extensions: ['zip'] })
    if (!save) return
    const res = (await api('mail:export', { ids: rows.map((r) => r._id), outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已批量导出 ${res.count} 封（zip 含各形态 html）：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定；危险操作二次确认） */
async function batchRemove(): Promise<void> {
  const rows = selectedMails.value
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

/** 行内「更多」命令分发 */
async function onRowCommand(cmd: string, row: MailRow): Promise<void> {
  if (cmd === 'edit') { openEditor(row); return }
  if (cmd === 'duplicate') { await duplicateMail(row); return }
  if (cmd === 'open') { await openOutput(row); return }
  if (cmd === 'delete') await confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })
}
</script>

<template>
  <div class="mails-page">
    <!-- 筛选栏：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置 -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="kw" size="small" clearable placeholder="名称" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">来源</span>
        <el-select v-model="originFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="系统" value="system" />
          <el-option label="自定义" value="custom" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">品牌</span>
        <el-select v-model="brandFilter" size="small" filterable style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option v-for="b in brandOptions" :key="b.value" :label="b.label" :value="b.value" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">生成时间</span>
        <el-date-picker
          v-model="dateRange"
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
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：单独一行居右，紧凑口径 -->
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openEditor()">新增邮件</el-button>
      <el-button size="small" type="success" plain :disabled="selectedMails.length === 0" @click="batchExport">批量导出（{{ selectedMails.length }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selectedMails.length === 0" @click="batchRemove">批量删除（{{ selectedMails.length }}）</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="success" plain :loading="shareDialog.loading" @click="openShare">分享产物</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-if="filteredMails.length > 0" :data="pagedMails" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
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
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <!-- 操作列约定：实体按钮 ≤3（常用优先），其余一律进「更多」下拉 -->
            <div class="op-row">
              <el-button size="small" type="primary" plain :loading="mailGenerating === row._id" @click="generateMail(row)">生成</el-button>
              <el-button size="small" type="success" plain @click="exportMail(row)">导出</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="duplicate">复制为新邮件</el-dropdown-item>
                    <el-dropdown-item command="open">打开产物</el-dropdown-item>
                    <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState
        v-else
        :description="mails.length === 0 ? '还没有邮件；点「新增邮件」走 名称→来源→品牌→模板→片段布局→数据→生成 的完整流程' : '没有符合条件的邮件，试试调整筛选条件'"
      />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredMails.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        small
      />
      <span class="muted">产物覆盖式（D19）· ShareHub 安全分享（TTL/可撤销）· 导出 zip 含各形态 html</span>
    </div>

    <MailEditor v-model:visible="editorOpen" :mail="editorMail" @saved="onEditorSaved" />

    <!-- 统一分享对话框（plans/09 ShareHub） -->
    <ShareDialog
      v-model:open="shareDialog.open"
      :tool-id="toolId"
      :label="shareDialog.label"
      :default-root="shareDialog.root"
      :default-entry="shareDialog.entry"
    />
  </div>
</template>

<style scoped>
/* 页面留白与区块间距由宿主 .tool-page-body 提供，页面自身不再加 padding（规范） */
.mails-page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; gap: var(--sshk-gap-sm); }
.filter-bar { flex: none; display: flex; gap: var(--sshk-gap-sm); align-items: center; flex-wrap: wrap; }
.filter-bar .el-button + .el-button { margin-left: 0; }
.filter-bar > .el-button:first-of-type { margin-left: 16px; }
.f-item { display: inline-flex; gap: var(--sshk-gap-sm); align-items: center; white-space: nowrap; }
.f-label { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
/* 操作栏紧凑口径：gap 4px + 归零 EP 兄弟 margin + padding 8px */
.toolbar { flex: none; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.toolbar .el-button + .el-button, .toolbar .el-button + .el-divider, .toolbar .el-divider + .el-button { margin-left: 0; }
.toolbar .el-button { padding-left: 8px; padding-right: 8px; }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; align-items: center; justify-content: space-between; }
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
