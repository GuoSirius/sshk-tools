<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { TimeText } from '@sshk/ui-kit'
import { mails, tplVersions, loadMails } from '../state'
import { api, confirmRemove, type MailRow } from '../shared'

/** 邮件页：三阶段产物生成（覆盖式，D19）+ 导出/分享 */
const mailOpen = ref(false)
const mailForm = ref<{ _id: string; name: string; templateVersionId: string; bindingsText: string; dataText: string }>({ _id: '', name: '', templateVersionId: '', bindingsText: '', dataText: '{}' })
const mailGenerating = ref('')

const tplvOptions = computed(() => tplVersions.value.map((v) => ({ label: `${v.label ?? `v${v.version}`}`, value: v._id })))

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
async function shareStart(): Promise<void> {
  try {
    const res = (await api('share:start', { ttlHours: 72 })) as { urls: string[] }
    await window.api.os.clipboardWrite(res.urls[0] ?? '')
    ElMessage.success(`分享已启动：${res.urls[0]}（已复制，72h 有效）`)
  } catch (err) { ElMessage.error((err as Error).message) }
}
</script>

<template>
  <div>
    <el-button size="small" @click="openMail()">新增邮件</el-button>
    <el-button type="success" size="small" @click="shareStart">启动分享</el-button>

    <el-table :data="mails" size="small" style="margin-top: 8px">
      <el-table-column type="index" label="#" width="50" align="center" />
      <el-table-column prop="name" label="邮件" min-width="150" />
      <el-table-column label="生成时间" width="160">
        <template #default="{ row }"><TimeText :value="row.lastGeneratedAt" placeholder="未生成" /></template>
      </el-table-column>
      <el-table-column label="产物" min-width="200">
        <template #default="{ row }"><span class="muted">{{ row.outputs?.final ?? '—' }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text @click="openMail(row)">编辑</el-button>
          <el-button size="small" text type="primary" :loading="mailGenerating === row._id" @click="generateMail(row)">生成</el-button>
          <el-button size="small" text @click="copyFinal(row)">复制代码</el-button>
          <el-button size="small" text @click="openOutput(row)">打开产物</el-button>
          <el-button size="small" text type="danger" @click="confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="panel" style="margin-top: 8px">
      <div class="panel-title">导出 / 分享</div>
      <el-button size="small" @click="shareStart">启动局域网分享（72h token）</el-button>
      <span class="muted" style="margin-left: 8px">分享 final.html；打开数据目录可直接取 outputs/edm/&lt;mailId&gt;/ 下三阶段文件</span>
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
.panel { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; padding: 10px; }
.panel-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
