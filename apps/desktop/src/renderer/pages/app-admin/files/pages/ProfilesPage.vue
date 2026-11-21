<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { VueDraggable } from 'vue-draggable-plus'
import {
  ArrowDown,
  Check,
  Connection,
  Delete,
  Edit,
  FolderOpened,
  Plus,
  Rank,
  Refresh,
  Star,
  Upload,
} from '@element-plus/icons-vue'
import {
  ToolPageLayout,
  ConfirmDialog,
  hostApiMissing,
  callHostApi,
  reloadHostWindow,
  type HostApiSpec,
} from '@sshk/ui-kit'
import {
  DEFAULT_UPLOAD_CONFIG,
  IPC_CHANNELS,
  newProfileId,
  uploadVendorMeta,
  type UploadCloudProfile,
  type UploadGlobalConfig,
  type UploadRemoteProfile,
} from '@sshk/shared'
import RemoteProfileForm from '../RemoteProfileForm.vue'
import CloudProfileForm from '../CloudProfileForm.vue'
import { host } from '../host'

/**
 * T6 文件管理工具 · 通道配置页（应用级全局配置）。
 *
 * N6：远程 + 云合并为一张统一列表，行头即「列表 + 操作列」，新增/编辑/删除/设为默认/测试
 *     全部在列表内完成（对齐模型管理的 Provider 管理范式），不再分两个卡片各自维护。
 * N5：expandedKeys 是数组，展开 / 收起互不影响，可同时展开任意多个 profile。
 *
 * 密钥单独走 safeStorage：列表只显示「已配置 / 未配置」，明文永不下发；
 * 用户主动点「查看」时才按 id 回显（N3），且明文绝不写进 settings.json。
 * 每个 profile 有独立「测试连接」（N4），可用未保存的表单值。
 *
 * N8：新增宿主能力一律走 @sshk/ui-kit 的 callHostApi —— Electron preload 只在窗口
 * 创建时注入，dev 下界面 HMR 不会重放 preload，直接裸调会得到
 * "window.api.upload.test is not a function"。这里做能力探测 + 通用通道兜底，
 * 并在页面顶部显示「能力未就绪」横幅与一键重载窗口。
 */
const TEST_SPEC: HostApiSpec = {
  group: 'upload', method: 'test', channel: IPC_CHANNELS.uploadTest, label: '连接测试',
}
const SECRET_SPEC: HostApiSpec = {
  group: 'upload', method: 'getSecret', channel: IPC_CHANNELS.uploadSecretGet, label: '密钥回显',
}
const HOST_SPECS: readonly HostApiSpec[] = [TEST_SPEC, SECRET_SPEC]
const missingCaps = ref<string[]>([])

function checkCaps(): void {
  missingCaps.value = hostApiMissing(HOST_SPECS)
}
async function reloadWindow(): Promise<void> {
  try {
    await reloadHostWindow()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

type RowKind = 'remote' | 'cloud'
interface ProfileRow {
  key: string
  kind: RowKind
  id: string
  name: string
  detail: string
  isDefault: boolean
  remote?: UploadRemoteProfile
  cloud?: UploadCloudProfile
}

const cfg = ref<UploadGlobalConfig>(structuredClone(DEFAULT_UPLOAD_CONFIG))
const secretState = ref<Record<string, boolean>>({})
const secretInputs = ref<Record<string, string>>({})
const acceptText = ref('')
const maxSizeMb = ref(0)
/** N5：可同时展开多个，切换某一条不影响其它条目 */
const expandedKeys = ref<string[]>([])
const filter = ref<'all' | 'remote' | 'cloud'>('all')
const saving = ref(false)
const testing = ref(false)
const progress = ref('')
const testingId = ref('')
const testResults = ref<Record<string, string>>({})
const removeOpen = ref(false)
const removeTarget = ref<ProfileRow | null>(null)

const rows = computed<ProfileRow[]>(() => [
  ...cfg.value.remote.profiles.map((p): ProfileRow => ({
    key: `remote:${p.id}`,
    kind: 'remote',
    id: p.id,
    name: p.name,
    detail: `${p.protocol.toUpperCase()} ${p.host}${p.port ? `:${p.port}` : ''}${p.remoteDir ? ` · ${p.remoteDir}` : ''}`,
    isDefault: cfg.value.remote.defaultId === p.id,
    remote: p,
  })),
  ...cfg.value.cloud.profiles.map((p): ProfileRow => ({
    key: `cloud:${p.id}`,
    kind: 'cloud',
    id: p.id,
    name: p.name,
    detail: `${uploadVendorMeta(p.provider).label} · ${p.bucket}${p.region ? ` · ${p.region}` : ''}`,
    isDefault: cfg.value.cloud.defaultId === p.id,
    cloud: p,
  })),
])
const visibleRows = computed(() =>
  filter.value === 'all' ? rows.value : rows.value.filter((r) => r.kind === filter.value))

/**
 * 用户验收项4：通道列表拖拽排序。
 * - 远程 / 云各自一组独立可写副本（dragRemoteRows / dragCloudRows），只在同类型内换序；
 *   跨类型混排会在 rows 重算时按 remote→cloud 分组弹回，故用两个 draggable 隔离。
 * - onDragEnd 按副本新顺序重建对应 profiles 数组（保存配置后落盘）。
 */
const dragRemoteRows = ref<ProfileRow[]>([])
const dragCloudRows = ref<ProfileRow[]>([])
watch(visibleRows, (v) => {
  dragRemoteRows.value = v.filter((r) => r.kind === 'remote')
  dragCloudRows.value = v.filter((r) => r.kind === 'cloud')
}, { immediate: true })

function reorder(kind: RowKind): void {
  if (kind === 'remote') {
    const order = dragRemoteRows.value.map((r) => r.id)
    const src = cfg.value.remote.profiles
    cfg.value.remote.profiles = order.map((id) => src.find((p) => p.id === id)).filter((p): p is UploadRemoteProfile => Boolean(p))
  } else {
    const order = dragCloudRows.value.map((r) => r.id)
    const src = cfg.value.cloud.profiles
    cfg.value.cloud.profiles = order.map((id) => src.find((p) => p.id === id)).filter((p): p is UploadCloudProfile => Boolean(p))
  }
  ElMessage.success('顺序已调整，点「保存配置」后生效')
}

function isOpen(key: string): boolean {
  return expandedKeys.value.includes(key)
}
function toggle(key: string): void {
  expandedKeys.value = isOpen(key)
    ? expandedKeys.value.filter((k) => k !== key)
    : [...expandedKeys.value, key]
}
function expand(key: string): void {
  if (!isOpen(key)) expandedKeys.value = [...expandedKeys.value, key]
}

function setSecretInput(id: string, value: string): void {
  secretInputs.value[id] = value
}

/** N3：复用 llm:getApiKey 范式——用户主动点「查看」才按 id 取回明文并填入密码框 */
async function revealSecret(id: string): Promise<void> {
  try {
    const value = await callHostApi<string>(SECRET_SPEC, id)
    secretInputs.value[id] = value
    if (value) ElMessage.success('已回显已存密钥，可点输入框眼睛查看或直接修改')
    else ElMessage.warning('该 profile 尚未保存密钥')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

/** N4：把当前表单值（含尚未保存的临时密钥）交给 main 做只读连通性探测 */
async function testProfile(type: RowKind, id: string): Promise<void> {
  testingId.value = id
  try {
    const list = type === 'remote' ? cfg.value.remote.profiles : cfg.value.cloud.profiles
    const profile = list.find((p) => p.id === id)
    if (!profile) throw new Error('找不到该 profile')
    const res = await callHostApi<{ ok: boolean; message: string }>(TEST_SPEC, {
      type,
      profile: { ...profile } as unknown as Record<string, unknown>,
      secret: secretInputs.value[id] || undefined,
    })
    // N11：校验失败 / 连不上是预期内结果，页面展示即可，不再抛异常污染主进程控制台
    if (!res?.ok) {
      const msg = res?.message || '连接测试未通过'
      testResults.value[id] = `✗ ${msg}`
      ElMessage.warning(msg)
      return
    }
    testResults.value[id] = `✓ ${res.message}`
    ElMessage.success('连接测试通过')
  } catch (err) {
    const msg = (err as Error).message
    testResults.value[id] = `✗ ${msg}`
    ElMessage.error(msg)
  } finally {
    testingId.value = ''
  }
}

async function load(): Promise<void> {
  cfg.value = await host.upload.getConfig()
  secretState.value = await host.upload.secretState()
  acceptText.value = cfg.value.validation.accept.join(', ')
  maxSizeMb.value = cfg.value.validation.maxSize > 0
    ? Math.round((cfg.value.validation.maxSize / 1024 / 1024) * 100) / 100
    : 0
  // 清掉已删除 profile 的展开状态，其余保持展开（N5）
  const keys = new Set(rows.value.map((r) => r.key))
  expandedKeys.value = expandedKeys.value.filter((k) => keys.has(k))
}

async function pickLocalDir(): Promise<void> {
  const dir = await host.os.pickDir()
  if (dir) cfg.value.local.defaultDir = dir
}

function onAdd(command: string): void {
  if (command === 'cloud') addCloud()
  else addRemote()
}

function addRemote(): void {
  const id = newProfileId('remote')
  const profile: UploadRemoteProfile = {
    id, name: '新远程配置', protocol: 'ftp', host: '', port: 21,
    username: '', remoteDir: '/', passive: true, baseUrl: '', signUrlTemplate: '',
  }
  cfg.value.remote.profiles.push(profile)
  if (!cfg.value.remote.defaultId) cfg.value.remote.defaultId = id
  filter.value = 'all'
  expand(`remote:${id}`) // 新增即展开，且不收起其它已展开项
}

function addCloud(): void {
  const id = newProfileId('cloud')
  const profile: UploadCloudProfile = {
    id, name: '新云配置', provider: 'aliyun-oss', region: '', endpoint: '',
    bucket: '', accessKeyId: '', baseUrl: '', signUrlTemplate: '',
  }
  cfg.value.cloud.profiles.push(profile)
  if (!cfg.value.cloud.defaultId) cfg.value.cloud.defaultId = id
  filter.value = 'all'
  expand(`cloud:${id}`)
}

function setDefault(row: ProfileRow): void {
  if (row.kind === 'remote') cfg.value.remote.defaultId = row.id
  else cfg.value.cloud.defaultId = row.id
}

function askRemove(row: ProfileRow): void {
  removeTarget.value = row
  removeOpen.value = true
}

async function doRemove(): Promise<void> {
  const row = removeTarget.value
  removeOpen.value = false
  removeTarget.value = null
  if (!row) return
  if (row.kind === 'remote') {
    cfg.value.remote.profiles = cfg.value.remote.profiles.filter((p) => p.id !== row.id)
    if (cfg.value.remote.defaultId === row.id) cfg.value.remote.defaultId = cfg.value.remote.profiles[0]?.id ?? ''
  } else {
    cfg.value.cloud.profiles = cfg.value.cloud.profiles.filter((p) => p.id !== row.id)
    if (cfg.value.cloud.defaultId === row.id) cfg.value.cloud.defaultId = cfg.value.cloud.profiles[0]?.id ?? ''
  }
  expandedKeys.value = expandedKeys.value.filter((k) => k !== row.key)
  delete secretInputs.value[row.id]
  delete testResults.value[row.id]
  // 同步清掉 safeStorage 中该 profile 的密钥，避免孤儿密钥残留
  try {
    await host.upload.setSecret(row.id, '')
    secretState.value = await host.upload.secretState()
  } catch {
    /* 清除失败不阻断 UI 删除 */
  }
  ElMessage.success(`已删除「${row.name}」，保存配置后生效`)
}

async function clearSecret(id: string): Promise<void> {
  await host.upload.setSecret(id, '')
  secretInputs.value[id] = ''
  secretState.value = await host.upload.secretState()
  ElMessage.success('密钥已清除')
}

function invalid(): string | null {
  for (const p of cfg.value.remote.profiles) {
    if (!p.id.trim() || !p.name.trim() || !p.host.trim()) return `远程配置「${p.name}」的 ID / 名称 / 主机不能为空`
  }
  for (const p of cfg.value.cloud.profiles) {
    if (!p.id.trim() || !p.name.trim() || !p.bucket.trim() || !p.region.trim()) {
      return `云配置「${p.name}」的 ID / 名称 / 地域 / Bucket 不能为空`
    }
    if (uploadVendorMeta(p.provider).endpointRequired && !p.endpoint?.trim()) {
      return `云配置「${p.name}」的 Endpoint 必填（见该厂商提示）`
    }
  }
  return null
}

async function save(): Promise<void> {
  const bad = invalid()
  if (bad) { ElMessage.error(bad); return }
  saving.value = true
  try {
    await host.upload.setConfig({
      local: { defaultDir: cfg.value.local.defaultDir },
      remote: {
        defaultId: cfg.value.remote.defaultId,
        profiles: cfg.value.remote.profiles.map((p) => ({ ...p })),
      },
      cloud: {
        defaultId: cfg.value.cloud.defaultId,
        profiles: cfg.value.cloud.profiles.map((p) => ({ ...p })),
      },
      validation: {
        accept: acceptText.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        maxSize: Math.max(0, Math.round(maxSizeMb.value * 1024 * 1024)),
      },
    })
    for (const [id, value] of Object.entries(secretInputs.value)) {
      if (value) await host.upload.setSecret(id, value)
      secretInputs.value[id] = ''
    }
    await load()
    ElMessage.success('通道配置已保存（密钥独立加密存储）')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

/** 本地链路自检：往全局默认目录写一个探针文件，验证 Service / IPC / Provider 全链路 */
async function selfTest(): Promise<void> {
  if (!cfg.value.local.defaultDir.trim()) {
    ElMessage.warning('请先设置并保存「本地默认目录」')
    return
  }
  testing.value = true
  progress.value = ''
  try {
    const text = `sshk upload self-test ${Date.now()}`
    const res = await host.upload.single({
      name: 'upload-self-test.txt',
      size: text.length,
      mime: 'text/plain',
      dataUrl: `data:text/plain;base64,${btoa(text)}`,
    })
    progress.value = `自检通过 → ${res.url}`
    ElMessage.success('上传链路自检通过')
  } catch (err) {
    progress.value = `自检失败：${(err as Error).message}`
    ElMessage.error((err as Error).message)
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  checkCaps()
  void load()
  // 事件订阅类（ipcRenderer.on 包装，无 invoke 语义）保留直通——H2 豁免
  // eslint-disable-next-line no-restricted-syntax
  window.api.upload.onProgress((p) => {
    progress.value = `${p.status === 'success' ? '✓' : p.status === 'failed' ? '✗' : '…'} ${p.name} ${p.percent}%${p.error ? ` — ${p.error}` : ''}`
  })
})
</script>

<template>
  <ToolPageLayout
    title="通道配置"
    description="应用级全局预设：一次配置，所有工具只选 profile 并覆盖少量非固定信息。密码 / AccessKey Secret 加密存储，不写进配置文件；需要时点「查看」按需回显。"
  >
    <template #actions>
      <el-button size="small" :icon="Connection" :loading="testing" @click="selfTest">链路自检</el-button>
      <el-button size="small" :icon="Refresh" @click="load">重新载入</el-button>
      <el-button type="primary" size="small" :icon="Check" :loading="saving" @click="save">保存配置</el-button>
    </template>

    <el-alert
      v-if="missingCaps.length"
      type="warning"
      :closable="false"
      show-icon
      class="cap-alert"
      title="宿主能力尚未就绪"
    >
      <template #default>
        <div class="cap-body">
          <span>缺少：{{ missingCaps.join('、') }}。界面已更新，但当前窗口仍在使用启动时的旧桥接，请重载窗口重新载入宿主能力。</span>
          <el-button size="small" type="warning" plain :icon="Refresh" @click="reloadWindow">重载窗口</el-button>
        </div>
      </template>
    </el-alert>

    <div class="grid">
      <section class="panel">
        <div class="panel-head"><el-icon><FolderOpened /></el-icon><span>本地默认目录</span></div>
        <div class="path-row">
          <el-input clearable v-model="cfg.local.defaultDir" size="small" placeholder="留空则使用应用当前目录" />
          <el-button size="small" :icon="FolderOpened" @click="pickLocalDir">选择目录</el-button>
        </div>
        <div class="hint">工具可在自己的「上传通道」配置里覆盖此目录；未覆盖时统一落到这里。</div>
      </section>

      <section class="panel">
        <div class="panel-head"><el-icon><Upload /></el-icon><span>全局默认校验</span></div>
        <el-form label-width="auto" size="small">
          <el-form-item label="允许扩展名">
            <el-input clearable v-model="acceptText" placeholder=".png, .jpg, .webp（留空 = 不限制）" />
          </el-form-item>
          <el-form-item label="单文件大小(MB)">
            <el-input-number v-model="maxSizeMb" :min="0" :max="2048" :step="1" />
            <span class="hint-inline">0 = 不限制；工具只能设得更严，不能放宽</span>
          </el-form-item>
        </el-form>
      </section>

      <!-- N6 统一列表：远程与云合为一张表，行头即操作列，增删改 / 默认 / 测试全部就地完成 -->
      <section class="panel panel-wide">
        <div class="panel-head">
          <el-icon><Connection /></el-icon><span>上传通道（{{ rows.length }}）</span>
          <el-radio-group v-model="filter" size="small" class="head-filter">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="remote">远程</el-radio-button>
            <el-radio-button value="cloud">云</el-radio-button>
          </el-radio-group>
          <el-dropdown @command="(c: unknown) => onAdd(String(c ?? 'remote'))">
            <el-button size="small" type="primary" :icon="Plus">
              新增<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="remote">远程</el-dropdown-item>
                <el-dropdown-item command="cloud">云存储</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <el-empty v-if="!visibleRows.length" description="还没有上传通道，点右上角「新增」开始" :image-size="60" />

        <!-- 项4：拖拽排序——远程 / 云各自一组，左侧 Rank 手柄拖动；保存配置后落盘 -->
        <VueDraggable
          v-if="filter !== 'cloud' && dragRemoteRows.length"
          v-model="dragRemoteRows"
          :handle="'.drag-handle'"
          :animation="180"
          ghost-class="drag-ghost"
          class="profile-list"
          @end="reorder('remote')"
        >
          <div v-for="row in dragRemoteRows" :key="row.key" class="profile" :class="{ 'is-open': isOpen(row.key) }">
            <div class="profile-head">
              <span class="drag-handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
              <el-tag size="small" :type="row.kind === 'remote' ? 'warning' : 'primary'" effect="plain">
                {{ row.kind === 'remote' ? '远程' : '云' }}
              </el-tag>
              <span class="item-title">{{ row.name }}</span>
              <el-tag v-if="row.isDefault" size="small" type="success" effect="plain">默认</el-tag>
              <span class="row-detail">{{ row.detail }}</span>
              <el-button v-if="!row.isDefault" size="small" :icon="Star" @click="setDefault(row)">设为默认</el-button>
              <el-tag size="small" :type="secretState[row.id] ? 'success' : 'info'" effect="plain">
                {{ secretState[row.id] ? '密钥已配置' : '未配置密钥' }}
              </el-tag>
              <div class="row-ops">
                <el-button size="small" :icon="Connection" :loading="testingId === row.id" @click="testProfile(row.kind, row.id)">测试</el-button>
                <el-button size="small" :icon="Edit" @click="toggle(row.key)">{{ isOpen(row.key) ? '收起' : '编辑' }}</el-button>
                <el-button size="small" :icon="Delete" @click="askRemove(row)" />
              </div>
            </div>
            <RemoteProfileForm
              v-if="row.remote"
              v-show="isOpen(row.key)"
              :profile="row.remote"
              :has-secret="Boolean(secretState[row.id])"
              :secret-value="secretInputs[row.id] ?? ''"
              :testing="testingId === row.id"
              :test-result="testResults[row.id]"
              @update-secret="setSecretInput"
              @clear-secret="clearSecret"
              @reveal-secret="revealSecret"
              @test="(id: string) => testProfile('remote', id)"
            />
          </div>
        </VueDraggable>

        <VueDraggable
          v-if="filter !== 'remote' && dragCloudRows.length"
          v-model="dragCloudRows"
          :handle="'.drag-handle'"
          :animation="180"
          ghost-class="drag-ghost"
          class="profile-list"
          @end="reorder('cloud')"
        >
          <div v-for="row in dragCloudRows" :key="row.key" class="profile" :class="{ 'is-open': isOpen(row.key) }">
            <div class="profile-head">
              <span class="drag-handle" title="拖拽排序"><el-icon><Rank /></el-icon></span>
              <el-tag size="small" :type="row.kind === 'remote' ? 'warning' : 'primary'" effect="plain">
                {{ row.kind === 'remote' ? '远程' : '云' }}
              </el-tag>
              <span class="item-title">{{ row.name }}</span>
              <el-tag v-if="row.isDefault" size="small" type="success" effect="plain">默认</el-tag>
              <span class="row-detail">{{ row.detail }}</span>
              <el-button v-if="!row.isDefault" size="small" :icon="Star" @click="setDefault(row)">设为默认</el-button>
              <el-tag size="small" :type="secretState[row.id] ? 'success' : 'info'" effect="plain">
                {{ secretState[row.id] ? '密钥已配置' : '未配置密钥' }}
              </el-tag>
              <div class="row-ops">
                <el-button size="small" :icon="Connection" :loading="testingId === row.id" @click="testProfile(row.kind, row.id)">测试</el-button>
                <el-button size="small" :icon="Edit" @click="toggle(row.key)">{{ isOpen(row.key) ? '收起' : '编辑' }}</el-button>
                <el-button size="small" :icon="Delete" @click="askRemove(row)" />
              </div>
            </div>
            <CloudProfileForm
              v-if="row.cloud"
              v-show="isOpen(row.key)"
              :profile="row.cloud"
              :has-secret="Boolean(secretState[row.id])"
              :secret-value="secretInputs[row.id] ?? ''"
              :testing="testingId === row.id"
              :test-result="testResults[row.id]"
              @update-secret="setSecretInput"
              @clear-secret="clearSecret"
              @reveal-secret="revealSecret"
              @test="(id: string) => testProfile('cloud', id)"
            />
          </div>
        </VueDraggable>
        <div class="hint">
          7 家常见云厂商与 S3 兼容服务均已支持；地域 / Endpoint 可下拉预选也可直接手输。
          可同时展开多个通道逐项对照修改；删除通道需二次确认，保存配置后生效。
        </div>
      </section>
    </div>

    <ConfirmDialog
      v-model:open="removeOpen"
      title="删除上传通道"
      :targets="removeTarget ? [removeTarget.name] : []"
      confirm-text="删除"
      @confirm="doRemove"
    />

    <template #footer>
      <span class="muted">
        配置落盘 app.upload.* · 密钥落 secrets.bin（safeStorage）· 最近一次上载状态：{{ progress || '暂无' }}
      </span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.cap-alert { margin-bottom: 12px; }
.cap-body { display: flex; align-items: center; justify-content: space-between; gap: 12px; line-height: 1.6; }
/* profile 卡两列表单需要横向空间：最小 560px，窄窗口自动降为单卡一行 */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: 12px; }
.panel {
  border: 1px solid var(--sshk-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--sshk-panel);
}
.panel-wide { grid-column: 1 / -1; }
.panel-head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 14px; }
.head-filter { margin-left: auto; }
/* 输入框与按钮统一 size=small + 基线居中，避免「输入高 / 按钮矮」的错位（N2） */
.path-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.path-row > :first-child { flex: 1; min-width: 0; }
.path-row > :last-child { flex: none; }
.profile { border: 1px dashed var(--sshk-border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.profile.is-open { border-style: solid; border-color: var(--el-color-primary-light-5); }
/* 拖拽排序：手柄常驻示意可拖，拖动中的占位半透明 */
.drag-handle { flex: none; display: inline-flex; align-items: center; cursor: grab; color: var(--el-text-color-placeholder); font-size: 15px; }
.drag-handle:active { cursor: grabbing; }
.drag-handle:hover { color: var(--el-color-primary); }
.drag-ghost { opacity: 0.4; background: var(--el-color-primary-light-9); }
.profile-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 展开时头部与表单拉开间距；收起态保持紧凑 */
.is-open .profile-head { margin-bottom: 10px; }
.item-title { font-weight: 600; flex: none; }
.row-detail { font-size: 12px; opacity: .65; flex: 1 1 180px; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-ops { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.hint, .muted { font-size: 12px; opacity: .6; line-height: 1.5; }
.hint { display: block; margin-top: 6px; }
/* 开关 / 输入后紧跟说明文字：统一留 12px 间距（全项目 UI 铁律） */
.hint-inline { display: inline; margin-left: 12px; font-size: 12px; opacity: .6; }
</style>
