<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Check,
  Connection,
  Delete,
  FolderOpened,
  Plus,
  Refresh,
  Upload,
} from '@element-plus/icons-vue'
import { ToolPageLayout } from '@sshk/ui-kit'
import {
  DEFAULT_UPLOAD_CONFIG,
  newProfileId,
  uploadVendorMeta,
  type UploadCloudProfile,
  type UploadGlobalConfig,
  type UploadRemoteProfile,
} from '@sshk/shared'
import RemoteProfileForm from './RemoteProfileForm.vue'
import CloudProfileForm from './CloudProfileForm.vue'

/**
 * T6 上传配置工具（应用级全局配置）。
 * 与工具级「只选 profile + 覆盖项」相对：这里维护连接信息本体，密钥单独走 safeStorage，
 * 列表只显示「已配置 / 未配置」，明文永不下发；用户主动点「查看」时才按 id 回显（N3），
 * 且明文绝不写进 settings.json。每个 profile 有独立「测试连接」（N4），可用未保存的表单值。
 * profile 表单拆成子组件：避免深层 v-for + v-model 让 vue-tsc 丢失作用域。
 */
defineProps<{ menu?: string; toolId?: string }>()

const cfg = ref<UploadGlobalConfig>(structuredClone(DEFAULT_UPLOAD_CONFIG))
const secretState = ref<Record<string, boolean>>({})
const secretInputs = ref<Record<string, string>>({})
const acceptText = ref('')
const maxSizeMb = ref(0)
const expanded = ref('')
const saving = ref(false)
const testing = ref(false)
const progress = ref('')
/** N4：每个 profile 各自的测试状态与结果，互不覆盖 */
const testingId = ref('')
const testResults = ref<Record<string, string>>({})

function setSecretInput(id: string, value: string): void {
  secretInputs.value[id] = value
}

/** N3：复用 llm:getApiKey 范式——用户主动点「查看」才按 id 取回明文并填入密码框 */
async function revealSecret(id: string): Promise<void> {
  try {
    const value = await window.api.upload.getSecret(id)
    secretInputs.value[id] = value
    if (value) ElMessage.success('已回显已存密钥，可点输入框眼睛查看或直接修改')
    else ElMessage.warning('该 profile 尚未保存密钥')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

/** N4：把当前表单值（含尚未保存的临时密钥）交给 main 做只读连通性探测 */
async function testProfile(type: 'remote' | 'cloud', id: string): Promise<void> {
  testingId.value = id
  try {
    const list = type === 'remote' ? cfg.value.remote.profiles : cfg.value.cloud.profiles
    const profile = list.find((p) => p.id === id)
    if (!profile) throw new Error('找不到该 profile')
    const message = await window.api.upload.test({
      type,
      profile: { ...profile } as unknown as Record<string, unknown>,
      secret: secretInputs.value[id] || undefined,
    })
    testResults.value[id] = `✓ ${message}`
    ElMessage.success('连接测试通过')
  } catch (err) {
    const msg = (err as Error).message
    testResults.value[id] = `✗ ${msg}`
    ElMessage.error(msg)
  } finally {
    testingId.value = ''
  }
}
function toggle(key: string): void {
  expanded.value = expanded.value === key ? '' : key
}

async function load(): Promise<void> {
  cfg.value = await window.api.upload.getConfig()
  secretState.value = await window.api.upload.secretState()
  acceptText.value = cfg.value.validation.accept.join(', ')
  maxSizeMb.value = cfg.value.validation.maxSize > 0
    ? Math.round((cfg.value.validation.maxSize / 1024 / 1024) * 100) / 100
    : 0
}

async function pickLocalDir(): Promise<void> {
  const dir = await window.api.os.pickDir()
  if (dir) cfg.value.local.defaultDir = dir
}

function addRemote(): void {
  const id = newProfileId('remote')
  const profile: UploadRemoteProfile = {
    id, name: '新远程配置', protocol: 'ftp', host: '', port: 21,
    username: '', remoteDir: '/', passive: true, baseUrl: '',
  }
  cfg.value.remote.profiles.push(profile)
  if (!cfg.value.remote.defaultId) cfg.value.remote.defaultId = id
  expanded.value = `remote:${id}`
}

function addCloud(): void {
  const id = newProfileId('cloud')
  const profile: UploadCloudProfile = {
    id, name: '新云配置', provider: 'aliyun-oss', region: '', endpoint: '',
    bucket: '', accessKeyId: '', baseUrl: '',
  }
  cfg.value.cloud.profiles.push(profile)
  if (!cfg.value.cloud.defaultId) cfg.value.cloud.defaultId = id
  expanded.value = `cloud:${id}`
}

function removeRemote(item: UploadRemoteProfile): void {
  cfg.value.remote.profiles = cfg.value.remote.profiles.filter((p) => p.id !== item.id)
  if (cfg.value.remote.defaultId === item.id) {
    cfg.value.remote.defaultId = cfg.value.remote.profiles[0]?.id ?? ''
  }
}

function removeCloud(item: UploadCloudProfile): void {
  cfg.value.cloud.profiles = cfg.value.cloud.profiles.filter((p) => p.id !== item.id)
  if (cfg.value.cloud.defaultId === item.id) {
    cfg.value.cloud.defaultId = cfg.value.cloud.profiles[0]?.id ?? ''
  }
}

async function clearSecret(id: string): Promise<void> {
  await window.api.upload.setSecret(id, '')
  secretInputs.value[id] = ''
  secretState.value = await window.api.upload.secretState()
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
    await window.api.upload.setConfig({
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
      if (value) await window.api.upload.setSecret(id, value)
      secretInputs.value[id] = ''
    }
    await load()
    ElMessage.success('上传配置已保存（密钥独立加密存储）')
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
    const res = await window.api.upload.single({
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
  void load()
  window.api.upload.onProgress((p) => {
    progress.value = `${p.status === 'success' ? '✓' : p.status === 'failed' ? '✗' : '…'} ${p.name} ${p.percent}%${p.error ? ` — ${p.error}` : ''}`
  })
})
</script>

<template>
  <ToolPageLayout
    title="上传配置"
    description="应用级全局预设：一次配置，所有工具只选 profile 并覆盖少量非固定信息。密码 / AccessKey Secret 加密存储，不写进配置文件；需要时点「查看」按需回显。"
  >
    <template #actions>
      <el-button size="small" :icon="Connection" :loading="testing" @click="selfTest">链路自检</el-button>
      <el-button size="small" :icon="Refresh" @click="load">重新载入</el-button>
      <el-button type="primary" size="small" :icon="Check" :loading="saving" @click="save">保存配置</el-button>
    </template>

    <div class="grid">
      <section class="panel">
        <div class="panel-head"><el-icon><FolderOpened /></el-icon><span>本地默认目录</span></div>
        <div class="path-row">
          <el-input v-model="cfg.local.defaultDir" size="small" placeholder="留空则使用应用当前目录" />
          <el-button size="small" :icon="FolderOpened" @click="pickLocalDir">选择目录</el-button>
        </div>
        <div class="hint">工具可在自己的「上传通道」配置里覆盖此目录；未覆盖时统一落到这里。</div>
      </section>

      <section class="panel">
        <div class="panel-head"><el-icon><Upload /></el-icon><span>全局默认校验</span></div>
        <el-form label-width="120px" size="small">
          <el-form-item label="允许扩展名">
            <el-input v-model="acceptText" placeholder=".png, .jpg, .webp（留空 = 不限制）" />
          </el-form-item>
          <el-form-item label="单文件大小(MB)">
            <el-input-number v-model="maxSizeMb" :min="0" :max="2048" :step="1" />
            <span class="hint-inline">0 = 不限制；工具只能设得更严，不能放宽</span>
          </el-form-item>
        </el-form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <el-icon><Connection /></el-icon><span>远程 profile（FTP / SFTP）</span>
          <el-button class="head-btn" size="small" :icon="Plus" @click="addRemote">新增</el-button>
        </div>
        <el-form label-width="120px" size="small">
          <el-form-item label="默认 profile">
            <el-select v-model="cfg.remote.defaultId" clearable placeholder="未设置时取列表第一个" style="width: 260px">
              <el-option v-for="item in cfg.remote.profiles" :key="item.id" :label="`${item.name}（${item.protocol}）`" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-empty v-if="!cfg.remote.profiles.length" description="还没有远程 profile" :image-size="60" />
        <div v-for="item in cfg.remote.profiles" :key="item.id" class="profile">
          <div class="profile-head" @click="toggle(`remote:${item.id}`)">
            <span class="item-title">{{ item.name }}</span>
            <el-tag size="small" :type="item.protocol === 'sftp' ? 'warning' : 'primary'" effect="plain">{{ item.protocol.toUpperCase() }}</el-tag>
            <el-tag size="small" :type="secretState[item.id] ? 'success' : 'info'" effect="plain">
              {{ secretState[item.id] ? '密钥已配置' : '未配置密钥' }}
            </el-tag>
            <el-button class="head-btn" size="small" @click.stop="toggle(`remote:${item.id}`)">
              {{ expanded === `remote:${item.id}` ? '收起' : '编辑' }}
            </el-button>
            <el-button size="small" :icon="Delete" @click.stop="removeRemote(item)" />
          </div>
          <RemoteProfileForm
            v-show="expanded === `remote:${item.id}`"
            :profile="item"
            :has-secret="Boolean(secretState[item.id])"
            :secret-value="secretInputs[item.id] ?? ''"
            :testing="testingId === item.id"
            :test-result="testResults[item.id]"
            @update-secret="setSecretInput"
            @clear-secret="clearSecret"
            @reveal-secret="revealSecret"
            @test="(id: string) => testProfile('remote', id)"
          />
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <el-icon><Upload /></el-icon><span>云 profile（可同云多账号）</span>
          <el-button class="head-btn" size="small" :icon="Plus" @click="addCloud">新增</el-button>
        </div>
        <el-form label-width="120px" size="small">
          <el-form-item label="默认 profile">
            <el-select v-model="cfg.cloud.defaultId" clearable placeholder="未设置时取列表第一个" style="width: 260px">
              <el-option v-for="item in cfg.cloud.profiles" :key="item.id" :label="`${item.name}（${item.provider}）`" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-empty v-if="!cfg.cloud.profiles.length" description="还没有云 profile" :image-size="60" />
        <div v-for="item in cfg.cloud.profiles" :key="item.id" class="profile">
          <div class="profile-head" @click="toggle(`cloud:${item.id}`)">
            <span class="item-title">{{ item.name }}</span>
            <el-tag size="small" type="primary" effect="plain">{{ item.provider }}</el-tag>
            <el-tag size="small" :type="secretState[item.id] ? 'success' : 'info'" effect="plain">
              {{ secretState[item.id] ? '密钥已配置' : '未配置密钥' }}
            </el-tag>
            <el-button class="head-btn" size="small" @click.stop="toggle(`cloud:${item.id}`)">
              {{ expanded === `cloud:${item.id}` ? '收起' : '编辑' }}
            </el-button>
            <el-button size="small" :icon="Delete" @click.stop="removeCloud(item)" />
          </div>
          <CloudProfileForm
            v-show="expanded === `cloud:${item.id}`"
            :profile="item"
            :has-secret="Boolean(secretState[item.id])"
            :secret-value="secretInputs[item.id] ?? ''"
            :testing="testingId === item.id"
            :test-result="testResults[item.id]"
            @update-secret="setSecretInput"
            @clear-secret="clearSecret"
            @reveal-secret="revealSecret"
            @test="(id: string) => testProfile('cloud', id)"
          />
        </div>
        <div class="hint">7 家常见云厂商与 S3 兼容服务均已支持；地域 / Endpoint 可下拉预选也可直接手输。SDK 按需加载，未安装时会明确提示，不会静默失败。</div>
      </section>
    </div>

    <template #footer>
      <span class="muted">
        配置落盘 app.upload.* · 密钥落 secrets.bin（safeStorage）· 最近一次上载状态：{{ progress || '暂无' }}
      </span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; }
.panel {
  border: 1px solid var(--sshk-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--sshk-panel);
}
.panel-head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 14px; }
.head-btn { margin-left: auto; }
/* 输入框与按钮统一 size=small + 基线居中，避免「输入高 / 按钮矮」的错位（N2） */
.path-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.path-row > :first-child { flex: 1; min-width: 0; }
.path-row > :last-child { flex: none; }
.profile { border: 1px dashed var(--sshk-border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.profile-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.item-title { font-weight: 600; }
.hint, .muted { font-size: 12px; opacity: .6; line-height: 1.5; }
.hint { display: block; margin-top: 6px; }
/* 开关 / 输入后紧跟说明文字：统一留 12px 间距（全项目 UI 铁律） */
.hint-inline { display: inline; margin-left: 12px; font-size: 12px; opacity: .6; }
</style>
