<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ACCESS_GRANT } from '@sshk/shared'
import type { ThemeMode, ToolRuntimeState, InstallPreview } from '@sshk/shared'

/** 开发协助配置（分发白名单 / 图标覆盖 / 硬依赖）只在 dev 展示，发布版隐藏 */
const isDev = import.meta.env.DEV
import ToolIcon from './ToolIcon.vue'
import ToolManifestDialog from './ToolManifestDialog.vue'
import { useToolCatalog } from '../composables/useToolCatalog'
import type { InstalledPackageRecord } from '@sshk/shared'
import { useTheme } from '../composables/useTheme'
import { useUpdater } from '../composables/useUpdater'

const props = defineProps<{ modelValue: boolean; group?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
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
  if (updaterState.value.phase === 'checking' || updaterState.value.phase === 'downloading') return
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
  { id: 'general', label: '常规', hint: '主题、产物目录、启动行为与分享' },
  { id: 'tools', label: '工具与权限', hint: '启用禁用、访问密钥、分发白名单、卡片信息' },
  { id: 'system', label: '系统与数据', hint: '版本、数据目录、密钥与备份策略' },
  { id: 'about', label: '关于', hint: '配置分层与扩展约定' },
] as const
const activeGroup = ref<string>(props.group ?? 'general')
watch(() => props.group, (value) => { if (value) activeGroup.value = value })
const currentHint = () => groups.find((group) => group.id === activeGroup.value)?.hint ?? ''

const version = ref('0.1.0')
const cfg = reactive({
  outputDir: '',
  launchOnBoot: false,
  tray: true,
  ttlHours: 72,
  autoUpdate: true,
  developerMode: false,
})
const saving = ref(false)

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
  cfg.developerMode = await bool('app.developerMode', false)
  version.value = await window.api.app.version().catch(() => '0.1.0')
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
onMounted(() => { void refreshRuntime(); void refreshKeys() })

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
              <el-form label-width="120px" size="small">
                <el-form-item label="主题模式">
                  <el-select :model-value="mode" style="width: 200px" @change="onTheme">
                    <el-option label="暗黑" value="dark" />
                    <el-option label="亮色" value="light" />
                    <el-option label="跟随系统" value="system" />
                  </el-select>
                </el-form-item>
                <el-form-item label="产物目录">
                  <div style="display:flex; gap:8px; width:100%">
                    <el-input v-model="cfg.outputDir" placeholder="留空 = 默认 userData/sshk-data" />
                    <el-button @click="pickDir">选择</el-button>
                  </div>
                  <div class="hint">变更需重启应用生效；本机路径不会进入备份包</div>
                </el-form-item>
                <el-form-item label="开机自启"><el-switch v-model="cfg.launchOnBoot" /></el-form-item>
                <el-form-item label="系统托盘"><el-switch v-model="cfg.tray" /></el-form-item>
                <el-form-item label="自动更新"><el-switch v-model="cfg.autoUpdate" /></el-form-item>
                <el-form-item label="开发者模式">
                  <el-switch v-model="cfg.developerMode" />
                  <span class="hint" style="margin-left:8px">仅作用于打包/安装版：开启后显示全部工具并开放配置入口。源码 dev 运行时开发功能始终开启，不受此开关影响</span>
                </el-form-item>
                <el-form-item label="分享有效期">
                  <el-input-number v-model="cfg.ttlHours" :min="1" :max="720" size="small" />
                  <span class="hint" style="margin-left:8px">小时（token 到期即失效）</span>
                </el-form-item>
              </el-form>
              <div class="card-actions">
                <el-button type="primary" size="small" :loading="saving" @click="saveAppConfig">保存应用配置</el-button>
              </div>
            </section>
          </template>

          <!-- 工具与权限 -->
          <template v-else-if="activeGroup === 'tools'">
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
              <div class="hint">密钥只写入系统凭据库（safeStorage），settings.json 仅保存 sha256 摘要，明文永不下发渲染层。工具设为「需访问密钥」后，未配置时不出现在桌面。</div>
            </section>

            <section v-if="isDev" class="settings-card">
              <div class="card-title">分发白名单（仅开发）</div>
              <div class="hint" style="margin-bottom: 10px">留空 = 包含全部工具；选定后仅这些工具随当前分发可见。删除工具包后残留的配置会在下方提示清理。</div>
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
                  <el-tag size="small" :type="tool.visible ? 'success' : 'info'">{{ tool.visible ? '可见' : (tool.reason ?? '隐藏') }}</el-tag>
                  <el-tag v-if="devFeatures" size="small" type="warning" plain>真实：{{ realVisibility(tool) }}</el-tag>
                  <el-tag v-if="devFeatures && !tool.manageable" size="small" type="danger" plain>正式模式不可管理</el-tag>
                  <el-switch :model-value="tool.enabled" size="small" @change="(v: unknown) => toggleEnabled(tool, Boolean(v))" />
                  <el-button
                    v-if="devFeatures"
                    size="small"
                    type="success"
                    text
                    :title="devState.available ? '打开工具清单配置与打包表单' : devState.reason"
                    @click="openManifest(tool)"
                  >
                    配置
                  </el-button>
                  <el-button size="small" type="primary" text @click="editing === tool.id ? (editing = null) : startEdit(tool)">
                    {{ editing === tool.id ? '收起' : '编辑' }}
                  </el-button>
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
                  <el-form label-width="90px" size="small">
                    <el-form-item label="显示名称"><el-input v-model="form.name" /></el-form-item>
                    <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
                    <el-form-item label="分类 / 标签">
                      <el-input v-model="form.category" />
                      <div class="hint">多个分类用逗号 / 顿号 / 分号分隔，例如：邮件营销、数据分析</div>
                    </el-form-item>
                    <el-form-item v-if="isDev" label="图标">
                      <el-select v-model="form.icon" filterable allow-create default-first-option style="width: 100%">
                        <el-option v-for="opt in iconOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                      </el-select>
                      <div class="hint">auto = 工具包自带 assets/icon.svg；也可直接粘贴 http(s) URL / data:image URI；留空、无效或加载失败时回退系统默认图标</div>
                    </el-form-item>
                    <el-form-item v-if="isDev" label="硬依赖">
                      <el-select
                        :model-value="tool.dependsOn"
                        multiple
                        clearable
                        placeholder="默认零依赖（禁用其它工具不影响本工具）"
                        style="width: 100%"
                        @change="(v: unknown) => setDependencies(tool, Array.isArray(v) ? v.map(String) : [])"
                      >
                        <el-option v-for="other in otherTools(tool)" :key="other.id" :label="other.name" :value="other.id" />
                      </el-select>
                      <div class="hint">依赖工具不可见时，本工具一并隐藏；清空即恢复零依赖隔离</div>
                    </el-form-item>
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
              <div class="hint">自动更新默认开启（见「常规」）；新版本后台下载，完成后点「立即安装」重启生效。</div>
            </section>

            <section class="settings-card">
              <div class="card-title">系统与数据</div>
              <div class="kv-line"><span>应用版本</span><strong>v{{ version }}</strong></div>
              <div class="kv-line"><span>数据目录</span><el-button size="small" type="primary" text @click="openDataDir">打开</el-button></div>
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
                <el-input v-model="keyLabel" placeholder="发布者名称（如：合作方 A）" style="margin-bottom: 10px" />
                <el-input v-model="keyPem" type="textarea" :rows="8" placeholder="粘贴 PEM 公钥内容（-----BEGIN PUBLIC KEY----- ...）" />
                <template #footer>
                  <el-button size="small" @click="keyImportOpen = false">取消</el-button>
                  <el-button size="small" type="primary" @click="importKey">导入</el-button>
                </template>
              </el-dialog>
              <div class="kv-line"><span class="hint">未签名包以 utility 沙箱安装；main 权限需要有效签名与显式信任</span></div>
            </section>
          </template>

          <!-- 关于 -->
          <template v-else>
            <section class="settings-card">
              <div class="card-title">配置分层约定</div>
              <table class="about-table">
                <thead><tr><th>层级</th><th>落盘</th><th>入口</th></tr></thead>
                <tbody>
                  <tr><td>应用 / 系统</td><td><code>app.*</code></td><td>顶部「设置」→ 常规 / 工具与权限 / 系统与数据</td></tr>
                  <tr><td>工具自有</td><td><code>tools.&lt;id&gt;.*</code></td><td>工具左侧「工具配置」页（single / tabs / menu 由工具包清单声明）</td></tr>
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
  <ToolManifestDialog v-model="manifestOpen" :tool-id="manifestToolId" />
</template>
