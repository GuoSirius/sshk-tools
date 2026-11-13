<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ToolPageLayout, EmptyState, ConfirmDialog } from '@sshk/ui-kit'
import { entityId } from '@sshk/shared'

// 左侧菜单：providers=Provider 管理 / chat=对话调试（需求 8）
const props = defineProps<{ menu?: string }>()
const view = computed(() => props.menu ?? 'providers')

interface Provider {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  model: string
  enabled: boolean
}

/** 预设来自工具包自己 tool.manifest.json 的 defaults.modelPresets（不含任何密钥） */
interface ModelPreset {
  id: string
  name: string
  baseURL: string
  kind: 'local' | 'remote'
  defaultModel: string
  models: string[]
  hint?: string
}

const providers = ref<Provider[]>([])
const presets = ref<ModelPreset[]>([])
const modelOptions = ref<string[]>([])
const presetId = ref('')
const fetchingModels = ref(false)
const dialogOpen = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const form = reactive<Provider & { apiKey: string }>({
  _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '',
})
interface HealthState { ok: boolean; message: string; at: string }
const health = reactive<Record<string, HealthState>>({})
const testingId = ref<string | null>(null)

// 对话调试
const chatProviderId = ref('')
const chatInput = ref('')
const chatOutput = ref('')
const chatting = ref(false)

const activeProvider = computed(
  () => providers.value.find((p) => p._id === chatProviderId.value) ?? null,
)

async function load(): Promise<void> {
  const saved = (await window.api.config.get('app.llm.providers')) as Provider[] | null
  providers.value = Array.isArray(saved) ? saved : []
  // 连通状态持久化：测过的 Provider 下次进来直接显示上次结果
  const savedHealth = (await window.api.config.get('app.llm.health')) as Record<string, HealthState> | null
  if (savedHealth && typeof savedHealth === 'object') Object.assign(health, savedHealth)
  const rawPresets = (await window.api.config.get('tools.model-console.modelPresets')) as ModelPreset[] | null
  presets.value = Array.isArray(rawPresets)
    ? rawPresets.filter((p) => p && typeof p.baseURL === 'string' && Array.isArray(p.models))
    : []
}

async function persist(): Promise<void> {
  await window.api.config.set('app.llm.providers', providers.value)
}

function openCreate(): void {
  editingId.value = null
  presetId.value = ''
  modelOptions.value = []
  Object.assign(form, { _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '' })
  dialogOpen.value = true
}

function openEdit(row: Provider): void {
  editingId.value = row._id
  const matched = presets.value.find((p) => p.baseURL === row.baseURL)
  presetId.value = matched?.id ?? ''
  modelOptions.value = matched ? [...matched.models] : row.model ? [row.model] : []
  Object.assign(form, { ...row, apiKey: '' })
  dialogOpen.value = true
}

/** 选预设即自动填好端点与默认模型，用户只需填一个 API Key */
function applyPreset(id: string): void {
  const preset = presets.value.find((p) => p.id === id)
  if (!preset) return
  Object.assign(form, {
    _id: '',
    name: preset.name,
    kind: preset.kind,
    baseURL: preset.baseURL,
    model: preset.defaultModel || preset.models[0] || '',
    enabled: true,
    apiKey: '',
  })
  modelOptions.value = [...preset.models]
}

function quickAdd(preset: ModelPreset): void {
  openCreate()
  presetId.value = preset.id
  applyPreset(preset.id)
}

/** 真实查询 /models：保存前也能用刚填的 key 探测，失败仍可手填模型名 */
async function fetchModels(): Promise<void> {
  if (!/^https?:\/\//i.test(form.baseURL.trim())) {
    ElMessage.warning('请先填写 http(s) 格式的 baseURL')
    return
  }
  fetchingModels.value = true
  try {
    const probe: Provider = {
      _id: form._id || 'prv_preview',
      name: form.name || '预览',
      kind: form.kind,
      baseURL: form.baseURL.trim(),
      model: form.model,
      enabled: true,
    }
    const list = await window.api.llm.listModels(probe, form.apiKey.trim() || undefined)
    modelOptions.value = Array.from(new Set([...modelOptions.value, ...list.filter(Boolean)]))
    if (!form.model && modelOptions.value[0]) form.model = modelOptions.value[0]
    ElMessage.success(`拉取到 ${list.length} 个可用模型`)
  } catch (err) {
    // /models 401 / 404 / 端点不开放时回退到该服务商的预设模型，绝不阻断保存
    const preset = presets.value.find((p) => p.baseURL === form.baseURL.trim())
    if (preset) {
      modelOptions.value = Array.from(new Set([...modelOptions.value, ...preset.models]))
      if (!form.model) form.model = preset.defaultModel || preset.models[0] || form.model
    }
    ElMessage.warning(`模型列表拉取失败：${(err as Error).message}；已回退预设/手填，不影响保存`)
  } finally {
    fetchingModels.value = false
  }
}

async function saveProvider(): Promise<void> {
  if (!form.name.trim() || !form.baseURL.trim() || !form.model.trim()) {
    ElMessage.warning('名称、baseURL、模型名必填')
    return
  }
  if (!/^https?:\/\//i.test(form.baseURL.trim())) {
    ElMessage.warning('baseURL 必须是 http(s) 地址')
    return
  }
  saving.value = true
  try {
    // 先写密钥再改内存、最后落配置：任一步失败都不留下「界面已改但没保存」的假象
    if (editingId.value) {
      const idx = providers.value.findIndex((p) => p._id === editingId.value)
      if (idx >= 0) {
        const { apiKey, ...meta } = form
        if (apiKey) await window.api.llm.setApiKey(meta._id, apiKey)
        providers.value[idx] = { ...providers.value[idx]!, ...meta }
      }
    } else {
      const id = entityId('prv')
      const { apiKey, ...meta } = form
      if (apiKey) await window.api.llm.setApiKey(id, apiKey)
      providers.value.push({ ...meta, _id: id })
    }
    await persist()
    dialogOpen.value = false
    ElMessage.success('已保存（apiKey 加密存储，不进配置文件）')
  } catch (err) {
    // 失败时保留弹框与已填内容，明确报错；不再出现「点了保存没反应也不关窗」
    ElMessage.error(`保存失败：${(err as Error).message}`)
  } finally {
    saving.value = false
  }
}

const removeOpen = ref(false)
const removeTarget = ref<Provider | null>(null)

function askRemove(row: Provider): void {
  removeTarget.value = row
  removeOpen.value = true
}

async function doRemove(): Promise<void> {
  const target = removeTarget.value
  if (!target) return
  try {
    await window.api.llm.setApiKey(target._id, '')
    providers.value = providers.value.filter((p) => p._id !== target._id)
    await persist()
    removeOpen.value = false
    ElMessage.success('已删除')
  } catch (err) {
    ElMessage.error(`删除失败：${(err as Error).message}`)
  }
}

async function testProvider(row: Provider): Promise<void> {
  testingId.value = row._id
  try {
    const result = await window.api.llm.healthCheck(row)
    health[row._id] = { ...result, at: new Date().toLocaleString('sv-SE') }
  } catch (err) {
    health[row._id] = { ok: false, message: (err as Error).message, at: new Date().toLocaleString('sv-SE') }
  } finally {
    testingId.value = null
    await window.api.config.set('app.llm.health', JSON.parse(JSON.stringify(health)))
  }
}

/** 按需回显已存密钥：用户主动点击才从主进程 safeStorage 拉取，不随编辑默认下发 */
async function revealKey(): Promise<void> {
  if (!editingId.value) return
  try {
    form.apiKey = await window.api.llm.getApiKey(editingId.value)
    ElMessage.success('已填充已存密钥（仅本次编辑会话可见）')
  } catch (err) {
    ElMessage.error(`读取失败：${(err as Error).message}`)
  }
}

async function sendChat(): Promise<void> {
  const provider = activeProvider.value
  if (!provider || !chatInput.value.trim()) return
  chatting.value = true
  chatOutput.value = ''
  try {
    const res = await window.api.llm.chat(
      provider,
      [{ role: 'user', content: chatInput.value }],
      { onDelta: true },
    )
    chatOutput.value = res.content || chatOutput.value
  } catch (err) {
    chatOutput.value = `错误：${(err as Error).message}`
  } finally {
    chatting.value = false
  }
}

onMounted(() => {
  void load()
  window.api.llm.onDelta((delta) => {
    chatOutput.value += delta
  })
})
</script>

<template>
  <ToolPageLayout
    title="模型控制台"
    description="内置常用模型预设，填一个 Key 即可使用；模型名可下拉选择（真实查询 /models）；apiKey 单独加密存储"
  >
    <template #actions>
      <el-button v-if="view === 'providers'" type="primary" size="small" @click="openCreate">新增 Provider</el-button>
    </template>

    <template v-if="view === 'chat'">
      <div class="panel" style="min-height: 240px; display: flex; flex-direction: column">
        <div class="panel-title">对话调试（流式输出；apiKey 在主进程注入，不落渲染层）</div>
        <div class="chat-output">{{ chatOutput || '（输出将显示在这里）' }}</div>
        <div style="display: flex; gap: 8px; margin-top: 10px">
          <el-select v-model="chatProviderId" size="small" placeholder="选择 Provider" style="width: 220px">
            <el-option v-for="p in providers" :key="p._id" :label="`${p.name} · ${p.model}`" :value="p._id" />
          </el-select>
          <el-input
            v-model="chatInput"
            size="small"
            placeholder="输入测试内容，回车发送"
            :disabled="!activeProvider"
            @keydown.enter="sendChat"
          />
          <el-button size="small" type="primary" :loading="chatting" :disabled="!activeProvider" @click="sendChat">
            发送
          </el-button>
        </div>
      </div>
    </template>

    <template v-else>
    <div v-if="presets.length" class="preset-bar">
      <div class="preset-label">常用模型 · 一键预填（只需填 API Key）</div>
      <div class="preset-list">
        <el-button
          v-for="p in presets"
          :key="p.id"
          size="small"
          :title="p.hint ?? p.baseURL"
          @click="quickAdd(p)"
        >
          {{ p.name }}
        </el-button>
      </div>
    </div>

    <EmptyState
      v-if="providers.length === 0"
      description="还没有配置任何模型 Provider"
      action-text="新增 Provider"
      @action="openCreate"
    />

    <el-table v-else :data="providers" size="small">
      <el-table-column prop="name" label="名称" min-width="120" />
      <el-table-column prop="kind" label="类型" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.kind === 'local' ? 'success' : 'info'">
            {{ row.kind === 'local' ? '本地' : '云端' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="baseURL" label="baseURL" min-width="200" show-overflow-tooltip />
      <el-table-column prop="model" label="模型" min-width="140" show-overflow-tooltip />
      <el-table-column label="密钥" width="70">
        <template #default>
          <span class="masked">••••</span>
        </template>
      </el-table-column>
      <el-table-column label="连通" min-width="160">
        <template #default="{ row }">
          <span v-if="health[row._id]" :class="health[row._id]!.ok ? 'ok' : 'bad'">
            {{ health[row._id]!.message }}
            <small class="muted">（{{ health[row._id]!.at }}）</small>
          </span>
          <span v-else class="muted">未测试</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text :loading="testingId === row._id" @click="testProvider(row)">测试</el-button>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="askRemove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </template>

    <template #footer>
      <span class="panel-title">apiKey 单独加密存储（safeStorage）· 测试与试聊走 llm 网关</span>
    </template>

    <el-dialog
      v-model="dialogOpen"
      :title="editingId ? '编辑 Provider' : '新增 Provider'"
      width="480px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-width="90px" size="small">
        <el-form-item v-if="presets.length" label="快速预设">
          <el-select
            v-model="presetId"
            clearable
            placeholder="选一个常用服务商，自动填好端点与模型"
            style="width: 100%"
            @change="(v: unknown) => applyPreset(String(v ?? ''))"
          >
            <el-option v-for="p in presets" :key="p.id" :label="`${p.name} · ${p.baseURL}`" :value="p.id" />
          </el-select>
          <div class="form-hint">预设只含公开端点信息，不含任何密钥；选好后填 API Key 保存即可用</div>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：本地 Ollama" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.kind">
            <el-radio value="local">本地</el-radio>
            <el-radio value="remote">云端</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="baseURL">
          <el-input v-model="form.baseURL" placeholder="http://127.0.0.1:11434/v1" />
        </el-form-item>
        <el-form-item label="模型名">
          <div class="model-row">
            <el-select
              v-model="form.model"
              filterable
              allow-create
              default-first-option
              :loading="fetchingModels"
              placeholder="下拉选择或手动输入模型名"
              style="flex: 1"
            >
              <el-option v-for="m in modelOptions" :key="m" :label="m" :value="m" />
            </el-select>
            <el-button size="small" :loading="fetchingModels" @click="fetchModels">拉取模型列表</el-button>
          </div>
          <div class="form-hint">「拉取模型列表」会真实请求该端点的 /models；端点不支持时可直接手动输入模型名</div>
        </el-form-item>
        <el-form-item label="apiKey">
          <div class="model-row">
            <el-input
              v-model="form.apiKey"
              type="password"
              show-password
              :placeholder="editingId ? '留空则不修改；可点右侧查看已存密钥' : '本地服务可留空'"
              style="flex: 1"
            />
            <el-button v-if="editingId" size="small" @click="revealKey">查看已存</el-button>
          </div>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogOpen = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="saveProvider">保存</el-button>
      </template>
    </el-dialog>

    <ConfirmDialog
      v-model:open="removeOpen"
      title="删除 Provider"
      :targets="removeTarget ? [removeTarget.name] : []"
      confirm-text="删除"
      @confirm="doRemove"
    />
  </ToolPageLayout>
</template>

<style scoped>
.preset-bar {
  border: 1px solid rgba(128,128,128,.25);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.preset-label { font-size: 12px; opacity: .7; margin-bottom: 8px; }
.preset-list { display: flex; flex-wrap: wrap; gap: 6px; }
.model-row { display: flex; gap: 6px; width: 100%; }
.form-hint { font-size: 11px; opacity: .6; line-height: 1.5; margin-top: 4px; }
.panel { border: 1px solid rgba(128,128,128,.25); border-radius: 6px; padding: 12px; }
.panel-title { font-size: 12px; opacity: .7; margin-bottom: 8px; }
.chat-output { flex: 1; min-height: 160px; max-height: 420px; overflow-y: auto; white-space: pre-wrap; font-size: 13px; border: 1px dashed rgba(128,128,128,.3); border-radius: 4px; padding: 10px; }
.masked {
  letter-spacing: 2px;
}
.ok {
  color: var(--el-color-success);
}
.bad {
  color: var(--el-color-danger);
}
.muted {
  opacity: 0.6;
}
.chat-out {
  margin-left: 12px;
  font-size: 12px;
  opacity: 0.8;
  max-width: 480px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
