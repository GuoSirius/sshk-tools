<script setup lang="ts">
/**
 * 系统与数据 · 数据目录与备份卡（P4-3 从 SystemTab 拆入）：
 * 应用版本 / 数据目录 / 日志（容量摘要+打开+清理）/ 密钥管理指引 / 备份导出导入（D18 迁移口令可选）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { toFileName } from '@sshk/shared'

defineProps<{ version: string }>()

function openDataDir(): void { void window.api.app.openDataDir() }

// ── H3 日志 ──
const logInfo = ref<{ dir: string; sizeBytes: number; files: { name: string; sizeBytes: number }[] } | null>(null)
const logSummary = computed(() => {
  if (!logInfo.value) return '加载中…'
  return `${(logInfo.value.sizeBytes / 1024).toFixed(1)} KB · ${logInfo.value.files.length} 个文件，保留 7 天`
})
async function refreshLogInfo(): Promise<void> {
  try { logInfo.value = await window.api.logs.getDir() } catch { /* 忽略 */ }
}
function openLogDir(): void { if (logInfo.value) void window.api.os.shellOpen(logInfo.value.dir) }
async function cleanLogs(): Promise<void> {
  try {
    const { removed } = await window.api.logs.clean()
    await refreshLogInfo()
    ElMessage.success(`已清理 ${removed} 个过期日志文件`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

// ── 备份（D18：口令可选加密密钥） ──
const migrationPassphrase = ref('')
async function exportBackup(): Promise<void> {
  const save = await window.api.os.pickSave({
    fileName: `sshk-tools-backup-${toFileName()}.zip`,
    extensions: ['zip'],
  })
  if (!save) return
  try {
    const { counts } = (await window.api.backup.export(save, migrationPassphrase.value || undefined)) as { counts: Record<string, number> }
    const summary = Object.entries(counts).map(([k, v]) => `${k} ${v} 项`).join(' / ')
    ElMessage.success(`备份已导出：${save}（${summary}）`)
  } catch (err) { ElMessage.error(`导出失败：${(err as Error).message}`) }
}
async function importBackup(): Promise<void> {
  const [zip] = await window.api.os.pickFile({ filters: [{ name: '备份包', extensions: ['zip'] }] })
  if (!zip) return
  try {
    const result = (await window.api.backup.import(zip, migrationPassphrase.value || undefined)) as { secretsRestored: number; secretsMessage?: string }
    ElMessage.success(`导入完成${result.secretsMessage ? `：${result.secretsMessage}` : ''}；重启应用后数据完全生效`)
  } catch (err) { ElMessage.error(`导入失败：${(err as Error).message}`) }
}

onMounted(() => { void refreshLogInfo() })
</script>

<template>
  <section class="settings-card">
    <div class="card-title">系统与数据</div>
    <div class="kv-line"><span>应用版本</span><strong>v{{ version }}</strong></div>
    <div class="kv-line"><span>数据目录</span><el-button size="small" type="primary" text @click="openDataDir">打开</el-button></div>
    <div class="kv-line">
      <span class="kv-label">日志</span>
      <el-tooltip :content="logInfo?.dir || ''" placement="top" :disabled="!logInfo">
        <span class="hint log-summary">{{ logSummary }} ⓘ</span>
      </el-tooltip>
      <div class="btn-group">
        <el-button size="small" type="primary" text :disabled="!logInfo" @click="openLogDir">打开</el-button>
        <el-button size="small" text type="danger" :disabled="!logInfo" @click="cleanLogs">清空</el-button>
      </div>
    </div>
    <div class="kv-line"><span>密钥管理</span><span class="hint">模型 Provider 密钥：Model Console；应用访问密钥：「工具与权限」页</span></div>
    <div class="kv-line">
      <span>备份</span>
      <div class="btn-group">
        <!-- 语义色按钮（总纲 §2.5）：导出=warning，导入=info -->
        <el-button size="small" type="warning" @click="exportBackup">导出</el-button>
        <el-button size="small" type="info" @click="importBackup">导入</el-button>
      </div>
    </div>
    <div class="kv-line">
      <span>迁移口令</span>
      <el-input v-model="migrationPassphrase" size="small" type="password" show-password clearable placeholder="留空 = 密钥不加密" style="width: 230px" />
    </div>
    <div class="hint">D18：填写口令则备份包内密钥以口令加密（AES），导入时用同一口令还原；留空则密钥不随备份迁移。跨设备迁移两端填同一口令即可。</div>
  </section>
</template>
