<script setup lang="ts">
/**
 * 内容管理列表页（plans/11）：8 列 + 行操作 + 顶部批量 + 分享(B/C) + 导出三件套 + 状态机。
 * - 分享状态列：实时反查 shareHub.list()，自己(B)=primary / 公用(C)=warning + 可访问性
 * - 复制链接优先级：本行 B 票存活优先，否则回落 C 公用总链（与海报 copyPosterLink 同构，?ak= 口径）
 * - 危险操作（删除/批量删除/下线/撤回）一律 ConfirmDialog 二次确认
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, ConfirmDialog, ShareDialog, TimeText, readShareTicket } from '@sshk/ui-kit'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'
import { IPC_CHANNELS, SHARE_PERMANENT_EXPIRES_AT, inMsRange, type ContentRecord, type ContentSaveInput, type ContentStatus, type ShareRouteInfo } from '@sshk/shared'
import { host } from '../host'
import ContentEditorDialog from './ContentEditorDialog.vue'
import ContentEditorPage from './ContentEditorPage.vue'
import { exportTriple, exportHtml, exportMarkdown } from './content-export'

const TOOL_ID = 'file-manager'
/** content kind 的虚拟 root（内容在 NeDB，无真实目录）；ShareDialog 四元组复用键用得上 */
const CONTENT_ROOT = 'content://contents'
const COMMON_LABEL = '内容：公用总链'

const rows = ref<ContentRecord[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const selected = ref<ContentRecord[]>([])
const routes = ref<ShareRouteInfo[]>([])

const listSpec = { group: 'shareHub', method: 'list', channel: IPC_CHANNELS.shareHubList, label: '分享路由列表' } satisfies HostApiSpec

const STATUS_META: Record<ContentStatus, { label: string; type: 'info' | 'success' | 'warning' | 'primary' }> = {
  draft: { label: '草稿', type: 'info' },
  published: { label: '已发布', type: 'success' },
  scheduled: { label: '定时发布', type: 'primary' },
  retracted: { label: '已下线', type: 'warning' },
}

// ── 列表筛选（2026-11-20 三轮定版：筛选栏统一「查询+重置」两按钮——控件绑草稿态，点查询才生效；重置=清空并立即生效）──
const kw = ref('')
const dateRange = ref<[string, string] | null>(null)
const tagFilter = ref<string[]>([])
const shareFilter = ref<string>('all')
const statusFilter = ref<string>('all')
/** 生效态（真正参与过滤的快照），与草稿态分离 */
const applied = ref({
  kw: '', dateRange: null as [string, string] | null, tagFilter: [] as string[], shareFilter: 'all', statusFilter: 'all',
})
function doSearch(): void {
  applied.value = {
    kw: kw.value.trim(), dateRange: dateRange.value, tagFilter: [...tagFilter.value],
    shareFilter: shareFilter.value, statusFilter: statusFilter.value,
  }
  currentPage.value = 1
}
function resetFilters(): void {
  kw.value = ''; dateRange.value = null; tagFilter.value = []; shareFilter.value = 'all'; statusFilter.value = 'all'
  doSearch()
}
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '定时发布', value: 'scheduled' },
  { label: '已下线', value: 'retracted' },
]
/** 全部标签集合（从现有数据聚合，供多选过滤） */
const allTags = computed(() => {
  const set = new Set<string>()
  for (const r of rows.value) for (const t of r.tags ?? []) set.add(t)
  return [...set]
})
const filteredRows = computed(() => {
  const f = applied.value
  const k = f.kw.toLowerCase()
  return rows.value.filter((row) => {
    if (k && !(row.name.toLowerCase().includes(k) || (row.description ?? '').toLowerCase().includes(k))) return false
    // 时间范围：毫秒闭区间（shared 统一封装，2026-11-20 列表页规范精确到秒）
    if (!inMsRange(row.updatedAt, f.dateRange?.[0], f.dateRange?.[1])) return false
    if (f.tagFilter.length && !(row.tags ?? []).some((t) => f.tagFilter.includes(t))) return false
    if (f.statusFilter !== 'all' && row.status !== f.statusFilter) return false
    if (f.shareFilter !== 'all' && shareState(row).type !== f.shareFilter) return false
    return true
  })
})
watch(filteredRows, () => { currentPage.value = 1 })

const pagedRows = computed(() => filteredRows.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

/** 编辑器容器形态（plans/11 #8/S4）：dialog=弹框（默认），page=整页。两壳共用 ContentEditorCore。
 *  配置属工具级：tools.file-manager.editorMode（工具设置页）；旧键 app.content.editorMode 作回落读取（2026-11-20 迁移）。 */
const pageMode = ref(false)
async function loadEditorMode(): Promise<void> {
  const spec = { group: 'config', method: 'get', channel: IPC_CHANNELS.configGet, label: '读取编辑器形态' } satisfies HostApiSpec
  try {
    const mode = await callHostApi<unknown>(spec, 'tools.file-manager.editorMode')
    pageMode.value = mode === 'page'
  } catch {
    pageMode.value = false
  }
  if (!pageMode.value) {
    try {
      const legacy = await callHostApi<unknown>(spec, 'app.content.editorMode')
      pageMode.value = legacy === 'page'
    } catch { pageMode.value = false }
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [list, rs] = await Promise.all([
      host.content.list(),
      callHostApi<ShareRouteInfo[]>(listSpec, TOOL_ID),
    ])
    rows.value = list
    routes.value = Array.isArray(rs) ? rs : []
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(() => { void load(); void loadEditorMode() })

// ── 分享状态反查 ──
function ownTicket(row: ContentRecord) {
  return readShareTicket(TOOL_ID, `文章：${row.name}`, CONTENT_ROOT, `contents/${row._id}`)
}
function ownRoute(row: ContentRecord): ShareRouteInfo | undefined {
  const t = ownTicket(row)
  return (t && routes.value.find((r) => r.id === t.id && (t.expiresAt === SHARE_PERMANENT_EXPIRES_AT || t.expiresAt > Date.now()))) ?? undefined
}
function commonTicket() {
  return readShareTicket(TOOL_ID, COMMON_LABEL, CONTENT_ROOT, '__list__')
}
function commonRoute(): ShareRouteInfo | undefined {
  const t = commonTicket()
  return (t && routes.value.find((r) => r.id === t.id && (t.expiresAt === SHARE_PERMANENT_EXPIRES_AT || t.expiresAt > Date.now()))) ?? undefined
}
type ShareState = { type: 'own' | 'common' | 'none'; alive: boolean }
function shareState(row: ContentRecord): ShareState {
  const own = ownTicket(row)
  const ownAlive = Boolean(own && ownRoute(row))
  if (own) return { type: 'own', alive: ownAlive }
  const common = commonTicket()
  if (common) return { type: 'common', alive: Boolean(common && commonRoute()) }
  return { type: 'none', alive: false }
}

/** 复制链接：本行 B 票存活优先，否则回落 C 公用总链（B/C 各自 URLs 已带 ?ak=，直接复制） */
async function copyLink(row: ContentRecord): Promise<void> {
  const own = ownTicket(row)
  const ownAlive = own && ownRoute(row)
  if (own && ownAlive && own.urls[0]) {
    await hostClipboard(own.urls[0])
    ElMessage.success('已复制私有链接')
    return
  }
  const common = commonTicket()
  const commonAlive = common && commonRoute()
  if (common && commonAlive && common.urls[0]) {
    await hostClipboard(common.urls[0])
    ElMessage.success('已复制共用总链接（可浏览全部已发布内容）')
    return
  }
  ElMessage.warning('还没有可用分享：点「分享」生成单篇链接，或点顶部「分享内容」生成公用总链')
}
async function hostClipboard(text: string): Promise<void> {
  const spec = { group: 'os', method: 'clipboardWrite', channel: IPC_CHANNELS.osClipboardWrite, label: '复制' } satisfies HostApiSpec
  await callHostApi(spec, text)
}

// ── 编辑弹框 ──
const editorOpen = ref(false)
const editRecord = ref<ContentRecord | null>(null)
const copySource = ref<ContentRecord | null>(null)
/** 编辑弹框最小化态（task 9）：弹框最小化中若用户尝试其它编辑类操作，须二次确认 */
const editorDialogRef = ref<InstanceType<typeof ContentEditorDialog> | null>(null)
const editorMinimized = ref(false)
/** 正在编辑的标题（用于提示），新建=「新内容」 */
const editingLabel = computed(() => editRecord.value?.name ?? copySource.value?.name ?? '新内容')

/** 若编辑弹框处于最小化态，先询问用户：继续编辑 / 执行本次操作（关弹框）/ 取消 */
async function guardWhenMinimized(action: () => void): Promise<void> {
  if (!editorOpen.value || !editorMinimized.value) { action(); return }
  try {
    await ElMessageBox.confirm(
      `「${editingLabel.value}」正在编辑中（已最小化）。是继续编辑，还是执行本次操作？`,
      '有内容正在编辑',
      {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
        confirmButtonText: '执行本次操作', cancelButtonText: '继续编辑', distinguishCancelAndClose: true,
      },
    )
    // 用户选择「执行本次操作」→ 先复原最小化弹框（外部触发重开默认最大化，用户 2026-11-20 口径），再执行
    editorDialogRef.value?.restoreMaximized()
    action()
  } catch {
    // 用户选择「继续编辑」（cancel 分支）→ 同样默认最大化复原，不执行
    editorDialogRef.value?.restoreMaximized()
  }
}
async function openCreate(): Promise<void> { await guardWhenMinimized(() => { editRecord.value = null; copySource.value = null; editorOpen.value = true }) }
async function openEdit(row: ContentRecord): Promise<void> { await guardWhenMinimized(() => { editRecord.value = row; copySource.value = null; editorOpen.value = true }) }
async function openCopy(row: ContentRecord): Promise<void> { await guardWhenMinimized(() => { editRecord.value = null; copySource.value = row; editorOpen.value = true }) }
async function onSave(input: ContentSaveInput): Promise<void> {
  try {
    await host.content.save(input)
    editorOpen.value = false
    editorMinimized.value = false
    await load()
    ElMessage.success('内容已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}

// ── 分享弹框（行级 B / 顶部 C）──
const shareOpen = ref(false)
const shareRow = ref<ContentRecord | null>(null)
const shareIsCommon = ref(false)
function openShare(row: ContentRecord): void { shareRow.value = row; shareIsCommon.value = false; shareOpen.value = true }
function openCommonShare(): void { shareRow.value = null; shareIsCommon.value = true; shareOpen.value = true }
const shareLabel = computed(() => shareIsCommon.value ? COMMON_LABEL : `文章：${shareRow.value?.name ?? ''}`)
const shareEntry = computed(() => shareIsCommon.value ? '__list__' : `contents/${shareRow.value?._id ?? ''}`)
const shareContentId = computed(() => shareIsCommon.value ? undefined : shareRow.value?._id)

// ── 删除 / 批量（二次确认）──
const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmTargets = ref<string[]>([])
const confirmText = ref('删除')
let confirmAction: (() => Promise<void>) | null = null
function askConfirm(title: string, targets: string[], action: () => Promise<void>, text = '删除'): void {
  confirmTitle.value = title
  confirmTargets.value = targets
  confirmText.value = text
  confirmAction = action
  confirmOpen.value = true
}
async function onConfirmed(): Promise<void> {
  if (confirmAction) await confirmAction()
  confirmAction = null
}
function removeOne(row: ContentRecord): void {
  askConfirm('删除内容', [row.name], async () => {
    await host.content.remove({ id: row._id })
    await load()
    ElMessage.success('已删除')
  })
}
function batchRemove(): void {
  if (!selected.value.length) { ElMessage.warning('请先勾选要删除的内容'); return }
  askConfirm('批量删除', selected.value.map((r) => r.name), async () => {
    for (const r of selected.value) await host.content.remove({ id: r._id })
    selected.value = []
    await load()
    ElMessage.success('已删除所选内容')
  }, '批量删除')
}

// ── 状态流转（二次确认：下线令已发链接从 C 列表消失）──
function changeStatus(row: ContentRecord, status: ContentStatus): void {
  const verb = status === 'published' ? '发布' : '下线'
  askConfirm(`${verb}内容`, [row.name], async () => {
    await host.content.save({ _id: row._id, name: row.name, html: row.html, summary: row.summary, description: row.description, tags: row.tags, status })
    await load()
    ElMessage.success(`已${verb}`)
  }, verb)
}

/** 批量发布/下线（2026-11-20 用户补充）：仅对状态允许的目标生效，逐条二次确认走 ConfirmDialog */
function eligibleRows(status: 'published' | 'retracted'): ContentRecord[] {
  return selected.value.filter((r) => r.status !== status)
}
function batchChangeStatus(status: 'published' | 'retracted'): void {
  const targets = eligibleRows(status)
  if (!targets.length) { ElMessage.warning(status === 'published' ? '所选内容均已是发布状态' : '所选内容均已下线'); return }
  const verb = status === 'published' ? '发布' : '下线'
  askConfirm(`批量${verb}`, targets.map((r) => r.name), async () => {
    for (const r of targets) await host.content.save({ _id: r._id, name: r.name, html: r.html, summary: r.summary, description: r.description, tags: r.tags, status })
    selected.value = []
    await load()
    ElMessage.success(`已批量${verb} ${targets.length} 篇内容`)
  }, `批量${verb}`)
}

// ── 导出 ──
function doExport(kind: 'triple' | 'html' | 'md', rowsToExport: ContentRecord[]): void {
  if (!rowsToExport.length) { ElMessage.warning('请先勾选要导出的内容'); return }
  if (kind === 'triple') exportTriple(rowsToExport)
  else if (kind === 'html') exportHtml(rowsToExport)
  else exportMarkdown(rowsToExport)
  ElMessage.success('已开始导出')
}
function onRowCommand(cmd: string, row: ContentRecord): void {
  if (cmd === 'copy') openCopy(row)
  else if (cmd === 'share') openShare(row)
  else if (cmd === 'triple') doExport('triple', [row])
  else if (cmd === 'html') doExport('html', [row])
  else if (cmd === 'md') doExport('md', [row])
}
function onSelectionChange(rows: ContentRecord[]): void { selected.value = rows }
</script>

<template>
  <div class="contents-page">
    <ContentEditorPage
      v-if="pageMode && editorOpen"
      :record="editRecord"
      :copy-source="copySource"
      @save="onSave"
      @cancel="editorOpen = false"
    />
    <template v-else>
    <!-- 筛选栏（2026-11-20 四轮定版：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置） -->
    <div class="filter-bar">
      <div class="f-item">
        <span class="f-label">搜索</span>
        <el-input v-model="kw" size="small" clearable placeholder="标题 / 描述" style="width: 180px" @keyup.enter="doSearch" />
      </div>
      <div class="f-item">
        <span class="f-label">时间</span>
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
      <div class="f-item">
        <span class="f-label">标签</span>
        <el-select v-model="tagFilter" size="small" multiple clearable filterable placeholder="全部" style="width: 180px" collapse-tags collapse-tags-tooltip>
          <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">分享状态</span>
        <el-select v-model="shareFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option label="私有" value="own" />
          <el-option label="共用" value="common" />
          <el-option label="未分享" value="none" />
        </el-select>
      </div>
      <div class="f-item">
        <span class="f-label">发布状态</span>
        <el-select v-model="statusFilter" size="small" style="width: 180px">
          <el-option label="全部" value="all" />
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
      <el-button size="small" type="primary" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <!-- 操作栏：筛选栏下方，居右显示 -->
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openCreate">新建内容</el-button>
      <el-button size="small" type="success" plain @click="openCommonShare">分享内容</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="success" plain :disabled="selected.length === 0 || eligibleRows('published').length === 0" @click="batchChangeStatus('published')">批量发布（{{ eligibleRows('published').length }}）</el-button>
      <el-button size="small" type="warning" plain :disabled="selected.length === 0 || eligibleRows('retracted').length === 0" @click="batchChangeStatus('retracted')">批量下线（{{ eligibleRows('retracted').length }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selected.length === 0" @click="batchRemove">批量删除（{{ selected.length }}）</el-button>
      <el-dropdown trigger="click" :disabled="selected.length === 0" @command="(cmd: string) => doExport(cmd as 'triple' | 'html' | 'md', selected)">
        <el-button size="small" type="warning" plain :disabled="selected.length === 0">批量导出▾</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="triple">导出（三件套 ZIP）</el-dropdown-item>
            <el-dropdown-item command="html">导出 HTML</el-dropdown-item>
            <el-dropdown-item command="md">导出 MD</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="table-wrap" v-loading="loading">
      <el-table v-if="rows.length > 0" :data="pagedRows" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="42" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="38" reserve-selection />
        <el-table-column prop="name" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="标签" min-width="120">
          <template #default="{ row }">
            <div v-if="(row.tags ?? []).length" class="tags-cell">
              <el-tag v-for="t in (row.tags ?? []).slice(0, 2)" :key="t" size="small" style="margin-right: 4px">{{ t }}</el-tag>
              <el-tag v-if="(row.tags ?? []).length > 2" size="small" type="info">+{{ (row.tags ?? []).length - 2 }}</el-tag>
            </div>
            <span v-else style="opacity:.5">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96" align="center">
          <template #default="{ row }">
            <el-tooltip :content="row.status === 'scheduled' && row.publishAt ? `定时发布于 ${row.publishAt}` : ''" :disabled="!(row.status === 'scheduled' && row.publishAt)">
              <el-tag size="small" :type="STATUS_META[row.status as ContentStatus].type">{{ STATUS_META[row.status as ContentStatus].label }}</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }"><TimeText :value="row.createdAt" /></template></el-table-column>
        <el-table-column label="更新时间" width="150"><template #default="{ row }"><TimeText :value="row.updatedAt" /></template></el-table-column>
        <!-- 分享状态列（2026-11-20 定版措辞：共用/私有/未分享）：单 tag 显示类型，点击复制；未分享显示操作入口 -->
        <el-table-column label="分享状态" width="110">
          <template #default="{ row }">
            <div class="share-cell">
              <template v-if="shareState(row).type !== 'none'">
                <el-tooltip :content="shareState(row).type === 'own' ? '私有链接（点击复制）' : '共用总链接（点击复制）'">
                  <el-tag
                    size="small"
                    :type="shareState(row).type === 'own' ? 'primary' : 'warning'"
                    effect="plain"
                    class="share-click"
                    @click="copyLink(row)"
                  >
                    {{ shareState(row).type === 'own' ? '私有' : '共用' }}{{ shareState(row).alive ? '' : '·已失效' }}
                  </el-tag>
                </el-tooltip>
              </template>
              <template v-else>
                <el-button size="small" type="success" plain @click="openShare(row)">分享</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="success" plain @click="copyLink(row)">复制链接</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button size="small" plain>更多▾</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="copy">复制（另存为）</el-dropdown-item>
                    <el-dropdown-item command="share" @click="openShare(row)">分享</el-dropdown-item>
                    <el-dropdown-item command="triple" divided>导出（三件套）</el-dropdown-item>
                    <el-dropdown-item command="html">导出 HTML</el-dropdown-item>
                    <el-dropdown-item command="md">导出 MD</el-dropdown-item>
                    <el-dropdown-item v-if="row.status !== 'published'" command="publish" @click="changeStatus(row, 'published')">发布</el-dropdown-item>
                    <el-dropdown-item v-else-if="row.status !== 'scheduled'" command="retract" @click="changeStatus(row, 'retracted')">下线</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有内容；新建一篇开始写作，可发布并用分享链接给访客阅读" action-text="新建内容" @action="openCreate" />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredRows.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        small
      />
    </div>

    <ContentEditorDialog v-if="!pageMode" ref="editorDialogRef" v-model="editorOpen" :record="editRecord" :copy-source="copySource" @save="onSave" @update:minimized="editorMinimized = $event" />

    <ShareDialog :open="shareOpen" :tool-id="TOOL_ID" :label="shareLabel" :default-root="CONTENT_ROOT" :default-entry="shareEntry" :content-id="shareContentId" route-kind="content" @update:open="shareOpen = $event" @changed="load" />

    <ConfirmDialog v-model:open="confirmOpen" :title="confirmTitle" :targets="confirmTargets" :confirm-text="confirmText" @confirm="onConfirmed" />
    </template>
  </div>
</template>

<style scoped>
/* 页面留白规范（2026-11-19）：根容器四周留白，页内区块用统一间距 token，禁止贴边 */
.contents-page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; padding: var(--sshk-page-padding); gap: var(--sshk-gap-sm); }
.filter-bar { flex: none; display: flex; gap: var(--sshk-gap-sm); align-items: center; flex-wrap: wrap; }
/* #128：查询/重置互相间距与控件一致（归零 EP 兄弟 12px margin 走 gap），查询与控件之间加大间隔 */
.filter-bar .el-button + .el-button { margin-left: 0; }
.filter-bar > .el-button:first-of-type { margin-left: 16px; }
/* label+控件包一体（2026-11-20 用户反馈：换行时不错开），.f-item 内不允许折行 */
.f-item { display: inline-flex; gap: var(--sshk-gap-sm); align-items: center; white-space: nowrap; }
/* 操作栏紧凑口径（2026-11-20 用户反馈：内边距/间距缩小）——归零 EP 兄弟 margin，改用 gap 4px */
.toolbar { flex: none; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.toolbar .el-button + .el-button, .toolbar .el-button + .el-dropdown, .toolbar .el-dropdown + .el-button { margin-left: 0; }
.toolbar .el-button { padding-left: 8px; padding-right: 8px; }
/* 筛选栏 label（2026-11-20 列表页规范：label+控件形式，明确搜索对象） */
.f-label { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; justify-content: flex-end; }
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap; }
.op-row .el-button + .el-button { margin-left: 0; }
.tags-cell { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
/* 分享状态列：单 tag 可点击复制；未分享=分享入口按钮 */
.share-cell { display: flex; gap: 4px; align-items: center; }
.share-click { cursor: pointer; }
</style>
