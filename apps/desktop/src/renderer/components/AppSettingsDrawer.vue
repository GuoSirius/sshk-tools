<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ACCESS_GRANT, IPC_CHANNELS } from '@sshk/shared'
import type { ThemeMode, ToolRuntimeState, InstallPreview, ToolCatalogPayload } from '@sshk/shared'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { promptSecret } from './secret-prompt'

/** 开发协助配置（分发白名单 / 图标覆盖 / 硬依赖）只在 dev 展示，发布版隐藏 */
const isDev = import.meta.env.DEV
import ToolIcon from './ToolIcon.vue'
import ToolManifestDialog from './ToolManifestDialog.vue'
import { useToolCatalog } from '../composables/useToolCatalog'
import type { InstalledPackageRecord } from '@sshk/shared'
import { useTheme } from '../composables/useTheme'
import { useUpdater } from '../composables/useUpdater'

const props = defineProps<{ modelValue: boolean; group?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'create-tool': [] }>()
const { payload, accept, refresh: refreshCatalog } = useToolCatalog()
const { mode, setMode } = useTheme()
const { state: updaterState } = useUpdater()

// ── 自动更新状态（与主进程事件同步，单一真相源） ──
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
    default: return '未知'
  }
})
async function checkUpdate(): Promise<void> {
  if (updaterState.value.phase === 'checking' || updaterState.value.phase === 'downloading' || updaterState.value.phase === 'available') return
  const result = await window.api.update.check().catch(() => ({}) as Record<string, unknown>)
  if (result.dev) ElMessage.info('开发环境不检查更新')
  else if (result.error) ElMessage.error('检查更新失败：' + String(result.error))
  else if (result.updateAvailable) ElMessage.success(`发现新版本 ${String(result.version ?? '')}，已开始下载`)
  else ElMessage.success('当前已是最新版本')
}
async function installUpdate(): Promise<void> {
  await window.api.update.quitAndInstall().catch((err: unknown) => {
    ElMessage.error('安装失败：' + (err as Error).message)
  })
}

/** 后期新增应用级菜单：只加一个分组 + 一个 section，不挤占顶部栏 */
const groups = [
  { id: 'general', label: '常规设置', hint: '主题、产物目录、启动行为与分享' },
  { id: 'tools', label: '工具与权限', hint: '启用禁用、访问密钥、分发白名单、卡片信息' },
  { id: 'system', label: '系统与数据', hint: '版本、数据目录、密钥与备份策略' },
  { id: 'about', label: '关于应用', hint: '配置分层与扩展约定' },
] as const
const activeGroup = ref<string>(props.group ?? 'general')
watch(() => props.group, (value) => { if (value) activeGroup.value = value })
const currentHint = () => groups.find((group) => group.id === activeGroup.value)?.hint ?? ''

const version = ref('0.1.0')
/** 穿插⑦-3：关于页「运行环境」（版本+commit / Electron / Chrome / Node） */
const runtime = ref<{ version: string; commit: string; electron: string; chrome: string; node: string } | null>(null)
const cfg = reactive({
  outputDir: '',
  launchOnBoot: false,
  tray: true,
  ttlHours: 72,
  autoUpdate: true,
  autoInstallOnAppQuit: false,
  developerMode: false,
  outputSnapshot: false,
})
const saving = ref(false)

/** 复核项 10：打包版开启开发者模式须输入与「打开开发者工具」相同的访问密钥。
 *  dev 运行下开发功能本就始终开启，无需口令；新增能力走共享探测，旧宿主窗口也能兜底。 */
const DEV_KEY_SPEC: HostApiSpec = {
  group: 'app',
  method: 'verifyDevtoolsKey',
  channel: IPC_CHANNELS.appVerifyDevtoolsKey,
  label: '开发者模式口令校验',
}
async function onDeveloperModeChange(next: unknown): Promise<void> {
  const wanted = Boolean(next)
  if (!wanted || isDev) { cfg.developerMode = wanted; return }
  try {
    // 项9：先探测本操作是否已在有效期内授权（空 key 仅作探针，缓存通过时主进程直接放行）；未授权才弹框
    const alreadyAuthed = await window.api.app.verifyDevtoolsKey('', 'developerMode').catch(() => false)
    if (!alreadyAuthed) {
      const secret = await promptSecret(
        '开发者模式',
        '开启开发者模式需要访问密钥（与打包版「打开开发者工具」同一口令）',
        '验证并开启',
      )
      await callHostApi<boolean>(DEV_KEY_SPEC, String(secret ?? ''), 'developerMode')
    }
    cfg.developerMode = true
    ElMessage.success('验证通过，点「保存应用配置」后生效')
  } catch (err) {
    // 取消 / 口令错误：保持关闭，避免无条件越权开启
    cfg.developerMode = false
    if ((err as Error)?.message && !/cancel|close/i.test(String(err))) {
      ElMessage.error((err as Error).message)
    }
  }
}

// ── 开发者模式（D-A）：显示全量工具 + 开放配置/打包入口 ──
const devState = ref<{ available: boolean; repoRoot: string | null; reason: string }>({
  available: false, repoRoot: null, reason: '',
})
const manifestOpen = ref(false)
const manifestToolId = ref('')
function openManifest(tool: ToolRuntimeState): void {
  if (!devState.value.available) {
    ElMessage.warning(`开发者工具不可用：${devState.value.reason || '当前为打包版或未找到源码仓库'}`)
    return
  }
  manifestToolId.value = tool.id
  manifestOpen.value = true
}
/** 配置表单保存后：主进程重载清单重建的目录 payload 就地刷新（权限列表/桌面同源）；
 *  catalog 缺失（主进程旧代码/重载失败）时退回主动拉取，保证刷新不静默丢失 */
function onManifestSaved(next: unknown): void {
  if (next) accept(next as ToolCatalogPayload)
  else void refreshCatalog()
}
onMounted(() => {
  void window.api.dev.state().then((s) => { devState.value = s }).catch(() => { /* 打包版不可用，保持默认 */ })
})

async function str(key: string, fallback: string): Promise<string> {
  const value = await window.api.config.get(key)
  return value === null || value === undefined ? fallback : String(value)
}
async function bool(key: string, fallback: boolean): Promise<boolean> {
  const value = await window.api.config.get(key)
  return typeof value === 'boolean' ? value : fallback
}
async function num(key: string, fallback: number): Promise<number> {
  const value = Number(await window.api.config.get(key))
  return Number.isFinite(value) ? value : fallback
}

async function loadAppConfig(): Promise<void> {
  cfg.outputDir = (await str('app.outputDir', '')) === 'null' ? '' : await str('app.outputDir', '')
  cfg.launchOnBoot = await bool('app.launchOnBoot', false)
  cfg.tray = await bool('app.tray', true)
  cfg.ttlHours = await num('app.share.ttlHours', 72)
  cfg.autoUpdate = await bool('app.autoUpdate', true)
  cfg.autoInstallOnAppQuit = await bool('app.autoInstallOnAppQuit', false)
  cfg.developerMode = await bool('app.developerMode', false)
  cfg.outputSnapshot = await bool('app.outputSnapshot', false)
  version.value = await window.api.app.version().catch(() => '0.1.0')
  runtime.value = await window.api.app.runtime().catch(() => null)
}
onMounted(() => { void loadAppConfig() })

async function saveAppConfig(): Promise<void> {
  saving.value = true
  try {
    const pairs: [string, unknown][] = [
      ['app.outputDir', cfg.outputDir.trim() || null],
      ['app.launchOnBoot', cfg.launchOnBoot],
      ['app.tray', cfg.tray],
      ['app.share.ttlHours', Number(cfg.ttlHours)],
      ['app.autoUpdate', cfg.autoUpdate],
      ['app.autoInstallOnAppQuit', cfg.autoInstallOnAppQuit],
      ['app.developerMode', cfg.developerMode],
    ]
    for (const [key, value] of pairs) await window.api.config.set(key, value)
    ElMessage.success('应用配置已保存（产物目录变更需重启生效）')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}
async function pickDir(): Promise<void> {
  const dir = await window.api.os.pickDir()
  if (dir) cfg.outputDir = dir
}
async function onTheme(next: ThemeMode): Promise<void> { await setMode(next) }
function openDataDir(): void { void window.api.app.openDataDir() }

// ── H3 日志：目录信息 / 打开 / 清空 ──
const logInfo = ref<{ dir: string; sizeBytes: number; files: { name: string; sizeBytes: number }[] } | null>(null)
/** 穿插⑦-2：日志行只显示体积/文件数（完整目录问号悬浮），避免长路径把「日志」标签挤换行 */
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

// ── N1 一键诊断报告：采集（脱敏预览）→ 确认 → 保存 zip（不上传、不联网） ──
type DiagnosisData = import('@sshk/shared').DiagnosisData
const diagData = ref<DiagnosisData | null>(null)
const diagOpen = ref(false)
const diagLoading = ref(false)
async function openDiagnosis(): Promise<void> {
  diagLoading.value = true
  try {
    diagData.value = await window.api.diagnostics.collect()
    diagOpen.value = true
  } catch (err) {
    ElMessage.error(`诊断数据采集失败：${(err as Error).message}`)
  } finally {
    diagLoading.value = false
  }
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
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message}`)
  }
}
/** 有告警的工具行数（快照异常一眼可见） */
const diagIssueTools = computed(() =>
  (diagData.value?.tools ?? []).filter((t) => !t.enabled || !t.visible || t.plugin.includes('失败') || t.warnings.length > 0),
)

// ── N2 工具健康度面板：目录裁决 + 插件 + 依赖 + 日志 error 检索 ──
type ToolHealthPayload = import('@sshk/shared').ToolHealthPayload
type ToolHealthRow = import('@sshk/shared').ToolHealthRow
/** N8 纪律：新增宿主能力一律走 callHostApi（旧 preload 快照兜底），不裸调 */
const HEALTH_SPEC: HostApiSpec = { group: 'tools', method: 'health', channel: IPC_CHANNELS.toolsHealth, label: '工具健康度' }
const health = ref<ToolHealthPayload | null>(null)
const healthOpen = ref(false)
const healthLoading = ref(false)
async function refreshHealth(): Promise<void> {
  healthLoading.value = true
  try {
    health.value = await callHostApi<ToolHealthPayload>(HEALTH_SPEC)
  } catch (err) {
    ElMessage.error(`健康数据获取失败：${(err as Error).message}`)
  } finally {
    healthLoading.value = false
  }
}
function toggleHealthPanel(): void {
  healthOpen.value = !healthOpen.value
  if (healthOpen.value && !health.value) void refreshHealth()
}
/** 异常行置顶：plugin-failed > dep-missing > warn > disabled > ok */
const HEALTH_STATE_RANK: Record<ToolHealthRow['state'], number> = {
  'plugin-failed': 0, 'dep-missing': 1, warn: 2, disabled: 3, ok: 4,
}
const healthSorted = computed(() =>
  [...(health.value?.tools ?? [])].sort(
    (a, b) => (HEALTH_STATE_RANK[a.state] ?? 9) - (HEALTH_STATE_RANK[b.state] ?? 9) || a.id.localeCompare(b.id),
  ),
)
function healthStateLabel(state: ToolHealthRow['state']): string {
  const map: Record<string, string> = {
    ok: '正常', warn: '告警', disabled: '已禁用', 'plugin-failed': '插件失败', 'dep-missing': '缺依赖',
  }
  return map[state] ?? state
}
function healthStateTag(state: ToolHealthRow['state']): 'success' | 'warning' | 'danger' | 'info' {
  if (state === 'ok') return 'success'
  if (state === 'warn' || state === 'disabled') return 'info'
  return 'danger'
}

// ── N3 配置预设分享：导出（默认脱敏）/ 导入（按 id 合并，含密钥时写回 safeStorage） ──
const PRESET_EXPORT_SPEC: HostApiSpec = { group: 'presets', method: 'export', channel: IPC_CHANNELS.presetExport, label: '配置预设导出' }
const PRESET_IMPORT_SPEC: HostApiSpec = { group: 'presets', method: 'import', channel: IPC_CHANNELS.presetImport, label: '配置预设导入' }
/** 导出是否携带明文密钥（默认关；含密钥导出为敏感操作，需二次确认） */
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
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message}`)
  }
}
async function importPresetFile(): Promise<void> {
  const [file] = await window.api.os.pickFile({ filters: [{ name: '配置预设', extensions: ['json'] }] })
  if (!file) return
  try {
    const r = await callHostApi<{ providersMerged: number; uploadProfilesMerged: number }>(PRESET_IMPORT_SPEC, file)
    ElMessage.success(`预设已导入：Provider ${r.providersMerged} / 上传 Profile ${r.uploadProfilesMerged}（按 id 合并）`)
  } catch (err) {
    ElMessage.error(`导入失败：${(err as Error).message}`)
  }
}

// ── N4 回滚快照：开关 + 查看 / 恢复 / 清空 ──
const SNAPSHOT_LIST_SPEC: HostApiSpec = { group: 'snapshots', method: 'list', channel: IPC_CHANNELS.snapshotList, label: '回滚快照' }
const SNAPSHOT_RESTORE_SPEC: HostApiSpec = { group: 'snapshots', method: 'restore', channel: IPC_CHANNELS.snapshotRestore, label: '快照恢复' }
const SNAPSHOT_CLEAR_SPEC: HostApiSpec = { group: 'snapshots', method: 'clear', channel: IPC_CHANNELS.snapshotClear, label: '快照清空' }
type SnapshotEntry = import('@sshk/repository').OutputSnapshotEntry
const snapshots = ref<SnapshotEntry[]>([])
const snapshotTime = (iso: string): string => String(iso ?? '').slice(0, 19).replace('T', ' ')
async function refreshSnapshots(): Promise<void> {
  try {
    snapshots.value = await callHostApi<SnapshotEntry[]>(SNAPSHOT_LIST_SPEC)
  } catch {
    /* 旧宿主快照兜底失败保持空列表 */
  }
}
async function saveSnapshotSwitch(): Promise<void> {
  try {
    await window.api.config.set('app.outputSnapshot', cfg.outputSnapshot)
    ElMessage.success(cfg.outputSnapshot ? '回滚快照已开启（重新生成产物时生效）' : '回滚快照已关闭')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}
async function restoreSnapshotEntry(entry: SnapshotEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `把「${entry.rel}」恢复为快照时的旧版本？当前文件将被覆盖。`,
      '恢复快照',
      { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const path = await callHostApi<string>(SNAPSHOT_RESTORE_SPEC, entry.id)
    ElMessage.success(`已恢复：${path}`)
  } catch (err) {
    ElMessage.error(`恢复失败：${(err as Error).message}`)
  }
}
async function clearSnapshotAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空全部回滚快照？被覆盖的旧产物将无法再恢复。', '清空快照', { type: 'warning' })
  } catch {
    return
  }
  try {
    const { removed } = await callHostApi<{ removed: number }>(SNAPSHOT_CLEAR_SPEC)
    ElMessage.success(`已清空 ${removed} 份快照`)
    await refreshSnapshots()
  } catch (err) {
    ElMessage.error(`清空失败：${(err as Error).message}`)
  }
}

// ── 访问密钥（只写 safeStorage，明文不回传） ──
const accessKey = ref('')
async function saveKey(): Promise<void> {
  accept(await window.api.accessKey.set(accessKey.value.trim()))
  accessKey.value = ''
  ElMessage.success('访问密钥已写入本机凭据库')
}
async function clearKey(): Promise<void> {
  accept(await window.api.accessKey.set(''))
  ElMessage.success('访问密钥已清除，受限工具将隐藏')
}

// ── 分发白名单 ──
const distribution = ref<string[]>([])
watch(() => payload.value.includeTools, (value) => { distribution.value = value ?? [] }, { immediate: true })
async function saveDistribution(): Promise<void> {
  const ids = distribution.value.length > 0 ? distribution.value : null
  accept(await window.api.tools.setDistribution(ids))
  ElMessage.success(ids ? '分发白名单已保存' : '已恢复为包含全部工具')
}

// ── 备份：settings + NeDB + 产物 → zip（导入含快照回滚与密钥迁移） ──
/** D18 密钥迁移口令：仅当 SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1 启动时主进程才采用；为空则密钥不加密直存 */
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
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message}`)
  }
}
async function importBackup(): Promise<void> {
  const [zip] = await window.api.os.pickFile({ filters: [{ name: '备份包', extensions: ['zip'] }] })
  if (!zip) return
  try {
    const result = (await window.api.backup.import(zip, migrationPassphrase.value || undefined)) as { secretsRestored: number; secretsMessage?: string }
    ElMessage.success(`导入完成${result.secretsMessage ? `：${result.secretsMessage}` : ''}；重启应用后数据完全生效`)
  } catch (err) {
    ElMessage.error(`导入失败：${(err as Error).message}`)
  }
}

// ── 运行时工具包（#35 阶段二）：.sshktool 导入 / 列表 / 卸载 ──
const runtimePackages = ref<InstalledPackageRecord[]>([])
async function refreshRuntime(): Promise<void> {
  runtimePackages.value = (await window.api.runtime.list()) as InstalledPackageRecord[]
}
async function pickRuntimePackage(): Promise<void> {
  const [zip] = await window.api.os.pickFile({
    filters: [{ name: '工具包', extensions: ['sshktool'] }],
  })
  if (!zip) return
  // 写盘前预览：内建冲突拦截 + 升降级裁决（D-C / D-D）
  let preview: InstallPreview
  try {
    preview = (await window.api.runtime.preview(zip)) as InstallPreview
  } catch (err) {
    ElMessage.error(`预览失败：${(err as Error).message}`)
    return
  }
  if (preview.status === 'builtin-conflict') {
    ElMessage.error(`工具「${preview.id}」已作为内置工具随本应用分发，禁止重复安装同名外部包（如需替换请在「工具与权限」中先禁用内置版本）`)
    return
  }
  if (preview.status === 'downgrade') {
    try {
      await ElMessageBox.confirm(
        `即将从 v${preview.installedVersion} 降级到 v${preview.newVersion}。新版本可能存在问题，降级可回退；但旧版本能力 / 数据可能不兼容，确定继续？`,
        '降级安装确认',
        { type: 'warning', confirmButtonText: '仍要降级', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  try {
    const { record, warnings } = (await window.api.runtime.install(zip)) as { record: InstalledPackageRecord; warnings: string[] }
    for (const w of warnings) ElMessage.warning(w)
    const tip = preview.status === 'upgrade' ? `（从 v${preview.installedVersion} 升级到 v${preview.newVersion}）` : ''
    ElMessage.success(`已安装 ${record.id}@${record.version}（${record.trustLevel} / ${record.sandbox} 沙箱）${tip}`)
    await refreshRuntime()
    // 导入即刷新桌面目录：新工具即时上桌面，无需手动 F5（契约校验已通过才会到这里）
    await refreshCatalog()
  } catch (err) {
    ElMessage.error(`安装失败：${(err as Error).message}`)
  }
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
  } catch (err) {
    ElMessage.error('导入失败：' + (err as Error).message)
  }
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
  } catch (err) {
    ElMessage.error(`卸载失败：${(err as Error).message}`)
  }
}
onMounted(() => { void refreshRuntime(); void refreshKeys(); void refreshLogInfo(); void refreshHealth(); void refreshSnapshots() })

// ── 工具启用 / 权限 / 元数据覆盖 ──
const editing = ref<string | null>(null)
const form = reactive({ name: '', description: '', category: '', icon: '' })
/** 图标归工具包自己（auto），宿主不再内置任何工具专属图标 */
const iconOptions = [
  { label: '工具包自带图标（auto）', value: 'auto' },
  { label: '系统默认（回退）', value: 'default' },
  { label: '不配置（回退）', value: '' },
]
function startEdit(tool: ToolRuntimeState): void {
  editing.value = tool.id
  form.name = tool.name
  form.description = tool.description
  form.category = tool.categories.join('、')
  form.icon = tool.icon
}
/** 开发功能总开关：源码 dev 运行始终开启（developerMode 不影响 dev）；打包/安装版由 developerMode 决定 */
const devFeatures = computed(() => isDev || cfg.developerMode)
/** 两类四态：正式模式只列显式可管理工具；开发功能开启时列全量（隐藏/隐式包也能配置维护） */
const manageableTools = computed(() => payload.value.tools.filter((item) => item.manageable))
const listedTools = computed(() => (devFeatures.value ? payload.value.tools : manageableTools.value))
function realVisibility(tool: ToolRuntimeState): string {
  return `${tool.visible ? '可见' : '隐藏'} / ${tool.visibility}${tool.reason ? ` / ${tool.reason}` : ''}`
}
function otherTools(tool: ToolRuntimeState): ToolRuntimeState[] {
  return payload.value.tools.filter((item) => item.id !== tool.id)
}
function pluginState(tool: ToolRuntimeState): string {
  const state = payload.value.pluginStatus[tool.id]
  if (!state) return '无主进程插件'
  if (state.loaded) return '插件已加载'
  return `插件失败：${state.error ?? '未知原因'}`
}
async function saveOverrides(id: string): Promise<void> {
  accept(await window.api.tools.setOverrides(id, { ...form }))
  editing.value = null
  ElMessage.success('工具展示信息已更新')
}
async function resetOverrides(id: string): Promise<void> {
  accept(await window.api.tools.setOverrides(id, { name: '', description: '', category: '', icon: '' }))
  editing.value = null
  ElMessage.success('已恢复工具包清单默认值')
}
async function toggleEnabled(tool: ToolRuntimeState, value: boolean): Promise<void> {
  if (!value) {
    const affected = payload.value.tools
      .filter((item) => item.id !== tool.id && (item.dependsOn.includes(tool.id) || item.configDeps.some((dep) => dep.toolId === tool.id)))
      .map((item) => item.name)
    if (affected.length > 0) {
      try {
        await ElMessageBox.confirm(`禁用「${tool.name}」会影响：${affected.join('、')}。确定继续？`, '依赖提示', { type: 'warning' })
      } catch {
        return
      }
    }
  }
  accept(await window.api.tools.setEnabled(tool.id, value))
  ElMessage.success(value ? '已启用' : '已禁用')
}
async function setGrant(tool: ToolRuntimeState, grant: string): Promise<void> {
  accept(await window.api.tools.setGrant(tool.id, grant))
}
async function setDependencies(tool: ToolRuntimeState, ids: string[]): Promise<void> {
  accept(await window.api.tools.setDependencies(tool.id, ids))
  ElMessage.success('工具依赖已保存（默认零依赖）')
}
async function cleanupOrphans(): Promise<void> {
  accept(await window.api.tools.cleanupOrphans())
  ElMessage.success('孤儿配置已清理')
}
</script>

<template>
  <el-drawer
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :model-value="modelValue"
    direction="rtl"
    size="min(780px, 82vw)"
    :with-header="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <div class="settings-shell">
      <nav class="settings-nav">
        <div class="settings-nav-title">应用设置</div>
        <button
          v-for="group in groups"
          :key="group.id"
          class="settings-nav-item"
          :class="{ active: activeGroup === group.id }"
          type="button"
          @click="activeGroup = group.id"
        >
          <span class="nav-dot" />
          <span>{{ group.label }}</span>
        </button>
        <div class="settings-nav-foot">
          <span>v{{ version }}</span>
          <span>分组可扩展</span>
        </div>
      </nav>

      <div class="settings-main">
        <header class="settings-head">
          <div>
            <strong>{{ groups.find((g) => g.id === activeGroup)?.label }}</strong>
            <small>{{ currentHint() }}</small>
          </div>
          <el-button size="small" text @click="emit('update:modelValue', false)">关闭</el-button>
        </header>

        <div class="settings-scroll">
          <!-- 常规 -->
          <template v-if="activeGroup === 'general'">
            <section class="settings-card">
              <div class="card-title">常规</div>
              <!-- plans/01 全局表单规范样板：2 列栅格 + 等宽控件 + hint 一句话 + 长解释问号弹出 -->
              <el-form size="small" label-position="top">
                <FormGrid>
                  <el-form-item label="主题模式">
                    <el-select :model-value="mode" @change="onTheme">
                      <el-option label="暗黑" value="dark" />
                      <el-option label="亮色" value="light" />
                      <el-option label="跟随系统" value="system" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="分享有效期">
                    <el-input-number v-model="cfg.ttlHours" :min="1" :max="720" />
                    <FormHint inline>小时（到期即失效）</FormHint>
                  </el-form-item>
                  <el-form-item label="开机自启">
                    <div class="switch-row">
                      <span class="switch-label">开机自启</span>
                      <el-switch v-model="cfg.launchOnBoot" />
                    </div>
                  </el-form-item>
                  <el-form-item label="系统托盘">
                    <div class="switch-row">
                      <span class="switch-label">系统托盘</span>
                      <el-switch v-model="cfg.tray" />
                    </div>
                  </el-form-item>
                  <el-form-item label="自动更新">
                    <div class="switch-row">
                      <span class="switch-label">自动更新
                        <FormHint inline detail="新版本仅在后台下载，完成后点「立即安装」重启生效">默认开</FormHint>
                      </span>
                      <el-switch v-model="cfg.autoUpdate" />
                    </div>
                  </el-form-item>
                  <el-form-item label="自动安装更新">
                    <div class="switch-row">
                      <span class="switch-label">自动安装更新
                        <FormHint inline detail="默认关：新版本仅在后台下载，可在「系统与数据 → 更新」点「立即安装」；开启后退出应用时自动安装">默认关</FormHint>
                      </span>
                      <el-switch v-model="cfg.autoInstallOnAppQuit" />
                    </div>
                  </el-form-item>
                  <el-form-item label="开发者模式">
                    <div class="switch-row">
                      <span class="switch-label">开发者模式
                        <FormHint inline detail="仅打包版生效；源码 dev 运行时开发功能恒开。开启后显示全部工具并开放配置入口，需输入开发者工具访问密钥">打包版</FormHint>
                      </span>
                      <el-switch :model-value="cfg.developerMode" @change="(v: unknown) => onDeveloperModeChange(v)" />
                    </div>
                  </el-form-item>
                  <el-form-item class="full" label="产物目录">
                    <div class="combo">
                      <el-input clearable v-model="cfg.outputDir" placeholder="留空 = 默认 userData/sshk-data" />
                      <el-button @click="pickDir">选择</el-button>
                    </div>
                    <FormHint>变更需重启生效；路径不进备份包</FormHint>
                  </el-form-item>
                </FormGrid>
              </el-form>
              <div class="card-actions">
                <el-button type="primary" size="small" :loading="saving" @click="saveAppConfig">保存应用配置</el-button>
              </div>
            </section>
          </template>

          <!-- 工具与权限 -->
          <template v-else-if="activeGroup === 'tools'">
            <section class="settings-card">
              <div class="card-title">
                工具健康度
                <el-tag v-if="health" size="small" :type="health.abnormal === 0 ? 'success' : 'warning'">
                  {{ health.ok }} 正常 / {{ health.abnormal }} 异常
                </el-tag>
                <el-tag v-else size="small" type="info">加载中…</el-tag>
                <el-button size="small" text type="primary" :loading="healthLoading" @click="toggleHealthPanel">
                  {{ healthOpen ? '收起面板' : '展开面板' }}
                </el-button>
                <el-button size="small" text :loading="healthLoading" @click="refreshHealth">刷新</el-button>
              </div>
              <template v-if="healthOpen && health">
                <div v-for="row in healthSorted" :key="row.id" class="health-row" :class="{ 'health-row-bad': row.state !== 'ok' }">
                  <div class="health-head">
                    <el-tag size="small" :type="healthStateTag(row.state)">{{ healthStateLabel(row.state) }}</el-tag>
                    <strong>{{ row.name }}</strong>
                    <span class="hint">{{ row.id }} · 通道 {{ row.channels }}</span>
                    <el-button v-if="row.state !== 'ok'" size="small" text type="primary" class="health-log-btn" @click="openLogDir">
                      打开日志定位
                    </el-button>
                  </div>
                  <div v-if="row.plugin !== '已加载' && row.plugin !== '无主进程插件'" class="warning-line">插件：{{ row.plugin }}</div>
                  <div v-if="row.missingDeps.length" class="warning-line">缺失硬依赖：{{ row.missingDeps.join('、') }}</div>
                  <div v-for="(w, i) in row.warnings" :key="'w' + i" class="warning-line">{{ w }}</div>
                  <div v-if="row.lastError" class="warning-line">最近错误 [{{ row.lastError.time }}] {{ row.lastError.text }}</div>
                </div>
              </template>
              <div v-else class="hint">
                按工具聚合加载状态 / 主进程插件 / 依赖缺失 / 最近日志错误；异常行可一键打开日志目录定位。
              </div>
            </section>

            <section class="settings-card">
              <div class="card-title">访问密钥与权限</div>
              <div class="kv-line">
                <span>当前状态</span>
                <el-tag size="small" :type="payload.hasAccessKey ? 'success' : 'info'">
                  {{ payload.hasAccessKey ? '已配置（受限工具已解锁）' : '未配置' }}
                </el-tag>
              </div>
              <div class="inline-form">
                <el-input v-model="accessKey" type="password" show-password placeholder="输入应用访问密钥" style="max-width: 320px" />
                <el-button size="small" type="primary" @click="saveKey">保存密钥</el-button>
                <el-button size="small" @click="clearKey">清除</el-button>
              </div>
              <div class="hint">
                密钥只写入系统凭据库（safeStorage），settings.json 仅保存 sha256 摘要，明文永不下发渲染层。工具设为「需访问密钥」后，未配置时不出现在桌面。完整体系（五套口令对照 / 进程边界 / 脱敏红线）见 docs/02-architecture/安全与密钥体系.md。
              </div>
            </section>

            <section v-if="isDev" class="settings-card">
              <div class="card-title">分发白名单（仅开发）</div>
              <div class="hint" style="margin-bottom: 10px">留空 = 包含全部工具；选定后仅这些工具随当前分发可见（运行时可见性，不影响安装包内容）。要「构建时只打选中的工具」，打包前设环境变量 SSHK_BUILTIN_TOOLS=工具id1,工具id2（依赖自动搭进去），见发布文档。</div>
              <div class="inline-form">
                <el-select v-model="distribution" multiple collapse-tags clearable placeholder="全部工具" style="min-width: 340px">
                  <el-option v-for="tool in payload.tools" :key="tool.id" :label="tool.name" :value="tool.id" />
                </el-select>
                <el-button size="small" type="primary" @click="saveDistribution">保存白名单</el-button>
              </div>
            </section>

            <section v-if="payload.orphans.length" class="settings-card orphan-box">
              <div class="card-title">孤儿配置</div>
              <div class="hint">以下工具已从注册表删除，但 settings.json 仍有残留：{{ payload.orphans.join('、') }}</div>
              <div class="card-actions"><el-button size="small" type="danger" plain @click="cleanupOrphans">清理孤儿配置</el-button></div>
            </section>

            <section class="settings-card">
              <div class="card-title">
                工具管理（{{ listedTools.length }}）
                <span v-if="devFeatures" class="hint"> · {{ isDev ? '源码开发：' : '开发者模式：' }}全量显示（含隐藏/隐式）</span>
                <el-button v-if="isDev" size="small" type="primary" plain class="create-tool-btn" @click="emit('create-tool')">
                  创建工具
                </el-button>
              </div>
              <div v-if="devFeatures && !devState.available" class="warning-line">
                配置 / 打包入口不可用：{{ devState.reason }}
              </div>
              <div v-for="tool in listedTools" :key="tool.id" class="tool-manage-row">
                <div class="tool-manage-head">
                  <ToolIcon :icon="tool.icon" :tool-id="tool.id" :name="tool.name" :size="36" />
                  <div class="tool-manage-title">
                    <strong>{{ tool.name }}</strong>
                    <small>{{ tool.categories.join(' / ') }} · {{ tool.id }}</small>
                  </div>
                  <el-switch :model-value="tool.enabled" size="small" @change="(v: unknown) => toggleEnabled(tool, Boolean(v))" />
                  <el-button
                    v-if="devFeatures"
                    size="small"
                    type="success"
                    text
                    :title="devState.available ? '开发者配置（tool.manifest.json / 构建打包）' : devState.reason"
                    @click="openManifest(tool)"
                  >
                    配置
                  </el-button>
                  <el-button
                    size="small"
                    type="primary"
                    text
                    title="覆盖卡片名称 / 描述 / 分类 / 图标等展示信息，不改工具源码"
                    @click="editing === tool.id ? (editing = null) : startEdit(tool)"
                  >
                    {{ editing === tool.id ? '收起' : '展示定制' }}
                  </el-button>
                </div>
                <div class="tool-manage-meta tag-row">
                  <el-tag size="small" :type="tool.visible ? 'success' : 'info'">{{ tool.visible ? '可见' : (tool.reason ?? '隐藏') }}</el-tag>
                  <el-tag v-if="devFeatures" size="small" type="warning" plain>真实：{{ realVisibility(tool) }}</el-tag>
                  <el-tag v-if="devFeatures && !tool.manageable" size="small" type="danger" plain>正式模式不可管理</el-tag>
                </div>
                <div class="tool-manage-meta">
                  <span>权限要求：</span>
                  <el-select :model-value="tool.requiredGrant ?? ''" size="small" style="width: 160px" @change="(v: unknown) => setGrant(tool, String(v ?? ''))">
                    <el-option label="公开" value="" />
                    <el-option label="需访问密钥" :value="ACCESS_GRANT" />
                  </el-select>
                  <span :class="['meta-chip', { 'meta-chip-warn': tool.pluginError }]">{{ pluginState(tool) }}</span>
                  <span v-if="tool.dependsOn.length" class="meta-chip">硬依赖：{{ tool.dependsOn.join('、') }}</span>
                  <span v-if="tool.configDeps.length" class="meta-chip">软依赖：{{ tool.configDeps.map((d) => d.toolId).join('、') }}</span>
                </div>
                <div v-for="(warning, i) in tool.warnings" :key="i" class="warning-line">{{ warning }}</div>
                <div v-if="editing === tool.id" class="tool-manage-body">
                  <el-form size="small" label-position="top">
                    <FormGrid>
                      <el-form-item label="显示名称"><el-input clearable v-model="form.name" /></el-form-item>
                      <el-form-item label="分类 / 标签">
                        <el-input clearable v-model="form.category" />
                        <FormHint>逗号 / 顿号分隔；标签内可含空格</FormHint>
                      </el-form-item>
                      <el-form-item class="full" label="描述">
                        <el-input clearable v-model="form.description" type="textarea" :rows="2" />
                      </el-form-item>
                      <el-form-item v-if="isDev" class="full" label="图标">
                        <el-select v-model="form.icon" filterable allow-create default-first-option>
                          <el-option v-for="opt in iconOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                        <FormHint detail="auto = 工具包自带 assets/icon.svg；也可直接粘贴 http(s) URL / data:image URI；留空、无效或加载失败时回退系统默认图标">auto=工具包自带；可填 URL / data:image</FormHint>
                      </el-form-item>
                      <el-form-item v-if="isDev" class="full" label="硬依赖">
                        <el-select
                          :model-value="tool.dependsOn"
                          multiple
                          clearable
                          placeholder="默认零依赖（禁用其它工具不影响本工具）"
                          @change="(v: unknown) => setDependencies(tool, Array.isArray(v) ? v.map(String) : [])"
                        >
                          <el-option v-for="other in otherTools(tool)" :key="other.id" :label="other.name" :value="other.id" />
                        </el-select>
                        <FormHint detail="依赖工具不可见时本工具一并隐藏；清空即恢复零依赖隔离">依赖工具隐藏时本工具一并隐藏</FormHint>
                      </el-form-item>
                    </FormGrid>
                  </el-form>
                  <div class="card-actions">
                    <el-button size="small" type="primary" @click="saveOverrides(tool.id)">保存展示信息</el-button>
                    <el-button size="small" @click="resetOverrides(tool.id)">恢复默认</el-button>
                  </div>
                </div>
              </div>
            </section>
          </template>

          <!-- 系统与数据 -->
          <template v-else-if="activeGroup === 'system'">
            <section class="settings-card">
              <div class="card-title">更新</div>
              <div class="kv-line"><span>当前版本</span><strong>v{{ version }}</strong></div>
              <div class="kv-line">
                <span>更新状态</span>
                <el-tag size="small" :type="updateTagType">{{ updateStatusText }}</el-tag>
                <span v-if="updaterState.phase === 'downloading'" class="hint">下载中 {{ updaterState.percent }}%</span>
              </div>
              <el-progress
                v-if="updaterState.phase === 'downloading'"
                :percentage="updaterState.percent ?? 0"
                :stroke-width="8"
                style="margin: 6px 0 10px"
              />
              <div
                v-if="updaterState.version && (updaterState.phase === 'available' || updaterState.phase === 'downloading' || updaterState.phase === 'downloaded')"
                class="kv-line"
              >
                <span>最新版本</span><strong>v{{ updaterState.version }}</strong>
              </div>
              <div class="card-actions">
                <el-button
                  size="small"
                  :loading="updaterState.phase === 'checking' || updaterState.phase === 'downloading'"
                  @click="checkUpdate"
                >
                  {{ updaterState.phase === 'checking' ? '检查中…' : '检查更新' }}
                </el-button>
                <el-button v-if="updaterState.phase === 'downloaded'" size="small" type="primary" @click="installUpdate">立即安装</el-button>
              </div>
              <div v-if="updaterState.phase === 'error'" class="warning-line">{{ updaterState.error }}</div>
              <div class="hint">自动更新默认开启（见「常规」）；新版本后台下载，完成后点「立即安装」重启生效。若需在退出应用时自动安装，请在「常规 → 自动安装更新」开启（默认关闭）。</div>
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
              <div class="hint">D18：仅当以 SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1 启动时口令才生效（加密备份内密钥，导入时用同一口令还原）；开关关闭时口令被忽略、密钥不迁移。跨设备迁移需两端同开。</div>
            </section>

            <section class="settings-card">
              <div class="card-title">配置预设</div>
              <div class="switch-row">
                <span class="switch-label">
                  包含密钥
                  <el-tooltip content="开启后，导出预设会携带模型 API Key 与上传密钥明文，用于可信设备间完整迁移。默认关闭（只导出配置、不含密钥）。含密钥文件请妥善保管，导入会自动写回本机密钥库。" placement="top">
                    <span class="tip-icon">?</span>
                  </el-tooltip>
                </span>
                <el-switch v-model="presetIncludeSecrets" size="small" />
                <span v-if="presetIncludeSecrets" class="hint danger-text">当前将导出明文密钥，请仅用于可信设备</span>
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
                <el-input clearable v-model="keyPem" type="textarea" :rows="8" placeholder="粘贴 PEM 公钥内容（-----BEGIN PUBLIC KEY----- ...）" />
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
                <el-switch v-model="cfg.outputSnapshot" size="small" @change="saveSnapshotSwitch" />
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


          </template>

          <!-- 关于 -->
          <template v-else>
            <section class="settings-card">
              <div class="card-title">运行环境</div>
              <template v-if="runtime">
                <div class="kv-line"><span>版本</span><strong>v{{ runtime.version }}（{{ runtime.commit }}）</strong></div>
                <div class="kv-line"><span>Electron</span><span class="hint">{{ runtime.electron }}</span></div>
                <div class="kv-line"><span>Chrome</span><span class="hint">{{ runtime.chrome }}</span></div>
                <div class="kv-line"><span>Node.js</span><span class="hint">{{ runtime.node }}</span></div>
              </template>
              <div v-else class="hint">运行环境信息加载中…</div>
            </section>
            <section class="settings-card">
              <div class="card-title">配置分层约定</div>
              <table class="about-table">
                <thead><tr><th>层级</th><th>落盘</th><th>入口</th></tr></thead>
                <tbody>
                  <tr><td>应用 / 系统</td><td><code>app.*</code></td><td>顶部「设置」→ 常规 / 工具与权限 / 系统与数据</td></tr>
                  <tr><td>工具自有</td><td><code>tools.&lt;id&gt;.*</code></td><td>工具左侧「工具配置」页（single / menu 两种形态，由工具包清单声明）</td></tr>
                  <tr><td>工具清单</td><td><code>tools/&lt;id&gt;/tool.manifest.json</code></td><td>名称、描述、多分类标签、图标、菜单、配置项、默认配置、依赖、权限、插件入口</td></tr>
                  <tr><td>密钥</td><td><code>secrets.bin</code>（safeStorage）</td><td>主进程注入，永不下发渲染层</td></tr>
                </tbody>
              </table>
              <div class="hint" style="margin-top: 12px">后期新增应用级菜单只需在本抽屉加一个分组；新增工具只需把工具包放进 <code>tools/&lt;id&gt;/</code> 并写好自己的 tool.manifest.json —— 宿主构建期自动发现，零改动接入。运行时导入 / 安装 / 卸载外部工具包已列入后续路线图。</div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </el-drawer>
  <ToolManifestDialog v-model="manifestOpen" :tool-id="manifestToolId" @saved="onManifestSaved" />

  <!-- N1 诊断摘要预览：确认脱敏内容后才落盘 -->
  <el-dialog
    v-model="diagOpen"
    title="诊断报告预览（已脱敏，确认后保存 zip）"
    width="640px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
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
</template>

<style scoped>
/* 预设「包含密钥」开关：长说明进 tooltip，开启后红色警示 */
.tip-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; margin-left: 4px;
  border: 1px solid var(--el-text-color-placeholder); border-radius: 50%;
  font-size: 10px; line-height: 1; color: var(--el-text-color-placeholder); cursor: help;
}
.danger-text { color: var(--el-color-danger); }
/* 穿插⑦-2：日志行标签不换行、摘要单行省略（完整目录 tooltip 悬浮） */
.kv-label { flex: none; white-space: nowrap; }
.log-summary { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* N2 工具健康度面板 */
.health-row { padding: 8px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.health-row:last-child { border-bottom: none; }
.health-row-bad { background: var(--el-fill-color-light); border-radius: 6px; padding: 8px; margin-bottom: 6px; }
.health-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.health-log-btn { margin-left: auto; }

/* N4 快照行：长路径单行省略 */
.snap-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
