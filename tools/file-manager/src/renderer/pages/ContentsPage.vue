<script setup lang="ts">
/**
 * 内容管理列表页（plans/11）：8 列 + 行操作 + 顶部批量 + 分享(B/C) + 导出三件套 + 状态机。
 * - 分享状态列：实时反查 shareHub.list()，自己(B)=primary / 公用(C)=warning + 可访问性
 * - 复制链接优先级：本行 B 票存活优先，否则回落 C 公用总链（与海报 copyPosterLink 同构，?ak= 口径）
 * - 危险操作（删除/批量删除/下线/撤回）一律 ConfirmDialog 二次确认
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState, ConfirmDialog, ShareDialog, TimeText, readShareTicket } from '@sshk/ui-kit'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'
import { IPC_CHANNELS, SHARE_PERMANENT_EXPIRES_AT, type ContentRecord, type ContentSaveInput, type ContentStatus, type ShareRouteInfo } from '@sshk/shared'
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

const STATUS_META: Record<ContentStatus, { label: string; type: 'info' | 'success' | 'warning' }> = {
  draft: { label: '草稿', type: 'info' },
  published: { label: '已发布', type: 'success' },
  retracted: { label: '已下线', type: 'warning' },
}

const pagedRows = computed(() => rows.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

/** 编辑器容器形态（plans/11 #8/S4）：dialog=弹框（默认），page=整页。两壳共用 ContentEditorCore。 */
const pageMode = ref(false)
async function loadEditorMode(): Promise<void> {
  try {
    const spec = { group: 'config', method: 'get', channel: IPC_CHANNELS.configGet, label: '读取编辑器形态' } satisfies HostApiSpec
    const mode = await callHostApi<unknown>(spec, 'app.content.editorMode')
    pageMode.value = mode === 'page'
  } catch { pageMode.value = false }
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
    ElMessage.success('已复制本文章的专属链接')
    return
  }
  const common = commonTicket()
  const commonAlive = common && commonRoute()
  if (common && commonAlive && common.urls[0]) {
    await hostClipboard(common.urls[0])
    ElMessage.success('已复制公用总链接（可浏览全部已发布内容）')
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
function openCreate(): void { editRecord.value = null; copySource.value = null; editorOpen.value = true }
function openEdit(row: ContentRecord): void { editRecord.value = row; copySource.value = null; editorOpen.value = true }
function openCopy(row: ContentRecord): void { editRecord.value = null; copySource.value = row; editorOpen.value = true }
async function onSave(input: ContentSaveInput): Promise<void> {
  try {
    await host.content.save(input)
    editorOpen.value = false
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

// ── 状态流转（二次确认：下线/撤回令已发链接从 C 列表消失）──
function changeStatus(row: ContentRecord, status: ContentStatus): void {
  const verb = status === 'published' ? '发布' : '下线'
  askConfirm(`${verb}内容`, [row.name], async () => {
    await host.content.save({ _id: row._id, name: row.name, html: row.html, summary: row.summary, tags: row.tags, status })
    await load()
    ElMessage.success(`已${verb}`)
  }, verb)
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
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openCreate">新建内容</el-button>
      <el-button size="small" type="success" plain @click="openCommonShare">分享内容</el-button>
      <el-divider direction="vertical" />
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
        <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="标签" min-width="130">
          <template #default="{ row }">
            <el-tag v-for="t in (row.tags ?? [])" :key="t" size="small" style="margin-right: 4px">{{ t }}</el-tag>
            <span v-if="!(row.tags ?? []).length" style="opacity:.5">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="wordCount" label="字数" width="80" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }"><el-tag size="small" :type="STATUS_META[row.status as ContentStatus].type">{{ STATUS_META[row.status as ContentStatus].label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }"><TimeText :value="row.createdAt" /></template></el-table-column>
        <el-table-column label="更新时间" width="150"><template #default="{ row }"><TimeText :value="row.updatedAt" /></template></el-table-column>
        <el-table-column label="分享状态" width="170">
          <template #default="{ row }">
            <div class="share-cell">
              <template v-if="shareState(row).type !== 'none'">
                <el-button size="small" type="success" plain @click="copyLink(row)">复制链接</el-button>
                <el-tag size="small" :type="shareState(row).type === 'own' ? 'primary' : 'warning'">{{ shareState(row).type === 'own' ? '自己的' : '公用的' }}</el-tag>
                <el-tag size="small" :type="shareState(row).alive ? 'success' : 'danger'">{{ shareState(row).alive ? '可访问' : '已失效' }}</el-tag>
              </template>
              <el-tag v-else size="small" type="info">未分享</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button size="small" type="primary" plain @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="success" plain @click="openShare(row)">分享</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">删除</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button size="small" plain>更多▾</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="copy">复制（另存为）</el-dropdown-item>
                    <el-dropdown-item command="triple">导出（三件套）</el-dropdown-item>
                    <el-dropdown-item command="html">导出 HTML</el-dropdown-item>
                    <el-dropdown-item command="md">导出 MD</el-dropdown-item>
                    <el-dropdown-item v-if="row.status !== 'published'" command="publish" divided @click="changeStatus(row, 'published')">发布</el-dropdown-item>
                    <el-dropdown-item v-else command="retract" @click="changeStatus(row, 'retracted')">下线</el-dropdown-item>
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
      <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :total="rows.length" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" small />
    </div>

    <ContentEditorDialog v-if="!pageMode" v-model="editorOpen" :record="editRecord" :copy-source="copySource" @save="onSave" />

    <ShareDialog :open="shareOpen" :tool-id="TOOL_ID" :label="shareLabel" :default-root="CONTENT_ROOT" :default-entry="shareEntry" :content-id="shareContentId" route-kind="content" @update:open="shareOpen = $event" @changed="load" />

    <ConfirmDialog v-model:open="confirmOpen" :title="confirmTitle" :targets="confirmTargets" :confirm-text="confirmText" @confirm="onConfirmed" />
    </template>
  </div>
</template>

<style scoped>
/* 页面留白规范（2026-11-19）：根容器四周留白，页内区块用统一间距 token，禁止贴边 */
.contents-page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 0; padding: var(--sshk-page-padding); gap: var(--sshk-gap-sm); }
.toolbar { flex: none; display: flex; gap: var(--sshk-gap-sm); align-items: center; }
.table-wrap { flex: 1; min-height: 0; }
.foot { flex: none; display: flex; justify-content: flex-end; }
.op-row { display: flex; gap: 4px; justify-content: center; align-items: center; }
.op-row .el-button + .el-button { margin-left: 0; }
.share-cell { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.share-cell .el-button + .el-tag { margin-left: 0; }
</style>
