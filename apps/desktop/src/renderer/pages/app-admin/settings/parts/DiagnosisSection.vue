<script setup lang="ts">
/**
 * 系统与数据 · 诊断与反馈卡（P4-3 从 SystemTab 拆入）：
 * 一键诊断采集（值级脱敏：env 只列名、密钥只出布尔）→ 弹框预览确认 → 导出 zip；全程本机完成。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { toFileName } from '@sshk/shared'

type DiagnosisData = import('@sshk/shared').DiagnosisData

const diagData = ref<DiagnosisData | null>(null)
const diagOpen = ref(false)
const diagLoading = ref(false)
async function openDiagnosis(): Promise<void> {
  diagLoading.value = true
  try { diagData.value = await window.api.diagnostics.collect(); diagOpen.value = true }
  catch (err) { ElMessage.error(`诊断数据采集失败：${(err as Error).message}`) }
  finally { diagLoading.value = false }
}
async function saveDiagnosis(): Promise<void> {
  const save = await window.api.os.pickSave({
    fileName: `sshk-diagnosis-${toFileName()}.zip`,
    extensions: ['zip'],
  })
  if (!save) return
  try {
    const { file, logs } = await window.api.diagnostics.save(save)
    ElMessage.success(`诊断报告已导出：${file}（含 ${logs} 个日志文件）`)
    diagOpen.value = false
  } catch (err) { ElMessage.error(`导出失败：${(err as Error).message}`) }
}
const diagIssueTools = computed(() =>
  (diagData.value?.tools ?? []).filter((t) => !t.enabled || !t.visible || t.plugin.includes('失败') || t.warnings.length > 0),
)
</script>

<template>
  <section class="settings-card">
    <div class="card-title">诊断与反馈</div>
    <div class="kv-line">
      <span>一键诊断</span>
      <el-button size="small" type="primary" :loading="diagLoading" @click="openDiagnosis">生成诊断报告</el-button>
    </div>
    <div class="hint">报障时生成 zip 发给开发者即可：report.md（版本 / env 变量名 / 密钥布尔 / 工具快照 / 产物占用）+ 近 3 天完整日志。值级脱敏：env 只列名、密钥只出布尔，生成前可预览确认；全程本机完成，不上传不联网。</div>

    <!-- N1 诊断摘要预览 -->
    <el-dialog v-model="diagOpen" title="诊断报告预览（已脱敏，确认后保存 zip）" width="640px" :close-on-click-modal="false" :close-on-press-escape="false">
      <template v-if="diagData">
        <div class="kv-line"><span>应用版本</span><strong>v{{ diagData.app.version }}（{{ diagData.app.packaged ? '打包版' : '开发版' }}）</strong></div>
        <div class="kv-line"><span>平台</span><span class="hint">{{ diagData.platform.os }} {{ diagData.platform.release }}（{{ diagData.platform.arch }}）· {{ diagData.platform.memoryGB }} GB</span></div>
        <div class="kv-line">
          <span>env 变量（只列名）</span>
          <span class="hint">{{ diagData.env.length ? diagData.env.map((e) => `${e.name}${e.set ? ' ✓' : ''}`).join('、') : '无相关变量' }}</span>
        </div>
        <div class="kv-line">
          <span>密钥状态</span>
          <span class="hint">
            访问密钥 {{ diagData.secrets.accessKey ? '✓' : '未配置' }} · 开发者口令 {{ diagData.secrets.devtoolsKey ? '✓' : '未配置' }}
            · Provider {{ diagData.secrets.providers.filter((p) => p.hasApiKey).length }}/{{ diagData.secrets.providers.length }}
            · 上传 Profile {{ diagData.secrets.uploads.filter((p) => p.hasSecret).length }}/{{ diagData.secrets.uploads.length }}
          </span>
        </div>
        <div class="kv-line">
          <span>工具快照</span>
          <span class="hint">
            共 {{ diagData.tools.length }} 个
            <el-tag v-if="diagIssueTools.length" size="small" type="warning">需关注 {{ diagIssueTools.length }} 个</el-tag>
            <el-tag v-else size="small" type="success">全部正常</el-tag>
          </span>
        </div>
        <div class="kv-line">
          <span>产物占用</span>
          <span class="hint">{{ diagData.outputs.files }} 个文件 · {{ diagData.outputs.totalMB }} MB</span>
        </div>
        <div class="kv-line">
          <span>近 3 天日志</span>
          <span class="hint">
            {{ diagData.logs.files.length }} 个文件
            <el-tag v-if="diagData.logs.recentErrors.length" size="small" type="danger">error {{ diagData.logs.recentErrors.length }} 条</el-tag>
            <el-tag v-else size="small" type="success">无 error</el-tag>
          </span>
        </div>
        <div v-if="diagIssueTools.length" class="diag-issues">
          <div v-for="t in diagIssueTools" :key="t.id" class="warning-line">{{ t.id }}：{{ t.plugin.includes('失败') ? t.plugin : (!t.visible ? '不可见' : '') }}{{ t.warnings.join('；') }}</div>
        </div>
      </template>
      <template #footer>
        <el-button size="small" @click="diagOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveDiagnosis">确认无误，保存 zip</el-button>
      </template>
    </el-dialog>
  </section>
</template>
