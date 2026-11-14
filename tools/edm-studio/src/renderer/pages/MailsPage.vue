<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { mails, tplVersions, loadMails } from '../state'
import { api, confirmRemove, type MailRow } from '../shared'

/**
 * 邮件管理页（表格/操作/弹框约定）：
 * 三段式 + # 跨页序号 + 选择列(reserve) + 批量导出/删除 + 操作列 ≤3 按钮、其余进「更多」。
 * 导出：单封 .html / 批量 .zip（os.pickSave 选路径，main mail:export 落盘）；分享：局域网 token。
 */
const mailOpen = ref(false)
const mailForm = ref<{ _id: string; name: string; templateVersionId: string; bindingsText: string; dataText: string }>({ _id: '', name: '', templateVersionId: '', bindingsText: '', dataText: '{}' })
const mailGenerating = ref('')

// ── 分页（底部分页固定；# 序号跨页连续） ──
const currentPage = ref(1)
const pageSize = ref(10)
const pagedMails = computed(() => mails.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

// ── 批量选择（翻页不清空：reserve-selection） ──
const selectedMails = ref<MailRow[]>([])
function onSelectionChange(rows: MailRow[]): void { selectedMails.value = rows }

const tplvOptions = computed(() => tplVersions.value.map((v) => ({ label: `${v.label ?? `v${v.version}`}`, value: v._id })))
function tplLabel(id: string): string {
  const v = tplVersions.value.find((t) => t._id === id)
  return v ? (v.label ?? `v${v.version}`) : id.slice(0, 12) + '…'
}

function openMail(row?: MailRow): void {
  mailForm.value = row
    ? {
        _id: row._id,
        name: String(row.name ?? ''),
        templateVersionId: row.templateVersionId,
        bindingsText: JSON.stringify(row.bindings ?? []),
        dataText: JSON.stringify(row.data ?? {}, null, 2),
      }
    : { _id: '', name: '', templateVersionId: tplVersions.value[0]?._id ?? '', bindingsText: '[{"slot":"header","fragmentVersionId":""}]', dataText: '{}' }
  mailOpen.value = true
}
async function saveMail(): Promise<void> {
  try {
    await api('mail:save', {
      ...mailForm.value,
      bindings: JSON.parse(mailForm.value.bindingsText),
      data: JSON.parse(mailForm.value.dataText),
    })
    mailOpen.value = false
    await loadMails()
    ElMessage.success('邮件已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 复制副本（复制约定）：内容原样，名称加「副本」后缀 */
async function duplicateMail(row: MailRow): Promise<void> {
  try {
    await api('mail:save', {
      name: `${row.name} 副本`,
      templateVersionId: row.templateVersionId,
      bindings: row.bindings ?? [],
      data: row.data ?? {},
    })
    await loadMails()
    ElMessage.success('已创建副本')
  } catch (err) { ElMessage.error((err as Error).message) }
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

async function copyFinal(row: MailRow): Promise<void> {
  try {
    const html = (await api('mail:readFinal', { _id: row._id })) as string
    await window.api.os.clipboardWrite(html)
    ElMessage.success('final.html 已复制')
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function openOutput(row: MailRow): Promise<void> {
  if (row.outputs?.final) await window.api.os.shellOpen(`outputs/edm/${row._id}/final.html`)
}

// ── 导出（导出约定：单封 .html / 批量 .zip） ──
async function exportMail(row: MailRow): Promise<void> {
  try {
    if (!row.outputs?.final) { ElMessage.warning('该邮件尚未生成产物'); return }
    const save = await window.api.os.pickSave({ fileName: `${row.name || 'mail'}.html`, extensions: ['html'] })
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
    const save = await window.api.os.pickSave({ fileName: `sshk-mails-${date}.zip`, extensions: ['zip'] })
    if (!save) return
    const res = (await api('mail:export', { ids: rows.map((r) => r._id), outPath: save })) as { count: number; outPath: string }
    ElMessage.success(`已批量导出 ${res.count} 封：${res.outPath}`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定；危险操作二次确认） */
async function batchRemove(): Promise<void> {
  const rows = selectedMails.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的邮件'); return }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${rows.length} 封邮件？记录将归档。`, '批量删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  for (const row of rows) await api('mail:remove', { _id: row._id })
  await loadMails()
  ElMessage.success(`已删除 ${rows.length} 封邮件`)
}

// ── 分享（分享约定：局域网 token，状态可见可停止） ──
const share = ref<{ running: boolean; urls: string[] }>({ running: false, urls: [] })
async function refreshShare(): Promise<void> {
  try { share.value = (await api('share:status')) as { running: boolean; urls: string[] } } catch { /* 忽略 */ }
}
async function shareStart(): Promise<void> {
  try {
    const res = (await api('share:start', { ttlHours: 72 })) as { urls: string[] }
    await window.api.os.clipboardWrite(res.urls[0] ?? '')
    await refreshShare()
    ElMessage.success(`分享已启动：${res.urls[0]}（已复制，72h 有效）`)
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function shareStop(): Promise<void> {
  try {
    await api('share:stop')
    await refreshShare()
    ElMessage.success('分享已停止')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function copyShareUrl(url: string): Promise<void> {
  await window.api.os.clipboardWrite(url)
  ElMessage.success('分享链接已复制')
}

onMounted(refreshShare)

/** 行内「更多」命令分发 */
async function onRowCommand(cmd: string, row: MailRow): Promise<void> {
  if (cmd === 'edit') { openMail(row); return }
  if (cmd === 'copy') { await copyFinal(row); return }
  if (cmd === 'duplicate') { await duplicateMail(row); return }
  if (cmd === 'open') { await openOutput(row); return }
  if (cmd === 'delete') await confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })
}
</script>

<template>
  <div class="mails-page">
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openMail()">新增邮件</el-button>
      <el-button size="small" type="success" plain :disabled="selectedMails.length === 0" @click="batchExport">批量导出（{{ selectedMails.length }}）</el-button>
      <el-button size="small" type="danger" plain :disabled="selectedMails.length === 0" @click="batchRemove">批量删除（{{ selectedMails.length }}）</el-button>
      <span class="spacer" />
      <template v-if="share.running">
        <el-tag type="success" size="small" effect="dark">分享中 · {{ share.urls.length }} 个链接</el-tag>
        <el-button size="small" plain @click="copyShareUrl(share.urls[0] ?? '')">复制链接</el-button>
        <el-button size="small" type="warning" plain @click="shareStop">停止分享</el-button>
      </template>
      <el-button v-else size="small" type="success" @click="shareStart">启动分享</el-button>
    </div>

    <div class="table-wrap">
      <template v-if="mails.length > 0">
        <el-table :data="pagedMails" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
          <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
          <el-table-column type="selection" width="40" reserve-selection />
          <el-table-column prop="name" label="邮件" min-width="150" show-overflow-tooltip />
          <el-table-column label="模板版本" width="110">
            <template #default="{ row }"><span class="muted">{{ tplLabel(row.templateVersionId) }}</span></template>
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
                      <el-dropdown-item command="copy">复制代码</el-dropdown-item>
                      <el-dropdown-item command="duplicate">复制副本</el-dropdown-item>
                      <el-dropdown-item command="open">打开产物</el-dropdown-item>
                      <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <EmptyState v-else description="还没有邮件；邮件绑定模板版本与片段版本后一键生成三阶段产物" />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="mails.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        small
      />
      <span class="muted">产物覆盖式（D19）· 分享 final.html（72h token）</span>
    </div>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="mailOpen" :title="mailForm._id ? '编辑邮件' : '新增邮件'" width="640px">
      <el-form label-width="80px" size="small">
        <el-form-item label="名称"><el-input v-model="mailForm.name" /></el-form-item>
        <el-form-item label="模板版本">
          <el-select v-model="mailForm.templateVersionId" style="width: 100%">
            <el-option v-for="v in tplvOptions" :key="v.value" :label="v.label" :value="v.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="绑定"><el-input v-model="mailForm.bindingsText" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="数据"><el-input v-model="mailForm.dataText" type="textarea" :rows="6" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="mailOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveMail">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mails-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.toolbar { flex: none; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar .spacer { flex: 1; }
.table-wrap { flex: 1; min-height: 0; margin-top: 8px; }
.foot { flex: none; display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.op-row { display: flex; gap: 6px; justify-content: center; align-items: center; }
.op-row .el-button + .el-button { margin-left: 0; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
