<script setup lang="ts">
/**
 * 应用设置 · 系统与数据 tab：更新 / 数据目录与日志 / 备份 / 配置预设 / 运行时工具包 / 回滚快照 / 诊断。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IPC_CHANNELS } from '@sshk/shared'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'
import { useUpdater } from '../../composables/useUpdater'
import { useToolCatalog } from '../../composables/useToolCatalog'
import { appConfig } from '../../composables/useAppConfig'

// ── 版本 / 运行环境 ──
const version = ref('0.1.0')
const { state: updaterState } = useUpdater()
const { refresh: refreshCatalog } = useToolCatalog()
const updateTagType = computed(() => {
  switch (updaterState.value.phase) {
    case 'downloaded': return 'success'
    case 'available':
    case 'downloading': return 'warning'
    case 'error': return 'danger'
    default: return 'info'
  }
})
const updateStatusText = computed(() => {
  switch (updaterState.value.phase) {
    case 'idle':
    case 'not-available': return '已是最新'
    case 'checking': return '检查中…'
    case 'available': return '有新版本'
    case 'downloading': return '下载中'
    case 'downloaded': return '待安装'
    case 'error': return '检查失败'
    case 'dev': return '开发版本'
    case 'disabled': return '已禁用'
    default: return '未知'
  }
})
async function checkUpdate(): Promise<void> {
  if (updaterState.value.phase === 'checking' || updaterState.value.phase === 'downloading' || updaterState.value.phase === 'available') return
  const result = await window.api.update.check().catch(() => ({}) as Record<string, unknown>)
  if (result.disabled) ElMessage.info('自动更新已禁用（SSHK_APP_AUTO_UPDATE=0）')
  else if (result.dev) ElMessage.info('开发环境不检查更新')
  else if (result.error) ElMessage.error('检查更新失败：' + String(result.error))
  else if (result.updateAvailable) ElMessage.success(`发现新版本 ${String(result.version ?? '')}，已开始下载`)
  else ElMessage.success('当前已是最新版本')
}
async function installUpdate(): Promise<void> {
  await window.api.update.quitAndInstall().catch((err: unknown) => { ElMessage.error('安装失败：' + (err as Error).message) })
}
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

// ── 备份 ──
const migrationPassphrase = ref('')
async function exportBackup(): Promise<void> {
  const save = await window.api.os.pickSave({
    fileName: `sshk-tools-backup-${new Date().toLocaleDateString('sv-SE')}.zip`,
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

// ── N3 配置预设 ──
const PRESET_EXPORT_SPEC: HostApiSpec = { group: 'presets', method: 'export', channel: IPC_CHANNELS.presetExport, label: '配置预设导出' }
const PRESET_IMPORT_SPEC: HostApiSpec = { group: 'presets', method: 'import', channel: IPC_CHANNELS.presetImport, label: '配置预设导入' }
const presetIncludeSecrets = ref(false)
async function exportPresetFile(): Promise<void> {
  if (presetIncludeSecrets.value) {
    try {
      await ElMessageBox.confirm(
        '「包含密钥」已开启：导出的 JSON 将含有模型 API Key 与上传密钥明文。任何拿到该文件的人都能直接使用你的密钥，请仅用于可信设备间迁移并妥善保管。确定继续吗？',
        '敏感操作确认',
        { type: 'warning', confirmButtonText: '确认包含密钥导出', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
  }
  const save = await window.api.os.pickSave({
    fileName: `sshk-preset-${new Date().toLocaleDateString('sv-SE')}${presetIncludeSecrets.value ? '-含密钥' : ''}.json`,
    extensions: ['json'],
  })
  if (!save) return
  try {
    const r = await callHostApi<{ file: string; providers: number; uploadProfiles: number; secrets: number }>(
      PRESET_EXPORT_SPEC, save, presetIncludeSecrets.value)
    ElMessage.success(`预设已导出：Provider ${r.providers} / 上传 Profile ${r.uploadProfiles}${r.secrets ? ` / 密钥 ${r.secrets} 条（明文，请妥善保管）` : ''}`)
  } catch (err) { ElMessage.error(`导出失败：${(err as Error).message}`) }
}
async function importPresetFile(): Promise<void> {
  const [file] = await window.api.os.pickFile({ filters: [{ name: '配置预设', extensions: ['json'] }] })
  if (!file) return
  try {
    const r = await callHostApi<{ providersMerged: number; uploadProfilesMerged: number }>(PRESET_IMPORT_SPEC, file)
    ElMessage.success(`预设已导入：Provider ${r.providersMerged} / 上传 Profile ${r.uploadProfilesMerged}（按 id 合并）`)
  } catch (err) { ElMessage.error(`导入失败：${(err as Error).message}`) }
}

// ── 运行时工具包 ──
type InstalledPackageRecord = import('@sshk/shared').InstalledPackageRecord
type InstallPreview = import('@sshk/shared').InstallPreview
const runtimePackages = ref<InstalledPackageRecord[]>([])
async function refreshRuntime(): Promise<void> {
  runtimePackages.value = (await window.api.runtime.list()) as InstalledPackageRecord[]
}
async function pickRuntimePackage(): Promise<void> {
  const [zip] = await window.api.os.pickFile({ filters: [{ name: '工具包', extensions: ['sshktool'] }] })
  if (!zip) return
  let preview: InstallPreview
  try { preview = (await window.api.runtime.preview(zip)) as InstallPreview }
  catch (err) { ElMessage.error(`预览失败：${(err as Error).message}`); return }
  if (preview.status === 'builtin-conflict') {
    ElMessage.error(`工具「${preview.id}」已作为内置工具随本应用分发，禁止重复安装同名外部包（如需替换请在「工具与权限」中先禁用内置版本）`)
    return
  }
  if (preview.status === 'downgrade') {
    try {
      await ElMessageBox.confirm(
        `即将从 v${preview.installedVersion} 降级到 v${preview.newVersion}。新版本可能存在问题，降级可回退；但旧版本能力 / 数据可能不兼容，确定继续？`,
        '降级安装确认', { type: 'warning', confirmButtonText: '仍要降级', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
  }
  try {
    const { record, warnings } = (await window.api.runtime.install(zip)) as { record: InstalledPackageRecord; warnings: string[] }
    for (const w of warnings) ElMessage.warning(w)
    const tip = preview.status === 'upgrade' ? `（从 v${preview.installedVersion} 升级到 v${preview.newVersion}）` : ''
    ElMessage.success(`已安装 ${record.id}@${record.version}（${record.trustLevel} / ${record.sandbox} 沙箱）${tip}`)
    await refreshRuntime()
    await refreshCatalog()
  } catch (err) { ElMessage.error(`安装失败：${(err as Error).message}`) }
}
const publicKeys = ref<{ keyId: string; label: string; importedAt: string }[]>([])
const keyImportOpen = ref(false)
const keyLabel = ref('')
const keyPem = ref('')
async function refreshKeys(): Promise<void> {
  publicKeys.value = (await window.api.runtime.keysList()) as { keyId: string; label: string; importedAt: string }[]
}
async function importKey(): Promise<void> {
  if (!keyPem.value.trim()) { ElMessage.warning('请粘贴 PEM 公钥内容'); return }
  try {
    const entry = (await window.api.runtime.keysImport(keyLabel.value, keyPem.value)) as { keyId: string; label: string }
    ElMessage.success('已导入：' + entry.label + '（' + entry.keyId + '）')
    keyImportOpen.value = false
    keyLabel.value = ''
    keyPem.value = ''
    await refreshKeys()
  } catch (err) { ElMessage.error('导入失败：' + (err as Error).message) }
}
async function revokeKey(keyId: string): Promise<void> {
  await window.api.runtime.keysRevoke(keyId)
  ElMessage.success('已撤销')
  await refreshKeys()
}
async function removeRuntime(id: string): Promise<void> {
  try {
    await window.api.runtime.uninstall(id)
    ElMessage.success(`已卸载 ${id}`)
    await refreshRuntime()
    await refreshCatalog()
  } catch (err) { ElMessage.error(`卸载失败：${(err as Error).message}`) }
}

// ── N4 回滚快照 ──
const SNAPSHOT_LIST_SPEC: HostApiSpec = { group: 'snapshots', method: 'list', channel: IPC_CHANNELS.snapshotList, label: '回滚快照' }
const SNAPSHOT_RESTORE_SPEC: HostApiSpec = { group: 'snapshots', method: 'restore', channel: IPC_CHANNELS.snapshotRestore, label: '快照恢复' }
const SNAPSHOT_CLEAR_SPEC: HostApiSpec = { group: 'snapshots', method: 'clear', channel: IPC_CHANNELS.snapshotClear, label: '快照清空' }
type SnapshotEntry = import('@sshk/repository').OutputSnapshotEntry
const snapshots = ref<SnapshotEntry[]>([])
const snapshotTime = (iso: string): string => String(iso ?? '').slice(0, 19).replace('T', ' ')
async function refreshSnapshots(): Promise<void> {
  try { snapshots.value = await callHostApi<SnapshotEntry[]>(SNAPSHOT_LIST_SPEC) } catch { /* 保持空 */ }
}
async function saveSnapshotSwitch(): Promise<void> {
  try {
    await window.api.config.set('app.outputSnapshot', appConfig.outputSnapshot)
    ElMessage.success(appConfig.outputSnapshot ? '回滚快照已开启（重新生成产物时生效）' : '回滚快照已关闭')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function restoreSnapshotEntry(entry: SnapshotEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`把「${entry.rel}」恢复为快照时的旧版本？当前文件将被覆盖。`, '恢复快照', { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
  } catch { return }
  try {
    const path = await callHostApi<string>(SNAPSHOT_RESTORE_SPEC, entry.id)
    ElMessage.success(`已恢复：${path}`)
  } catch (err) { ElMessage.error(`恢复失败：${(err as Error).message}`) }
}
async function clearSnapshotAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空全部回滚快照？被覆盖的旧产物将无法再恢复。', '清空快照', { type: 'warning', closeOnClickModal: false, closeOnPressEscape: false })
  } catch { return }
  try {
    const { removed } = await callHostApi<{ removed: number }>(SNAPSHOT_CLEAR_SPEC)
    ElMessage.success(`已清空 ${removed} 份快照`)
    await refreshSnapshots()
  } catch (err) { ElMessage.error(`清空失败：${(err as Error).message}`) }
}

// ── N1 一键诊断 ──
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
    fileName: `sshk-diagnosis-${new Date().toLocaleDateString('sv-SE')}.zip`,
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

onMounted(() => {
  void refreshRuntime()
  void refreshKeys()
  void refreshLogInfo()
  void refreshSnapshots()
  void window.api.app.version().then((v) => { version.value = v }).catch(() => { /* 保持默认 */ })
})
</script>

<template>
  <div class="system-tab">
    <section class="settings-card">
      <div class="card-title">更新</div>
      <div class="kv-line"><span>当前版本</span><strong>v{{ version }}</strong></div>
      <div class="kv-line">
        <span>更新状态</span>
        <el-tag size="small" :type="updateTagType">{{ updateStatusText }}</el-tag>
        <span v-if="updaterState.phase === 'downloading'" class="hint">下载中 {{ updaterState.percent }}%</span>
      </div>
      <el-progress v-if="updaterState.phase === 'downloading'" :percentage="updaterState.percent ?? 0" :stroke-width="8" style="margin: 6px 0 10px" />
      <div v-if="updaterState.version && (updaterState.phase === 'available' || updaterState.phase === 'downloading' || updaterState.phase === 'downloaded')" class="kv-line">
        <span>最新版本</span><strong>v{{ updaterState.version }}</strong>
      </div>
      <div class="card-actions">
        <el-button v-if="updaterState.phase !== 'disabled'" size="small"
          :loading="updaterState.phase === 'checking' || updaterState.phase === 'downloading'" @click="checkUpdate">
          {{ updaterState.phase === 'checking' ? '检查中…' : '检查更新' }}
        </el-button>
        <el-button v-if="updaterState.phase === 'downloaded'" size="small" type="primary" @click="installUpdate">立即安装</el-button>
      </div>
      <div v-if="updaterState.phase === 'error'" class="warning-line">{{ updaterState.error }}</div>
      <div v-if="updaterState.phase === 'disabled'" class="hint">自动更新已被环境变量 SSHK_APP_AUTO_UPDATE=0 禁用：不检查、不下载、不提示新版本（内网/定制分发场景）。</div>
      <div v-else class="hint">自动更新默认开启（见「常规」）；新版本后台下载，完成后点「立即安装」重启生效。若需在退出应用时自动安装，请在「常规 → 自动安装更新」开启（默认关闭）。</div>
    </section>

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
      <div class="kv-line"><span>密钥管理</span><span class="hint">模型 Provider 密钥：Model Console；应用访问密钥：本页「工具与权限」</span></div>
      <div class="kv-line">
        <span>备份</span>
        <div class="btn-group">
          <el-button size="small" type="primary" @click="exportBackup">导出</el-button>
          <el-button size="small" type="info" @click="importBackup">导入</el-button>
        </div>
      </div>
      <div class="kv-line">
        <span>迁移口令</span>
        <el-input v-model="migrationPassphrase" size="small" type="password" show-password clearable placeholder="留空 = 密钥不加密" style="width: 230px" />
      </div>
      <div class="hint">D18：填写口令则备份包内密钥以口令加密（AES），导入时用同一口令还原；留空则密钥不随备份迁移。跨设备迁移两端填同一口令即可。</div>
    </section>

    <section class="settings-card">
      <div class="card-title">配置预设</div>
      <div class="switch-row">
        <!-- 开关固定居右（用户 2026-11-18：开/关前后位置不变），提示消息插在 label 与开关之间 -->
        <span class="switch-label">
          包含密钥
          <el-tooltip content="开启后，导出预设会携带模型 API Key 与上传密钥明文，用于可信设备间完整迁移。默认关闭（只导出配置、不含密钥）。含密钥文件请妥善保管，导入会自动写回本机密钥库。" placement="top">
            <span class="tip-icon">?</span>
          </el-tooltip>
        </span>
        <span v-if="presetIncludeSecrets" class="hint danger-text switch-inline-tip">当前将导出明文密钥，请仅用于可信设备</span>
        <el-switch v-model="presetIncludeSecrets" size="small" />
      </div>
      <div class="kv-line">
        <span>导出 / 导入</span>
        <div class="btn-group">
          <el-button size="small" type="primary" @click="exportPresetFile">导出预设</el-button>
          <el-button size="small" @click="importPresetFile">导入预设</el-button>
        </div>
      </div>
      <div class="hint">导出模型 Provider 与上传 Profile 为 JSON 预设；默认剔除密钥、本机默认目录不带入。导入按 id 合并（同名覆盖、新增追加），含密钥预设导入时自动写回密钥库。</div>
    </section>

    <section class="settings-card">
      <div class="card-title">运行时工具包（.sshktool）</div>
      <div class="kv-line">
        <span>导入安装</span>
        <el-button size="small" type="primary" @click="pickRuntimePackage">选择 .sshktool 包</el-button>
      </div>
      <div v-for="pkg in runtimePackages" :key="pkg.id" class="kv-line">
        <span>{{ pkg.id }}@{{ pkg.version }}</span>
        <el-tag size="small" :type="pkg.trustLevel === 'official' ? 'success' : pkg.trustLevel === 'unsigned' ? 'danger' : 'warning'">{{ pkg.trustLevel }}</el-tag>
        <span class="hint">{{ pkg.sandbox }} · sha256:{{ pkg.sha256.slice(0, 8) }}</span>
        <el-button size="small" text type="danger" @click="removeRuntime(pkg.id)">卸载</el-button>
      </div>
      <div v-if="runtimePackages.length === 0" class="kv-line"><span class="hint">暂无运行时安装的工具包</span></div>

      <div class="card-title" style="margin-top: 12px">信任的发布者（公钥）</div>
      <div class="kv-line">
        <span>导入公钥</span>
        <el-button size="small" type="primary" @click="keyImportOpen = true">粘贴 PEM</el-button>
      </div>
      <div v-for="key in publicKeys" :key="key.keyId" class="kv-line">
        <span>{{ key.label }}</span>
        <span class="hint">{{ key.keyId }} · {{ key.importedAt }}</span>
        <el-button size="small" text type="danger" @click="revokeKey(key.keyId)">撤销</el-button>
      </div>
      <div v-if="publicKeys.length === 0" class="kv-line"><span class="hint">未导入第三方公钥（官方公钥内置，无需导入）</span></div>
      <el-dialog v-model="keyImportOpen" title="导入第三方公钥" width="520px" :close-on-click-modal="false" :close-on-press-escape="false">
        <el-input clearable v-model="keyLabel" placeholder="发布者名称（如：合作方 A）" style="margin-bottom: 10px" />
        <el-input v-model="keyPem" type="textarea" :rows="8" placeholder="粘贴 PEM 公钥内容（-----BEGIN PUBLIC KEY----- ...）" />
        <template #footer>
          <el-button size="small" @click="keyImportOpen = false">取消</el-button>
          <el-button size="small" type="primary" @click="importKey">导入</el-button>
        </template>
      </el-dialog>
      <div class="kv-line"><span class="hint">未签名包以 utility 沙箱安装；main 权限需要有效签名与显式信任</span></div>
    </section>

    <section class="settings-card">
      <div class="card-title">
        回滚快照
        <el-switch v-model="appConfig.outputSnapshot" size="small" @change="saveSnapshotSwitch" />
      </div>
      <div class="hint">开启后（默认关，D19 覆盖行为不变）：badge / EDM 重新生成产物前自动把旧文件留一份快照（每文件最近 1 份，总量上限 50MB 自动清最旧）。恢复会覆盖当前产物。</div>
      <div v-for="s in snapshots" :key="s.id" class="kv-line">
        <span class="snap-name">{{ s.toolId }} · {{ s.rel }}</span>
        <span class="hint">{{ (s.sizeBytes / 1024).toFixed(1) }} KB · {{ snapshotTime(s.time) }}</span>
        <el-button size="small" text type="primary" @click="restoreSnapshotEntry(s)">恢复</el-button>
      </div>
      <div v-if="snapshots.length === 0" class="kv-line"><span class="hint">暂无快照（开启开关后重新生成产物即产生）</span></div>
      <div v-if="snapshots.length" class="card-actions">
        <el-button size="small" type="danger" plain @click="clearSnapshotAll">清空快照</el-button>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-title">诊断与反馈</div>
      <div class="kv-line">
        <span>一键诊断</span>
        <el-button size="small" type="primary" :loading="diagLoading" @click="openDiagnosis">生成诊断报告</el-button>
      </div>
      <div class="hint">报障时生成 zip 发给开发者即可：report.md（版本 / env 变量名 / 密钥布尔 / 工具快照 / 产物占用）+ 近 3 天完整日志。值级脱敏：env 只列名、密钥只出布尔，生成前可预览确认；全程本机完成，不上传不联网。</div>
    </section>

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
  </div>
</template>
