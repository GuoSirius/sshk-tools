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

const providers = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const form = reactive<Provider & { apiKey: string }>({
  _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '',
})
const health = reactive<Record<string, { ok: boolean; message: string }>>({})
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
}

async function persist(): Promise<void> {
  await window.api.config.set('app.llm.providers', providers.value)
}

function openCreate(): void {
  editingId.value = null
  Object.assign(form, { _id: '', name: '', kind: 'remote', baseURL: '', model: '', enabled: true, apiKey: '' })
  dialogOpen.value = true
}

function openEdit(row: Provider): void {
  editingId.value = row._id
  Object.assign(form, { ...row, apiKey: '' })
  dialogOpen.value = true
}

async function saveProvider(): Promise<void> {
  if (!form.name.trim() || !form.baseURL.trim() || !form.model.trim()) {
    ElMessage.warning('名称、baseURL、模型名必填')
    return
  }
  if (editingId.value) {
    const idx = providers.value.findIndex((p) => p._id === editingId.value)
    if (idx >= 0) {
      const { apiKey, ...meta } = form
      providers.value[idx] = { ...providers.value[idx]!, ...meta }
      if (apiKey) await window.api.llm.setApiKey(meta._id, apiKey)
    }
  } else {
    const id = entityId('prv')
    const { apiKey, ...meta } = form
    providers.value.push({ ...meta, _id: id })
    if (apiKey) await window.api.llm.setApiKey(id, apiKey)
  }
  await persist()
  dialogOpen.value = false
  ElMessage.success('已保存（apiKey 加密存储，不进配置文件）')
}

const removeOpen = ref(false)
const removeTarget = ref<Provider | null>(null)

function askRemove(row: Provider): void {
  removeTarget.value = row
  removeOpen.value = true
}

async function doRemove(): Promise<void> {
  if (removeTarget.value) {
    providers.value = providers.value.filter((p) => p._id !== removeTarget.value!._id)
    await window.api.llm.setApiKey(removeTarget.value._id, '')
    await persist()
    ElMessage.success('已删除')
  }
  removeOpen.value = false
}

async function testProvider(row: Provider): Promise<void> {
  testingId.value = row._id
  try {
    health[row._id] = await window.api.llm.healthCheck(row)
  } catch (err) {
    health[row._id] = { ok: false, message: (err as Error).message }
  } finally {
    testingId.value = null
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
    description="配置模型 provider（本地 Ollama / 云 API），测试连通性并试聊；apiKey 单独加密存储"
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

    <el-dialog v-model="dialogOpen" :title="editingId ? '编辑 Provider' : '新增 Provider'" width="480px">
      <el-form label-width="90px" size="small">
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
          <el-input v-model="form.model" placeholder="qwen2.5:7b" />
        </el-form-item>
        <el-form-item label="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editingId ? '留空则不修改' : '本地服务可留空'"
          />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveProvider">保存</el-button>
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
