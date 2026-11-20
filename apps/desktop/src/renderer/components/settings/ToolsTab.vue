<script setup lang="ts">
/**
 * 应用设置 · 工具与权限 tab：健康度 / 访问密钥 / 分发白名单 / 孤儿配置 / 工具管理。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IPC_CHANNELS, type ToolCatalogPayload, type ToolRuntimeState } from '@sshk/shared'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { useToolCatalog } from '../../composables/useToolCatalog'
import { appConfig } from '../../composables/useAppConfig'
import ToolIcon from '../ToolIcon.vue'
import ToolManifestDialog from '../ToolManifestDialog.vue'

const isDev = import.meta.env.DEV
const emit = defineEmits<{ 'create-tool': [] }>()
const { payload, accept, refresh: refreshCatalog } = useToolCatalog()

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
function onManifestSaved(next: unknown): void {
  if (next) accept(next as ToolCatalogPayload)
  else void refreshCatalog()
}

// ── N2 工具健康度面板 ──
type ToolHealthPayload = import('@sshk/shared').ToolHealthPayload
type ToolHealthRow = import('@sshk/shared').ToolHealthRow
const HEALTH_SPEC: HostApiSpec = { group: 'tools', method: 'health', channel: IPC_CHANNELS.toolsHealth, label: '工具健康度' }
const health = ref<ToolHealthPayload | null>(null)
const healthOpen = ref(false)
const healthLoading = ref(false)
async function refreshHealth(): Promise<void> {
  healthLoading.value = true
  try { health.value = await callHostApi<ToolHealthPayload>(HEALTH_SPEC) }
  catch (err) { ElMessage.error(`健康数据获取失败：${(err as Error).message}`) }
  finally { healthLoading.value = false }
}
function toggleHealthPanel(): void {
  healthOpen.value = !healthOpen.value
  if (healthOpen.value && !health.value) void refreshHealth()
}
const HEALTH_STATE_RANK: Record<ToolHealthRow['state'], number> = {
  'plugin-failed': 0, 'dep-missing': 1, warn: 2, disabled: 3, ok: 4,
}
const healthSorted = computed(() =>
  [...(health.value?.tools ?? [])].sort(
    (a, b) => (HEALTH_STATE_RANK[a.state] ?? 9) - (HEALTH_STATE_RANK[b.state] ?? 9) || a.id.localeCompare(b.id),
  ),
)
function healthStateLabel(state: ToolHealthRow['state']): string {
  const map: Record<string, string> = { ok: '正常', warn: '告警', disabled: '已禁用', 'plugin-failed': '插件失败', 'dep-missing': '缺依赖' }
  return map[state] ?? state
}
function healthStateTag(state: ToolHealthRow['state']): 'success' | 'warning' | 'danger' | 'info' {
  if (state === 'ok') return 'success'
  if (state === 'warn' || state === 'disabled') return 'info'
  return 'danger'
}
/** 健康面板「打开日志定位」：工具与权限 tab 自带（不依赖 System tab 的 logInfo） */
async function openLogDir(): Promise<void> {
  try {
    const info = await window.api.logs.getDir()
    void window.api.os.shellOpen(info.dir)
  } catch { ElMessage.warning('日志目录不可用') }
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

// ── 工具启用 / 权限 / 元数据覆盖 ──
const editing = ref<string | null>(null)
const form = reactive({ name: '', description: '', category: '', icon: '' })
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
const devFeatures = computed(() => isDev || appConfig.developerMode)
const manageableTools = computed(() => payload.value.tools.filter((item) => item.manageable))
const listedTools = computed(() => (devFeatures.value ? payload.value.tools : manageableTools.value))
function realVisibility(tool: ToolRuntimeState): string {
  return `${tool.visible ? '可见' : '隐藏'} / ${tool.visibility}${tool.reason ? ` / ${tool.reason}` : ''}`
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
        await ElMessageBox.confirm(`禁用「${tool.name}」会影响：${affected.join('、')}。确定继续？`, '依赖提示', { type: 'warning', closeOnClickModal: false, closeOnPressEscape: false })
      } catch { return }
    }
  }
  accept(await window.api.tools.setEnabled(tool.id, value))
  ElMessage.success(value ? '已启用' : '已禁用')
}
async function cleanupOrphans(): Promise<void> {
  accept(await window.api.tools.cleanupOrphans())
  ElMessage.success('孤儿配置已清理')
}

onMounted(() => {
  void window.api.dev.state().then((s) => { devState.value = s }).catch(() => { /* 打包版不可用 */ })
  void refreshHealth()
})
</script>

<template>
  <div class="tools-tab">
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
            <el-button v-if="row.state !== 'ok'" size="small" text type="primary" class="health-log-btn" @click="openLogDir">打开日志定位</el-button>
          </div>
          <div v-if="row.plugin !== '已加载' && row.plugin !== '无主进程插件'" class="warning-line">插件：{{ row.plugin }}</div>
          <div v-if="row.missingDeps.length" class="warning-line">缺失硬依赖：{{ row.missingDeps.join('、') }}</div>
          <div v-for="(w, i) in row.warnings" :key="'w' + i" class="warning-line">{{ w }}</div>
          <div v-if="row.lastError" class="warning-line">最近错误 [{{ row.lastError.time }}] {{ row.lastError.text }}</div>
        </div>
      </template>
      <div v-else class="hint">按工具聚合加载状态 / 主进程插件 / 依赖缺失 / 最近日志错误；异常行可一键打开日志目录定位。</div>
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
      <div class="hint">密钥只写入系统凭据库（safeStorage），settings.json 仅保存 sha256 摘要，明文永不下发渲染层。工具设为「需访问密钥」后，未配置时不出现在桌面。完整体系见 docs/02-architecture/安全与密钥体系.md。</div>
    </section>

    <section v-if="isDev" class="settings-card">
      <div class="card-title">分发白名单（仅开发）</div>
      <div class="hint" style="margin-bottom: 10px">留空 = 包含全部工具；选定后仅这些工具随当前分发可见（运行时可见性，不影响安装包内容）。要「构建时只打选中的工具」，打包前设环境变量 SSHK_BUILD_TOOLS=工具id1,工具id2。</div>
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
        <el-button v-if="isDev" size="small" type="primary" plain class="create-tool-btn" @click="emit('create-tool')">创建工具</el-button>
      </div>
      <div v-if="devFeatures && !devState.available" class="warning-line">配置 / 打包入口不可用：{{ devState.reason }}</div>
      <div v-for="tool in listedTools" :key="tool.id" class="tool-manage-row">
        <div class="tool-manage-head">
          <ToolIcon :icon="tool.icon" :tool-id="tool.id" :name="tool.name" :size="36" />
          <div class="tool-manage-title">
            <strong>{{ tool.name }}</strong>
            <small>{{ tool.categories.join(' / ') }} · {{ tool.id }}</small>
          </div>
          <el-switch :model-value="tool.enabled" size="small" @change="(v: unknown) => toggleEnabled(tool, Boolean(v))" />
          <el-button v-if="devFeatures" size="small" type="success" text
            :title="devState.available ? '开发者配置（tool.manifest.json / 构建打包）' : devState.reason" @click="openManifest(tool)">配置</el-button>
          <el-button size="small" type="primary" text title="覆盖卡片名称 / 描述 / 分类 / 图标等展示信息，不改工具源码"
            @click="editing === tool.id ? (editing = null) : startEdit(tool)">
            {{ editing === tool.id ? '收起' : '展示定制' }}
          </el-button>
        </div>
        <div class="tool-manage-meta tag-row">
          <el-tag size="small" :type="tool.visible ? 'success' : 'info'">{{ tool.visible ? '可见' : (tool.reason ?? '隐藏') }}</el-tag>
          <el-tag v-if="devFeatures" size="small" type="warning" plain>真实：{{ realVisibility(tool) }}</el-tag>
          <el-tag v-if="devFeatures && !tool.manageable" size="small" type="danger" plain>正式模式不可管理</el-tag>
        </div>
        <div class="tool-manage-meta">
          <!-- 权限要求/硬依赖是功能配置非展示定制（用户 2026-11-18）：UI 不提供编辑（dev/build 都不改），
               统一在 dev 的 tool.manifest.json 中修改；此处仅只读展示，改权限走 requiredGrant、改依赖走 dependsOn -->
          <el-tag v-if="tool.requiredGrant" size="small" type="danger" plain>需访问密钥</el-tag>
          <span :class="['meta-chip', { 'meta-chip-warn': tool.pluginError }]">{{ pluginState(tool) }}</span>
          <span v-if="tool.dependsOn.length" class="meta-chip">硬依赖：{{ tool.dependsOn.join('、') }}</span>
          <span v-if="tool.configDeps.length" class="meta-chip">软依赖：{{ tool.configDeps.map((d) => d.toolId).join('、') }}</span>
        </div>
        <div v-for="(warning, i) in tool.warnings" :key="i" class="warning-line">{{ warning }}</div>
        <div v-if="editing === tool.id" class="tool-manage-body">
          <el-form size="small" label-position="top">
            <FormGrid>
              <el-form-item label="显示名称" required><el-input clearable v-model="form.name" /></el-form-item>
              <el-form-item label="分类 / 标签">
                <el-input clearable v-model="form.category" />
                <FormHint>逗号 / 顿号分隔；标签内可含空格</FormHint>
              </el-form-item>
              <el-form-item class="full" label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
              <el-form-item v-if="isDev" class="full" label="图标">
                <el-select v-model="form.icon" filterable allow-create default-first-option>
                  <el-option v-for="opt in iconOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <FormHint detail="auto = 工具包自带 assets/icon.svg；也可直接粘贴 http(s) URL / data:image URI；留空、无效或加载失败时回退系统默认图标">auto=工具包自带；可填 URL / data:image</FormHint>
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
  </div>

  <ToolManifestDialog v-model="manifestOpen" :tool-id="manifestToolId" @saved="onManifestSaved" />
</template>
