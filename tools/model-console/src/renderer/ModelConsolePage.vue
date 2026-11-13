<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ToolPageLayout, EmptyState, ConfirmDialog } from '@sshk/ui-kit'
import { entityId } from '@sshk/shared'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// LLM 输出为不可信内容：先 markdown 解析再 DOMPurify 净化，避免 v-html XSS
marked.setOptions({ gfm: true, breaks: true })

// 左侧菜单：providers=Provider 管理 / chat=对话调试（需求 8）；默认进入对话调试
const props = defineProps<{ menu?: string }>()
const view = computed(() => props.menu ?? 'chat')

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
// 必填校验（红星由 el-form rules 自动标注；kind=local 时 baseURL 不要求，编辑时 apiKey 可留空不改）
const formRef = ref<{ validate: () => Promise<boolean> } | null>(null)
const formRules = computed(() => ({
  name: [{ required: true, message: "请输入名称", trigger: "blur" }],
  baseURL: [{ required: form.value.kind === "remote", message: "云端 Provider 必须填写 baseURL", trigger: "blur" }],
  model: [{ required: true, message: "请输入模型名", trigger: "blur" }],
  apiKey: [{ required: !editingId.value && form.value.kind === "remote", message: "云端 Provider 必须填写 API Key", trigger: "blur" }],
}))
const saving = ref(false)
const editingId = ref<string | null>(null)
const form = ref<Provider & { apiKey: string }>({
  _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '',
})
interface HealthState { ok: boolean; message: string; at: string }
const health = reactive<Record<string, HealthState>>({})
const testingId = ref<string | null>(null)

// 对话调试（多轮 · 流式打字 · Markdown 回显）
interface ChatMessage { role: 'user' | 'assistant'; content: string; error?: boolean }
const messages = ref<ChatMessage[]>([])
const chatProviderId = ref('')
const chatInput = ref('')
const chatting = ref(false)
const chatScroller = ref<HTMLElement | null>(null)
/**
 * 是否"钉在底部"：用户滚到接近底部时为真，往上滚则为假（暂停自动滚动）。
 * 自主判定逻辑（类 WorkBuddy 输出区）：用户上滚→不抢滚；用户回到底部→恢复自动滚。
 */
const chatAutoScroll = ref(true)
/** 距底多少像素内算"在底部"（容差，规避小数/滚动惯性误判） */
const CHAT_BOTTOM_THRESHOLD = 48

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_BOTTOM_THRESHOLD
}
/** 滚动事件：自主判定是否允许自动滚到底部 */
function onChatScroll(): void {
  const el = chatScroller.value
  if (el) chatAutoScroll.value = isNearBottom(el)
}
/** 仅当钉在底部才自动滚底；force 用于用户主动发送时强制回底 */
function scrollChatToBottom(force = false): void {
  if (!force && !chatAutoScroll.value) return
  requestAnimationFrame(() => {
    const el = chatScroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
/** 点击"回到底部"：立即滚底并恢复自动滚动 */
function scrollToBottomNow(): void {
  const el = chatScroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  chatAutoScroll.value = true
}

// ── WorkBuddy 式统一输入区：无边框 textarea 自适应增高（上限 160px），发送后清空回焦 ──
const composerEl = ref<HTMLTextAreaElement | null>(null)
const COMPOSER_MAX_HEIGHT = 160
function onComposerInput(): void {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
}

/** Markdown 解析 + 净化（防 XSS）；流式过程中随增量内容实时重渲染即"打字式"效果 */
function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src || '', { async: false }) as string)
}

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
  // 记忆上次选择的模型（Provider）：下次进入对话调试保持同一选择
  const savedChat = (await window.api.config.get('tools.model-console.chat.providerId')) as string | null
  if (typeof savedChat === 'string' && providers.value.some((p) => p._id === savedChat)) {
    chatProviderId.value = savedChat
  }
}

// 选择变化时持久化（记忆模型）
watch(chatProviderId, (id) => {
  if (id) void window.api.config.set('tools.model-console.chat.providerId', id)
})

async function persist(): Promise<void> {
  await window.api.config.set('app.llm.providers', providers.value)
}

function openCreate(): void {
  editingId.value = null
  presetId.value = ''
  modelOptions.value = []
  Object.assign(form.value, { _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '' })
  dialogOpen.value = true
}

function openEdit(row: Provider): void {
  editingId.value = row._id
  const matched = presets.value.find((p) => p.baseURL === row.baseURL)
  presetId.value = matched?.id ?? ''
  modelOptions.value = matched ? [...matched.models] : row.model ? [row.model] : []
  Object.assign(form.value, { ...row, apiKey: '' })
  dialogOpen.value = true
}

/** 选预设即自动填好端点与默认模型，用户只需填一个 API Key */
function applyPreset(id: string): void {
  const preset = presets.value.find((p) => p.id === id)
  if (!preset) return
  Object.assign(form.value, {
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
  if (!/^https?:\/\//i.test(form.value.baseURL.trim())) {
    ElMessage.warning('请先填写 http(s) 格式的 baseURL')
    return
  }
  fetchingModels.value = true
  try {
    const probe: Provider = {
      _id: form.value._id || 'prv_preview',
      name: form.value.name || '预览',
      kind: form.value.kind,
      baseURL: form.value.baseURL.trim(),
      model: form.value.model,
      enabled: true,
    }
    const list = await window.api.llm.listModels(probe, form.value.apiKey.trim() || undefined)
    modelOptions.value = Array.from(new Set([...modelOptions.value, ...list.filter(Boolean)]))
    if (!form.value.model && modelOptions.value[0]) form.value.model = modelOptions.value[0]
    ElMessage.success(`拉取到 ${list.length} 个可用模型`)
  } catch (err) {
    // /models 401 / 404 / 端点不开放时回退到该服务商的预设模型，绝不阻断保存
    const preset = presets.value.find((p) => p.baseURL === form.value.baseURL.trim())
    if (preset) {
      modelOptions.value = Array.from(new Set([...modelOptions.value, ...preset.models]))
      if (!form.value.model) form.value.model = preset.defaultModel || preset.models[0] || form.value.model
    }
    ElMessage.warning(`模型列表拉取失败：${(err as Error).message}；已回退预设/手填，不影响保存`)
  } finally {
    fetchingModels.value = false
  }
}

async function saveProvider(): Promise<void> {
  // 必填校验统一走 el-form rules（红星标注入口），通过后才执行保存
  try {
    await formRef.value?.validate()
  } catch {
    ElMessage.warning('请先补全带红星标记的必填项')
    return
  }
  if (!form.value.name.trim() || !form.value.baseURL.trim() || !form.value.model.trim()) {
    ElMessage.warning('名称、baseURL、模型名必填')
    return
  }
  if (!/^https?:\/\//i.test(form.value.baseURL.trim())) {
    ElMessage.warning('baseURL 必须是 http(s) 地址')
    return
  }
  saving.value = true
  try {
    // 先写密钥再改内存、最后落配置：任一步失败都不留下「界面已改但没保存」的假象
    if (editingId.value) {
      const idx = providers.value.findIndex((p) => p._id === editingId.value)
      if (idx >= 0) {
        const { apiKey, ...meta } = form.value
        if (apiKey) await window.api.llm.setApiKey(meta._id, apiKey)
        providers.value[idx] = { ...providers.value[idx]!, ...meta }
      }
    } else {
      const id = entityId('prv')
      const { apiKey, ...meta } = form.value
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
    form.value.apiKey = await window.api.llm.getApiKey(editingId.value)
    ElMessage.success('已填充已存密钥（仅本次编辑会话可见）')
  } catch (err) {
    ElMessage.error(`读取失败：${(err as Error).message}`)
  }
}

async function sendChat(): Promise<void> {
  const provider = activeProvider.value
  const text = chatInput.value.trim()
  if (!provider || !text || chatting.value) return
  chatInput.value = ''
  // 清空后复位输入框高度并回焦，连续对话不用再点输入框
  void nextTick(() => {
    if (composerEl.value) {
      composerEl.value.style.height = 'auto'
      composerEl.value.focus()
    }
  })
  // 多轮：把用户消息入栈，再压一个空 assistant 占位，流式追加
  messages.value.push({ role: 'user', content: text })
  messages.value.push({ role: 'assistant', content: '' })
  chatting.value = true
  scrollChatToBottom(true)
  try {
    const res = await window.api.llm.chat(
      provider,
      // 发送完整历史，但去掉末尾空 assistant 占位
      messages.value.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      { onDelta: true },
    )
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = res.content || last.content
  } catch (err) {
    const last = messages.value[messages.value.length - 1]
    if (last) { last.content = `错误：${(err as Error).message}`; last.error = true }
  } finally {
    chatting.value = false
    scrollChatToBottom()
  }
}

onMounted(() => {
  void load()
  // 流式分片：仅当正在对话且末尾是 assistant 占位时追加，实时渲染即打字效果
  window.api.llm.onDelta((delta) => {
    if (!chatting.value) return
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'assistant') {
      last.content += delta
      scrollChatToBottom()
    }
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
      <div class="chat-panel">
        <!-- 输出区：吃掉除输入区外的全部剩余空间；「回到底部」悬浮其右下 -->
        <div class="chat-main">
          <div ref="chatScroller" class="chat-scroller" @scroll="onChatScroll">
            <div v-if="!messages.length" class="chat-empty">
              <div class="chat-empty-title">对话调试</div>
              <div class="chat-empty-desc">多轮 · 流式打字 · Markdown 回显；apiKey 在主进程注入，不落渲染层</div>
            </div>
            <div v-for="(m, i) in messages" :key="i" class="chat-msg" :class="m.role">
              <div class="chat-role">{{ m.role === 'user' ? '你' : '模型' }}</div>
              <div class="chat-body" :class="{ error: m.error }" v-html="renderMd(m.content)"></div>
            </div>
          </div>
          <transition name="el-fade-in">
            <button v-if="!chatAutoScroll" type="button" class="chat-to-bottom" @click="scrollToBottomNow">
              ↓ 回到底部
            </button>
          </transition>
        </div>
        <!-- WorkBuddy 式统一输入区：无边框自适应 textarea + 底部工具条（模型胶囊 / 发送圆钮） -->
        <div class="composer">
          <textarea
            ref="composerEl"
            v-model="chatInput"
            class="composer-input"
            rows="1"
            :placeholder="activeProvider ? '输入测试内容，Enter 发送，Shift+Enter 换行' : '请先在下方选择模型（Provider）'"
            :disabled="!activeProvider"
            @input="onComposerInput"
            @keydown.enter.exact.prevent="sendChat"
          ></textarea>
          <div class="composer-toolbar">
            <el-select v-model="chatProviderId" class="composer-model" placeholder="选择模型（Provider）">
              <el-option v-for="p in providers" :key="p._id" :label="`${p.name} · ${p.model}`" :value="p._id" />
            </el-select>
            <button
              type="button"
              class="composer-send"
              :disabled="!activeProvider || !chatInput.trim() || chatting"
              :title="chatting ? '生成中…' : '发送（Enter）'"
              @click="sendChat"
            >
              <span v-if="chatting" class="composer-spinner" aria-hidden="true"></span>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
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
      <el-table-column type="index" label="#" width="50" align="center" />
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
            <small class="muted" style="display: block">（{{ health[row._id]!.at }}）</small>
          </span>
          <span v-else class="muted">未测试</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" align="center" fixed="right">
        <template #default="{ row }">
          <div class="op-row">
            <el-button size="small" type="primary" plain :loading="testingId === row._id" @click="testProvider(row)">测试</el-button>
            <el-button size="small" plain @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="askRemove(row)">删除</el-button>
          </div>
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
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px" size="small">
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
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：本地 Ollama" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.kind">
            <el-radio value="local">本地</el-radio>
            <el-radio value="remote">云端</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="baseURL" prop="baseURL">
          <el-input v-model="form.baseURL" placeholder="http://127.0.0.1:11434/v1" />
        </el-form-item>
        <el-form-item label="模型名" prop="model">
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
        <el-form-item label="apiKey" prop="apiKey">
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
/* 全高布局：页面除输入区外全部让给输出区（ToolPageLayout body flex:1 已约束） */
.chat-panel { height: 100%; display: flex; flex-direction: column; }
.chat-main { position: relative; flex: 1; min-height: 0; display: flex; }
.chat-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 4px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-empty { margin: auto; text-align: center; }
.chat-empty-title { font-size: 15px; font-weight: 600; opacity: .75; }
.chat-empty-desc { font-size: 12px; opacity: .55; margin-top: 6px; line-height: 1.6; }
.chat-msg { display: flex; flex-direction: column; max-width: 88%; }
.chat-msg.user { align-self: flex-end; align-items: flex-end; }
.chat-msg.assistant { align-self: flex-start; align-items: flex-start; }
.chat-role { font-size: 11px; opacity: .6; margin-bottom: 2px; }
.chat-body {
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  border: 1px solid rgba(128,128,128,.25);
}
.chat-msg.user .chat-body { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-7); }
.chat-msg.assistant .chat-body { background: rgba(128,128,128,.06); }
.chat-body.error { color: var(--el-color-danger); border-color: var(--el-color-danger); }
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
.chat-body :deep(p) { margin: 0 0 8px; }
.chat-body :deep(p:last-child) { margin-bottom: 0; }
.chat-body :deep(pre) {
  background: rgba(0,0,0,.08);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.chat-body :deep(code) {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  background: rgba(0,0,0,.06);
  padding: 1px 4px;
  border-radius: 4px;
}
.chat-body :deep(pre code) { background: transparent; padding: 0; }
.chat-body :deep(ul), .chat-body :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.chat-body :deep(li) { margin: 2px 0; }
.chat-body :deep(a) { color: var(--el-color-primary); }
.chat-body :deep(table) { border-collapse: collapse; font-size: 12px; }
.chat-body :deep(th), .chat-body :deep(td) { border: 1px solid rgba(128,128,128,.3); padding: 2px 6px; }
.chat-body :deep(blockquote) { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid rgba(128,128,128,.4); opacity: .8; }
/* ── WorkBuddy 式统一输入区：圆角容器 + 无边框自适应 textarea + 底部工具条 ── */
.composer {
  flex: none;
  margin-top: 10px;
  border: 1px solid rgba(128,128,128,.3);
  border-radius: 14px;
  background: var(--el-bg-color);
  padding: 10px 12px 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  transition: border-color .15s;
}
.composer:focus-within { border-color: var(--el-color-primary); }
.composer-input {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  min-height: 24px;
  max-height: 160px;
  overflow-y: auto;
}
.composer-input::placeholder { color: var(--el-text-color-placeholder); }
.composer-input:disabled { cursor: not-allowed; opacity: .6; }
.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
/* 模型胶囊：透明底 + 圆角描边，聚焦变主题色 */
.composer-model { max-width: 300px; }
.composer-model :deep(.el-select__wrapper) {
  border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(128,128,128,.28) inset;
  min-height: 30px;
  padding: 2px 12px;
  font-size: 12px;
}
.composer-model :deep(.el-select__wrapper.is-hovering),
.composer-model :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
/* 发送圆钮：主题色实心，生成中转圈 */
.composer-send {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter .15s, transform .1s;
}
.composer-send svg { width: 16px; height: 16px; }
.composer-send:not(:disabled):hover { filter: brightness(1.12); }
.composer-send:not(:disabled):active { transform: scale(.94); }
.composer-send:disabled { background: var(--el-border-color); cursor: not-allowed; }
.composer-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff;
  animation: composer-spin .8s linear infinite;
}
@keyframes composer-spin { to { transform: rotate(360deg); } }
.chat-to-bottom {
  position: absolute;
  right: 16px;
  bottom: 14px;
  z-index: 5;
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.chat-to-bottom:hover { opacity: .9; }
</style>
