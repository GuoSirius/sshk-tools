<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { call, logs } from '../state'

/** 能力演示页：7 项宿主能力的完整调用演示 */
const providers = ref<{ _id: string; name: string; kind: string; model: string; hasApiKey: boolean }[]>([])
const providerId = ref('')
async function loadProviders(): Promise<void> {
  const list = await call<typeof providers.value>('listProviders')
  if (list) { providers.value = list; if (!providerId.value) providerId.value = list[0]?._id ?? '' }
}

// ── 2/3) Chat ──
const chatInput = ref('用一句话介绍 SSHK 工具包。')
const chatOutput = ref('')
async function runChatByProvider(): Promise<void> {
  if (!providerId.value) { ElMessage.warning('请先选择 Provider'); return }
  const r = await call<string>('chatByProvider', { providerId: providerId.value, messages: [{ role: 'user', content: chatInput.value }] })
  if (r !== undefined) chatOutput.value = r
}
// 直连 host.chat：用 Provider 的 baseURL/model 构造请求（无密钥时可能失败，演示用）
const chatOutputDirect = ref('')
async function runChatDirect(): Promise<void> {
  const p = providers.value.find((x) => x._id === providerId.value)
  if (!p) { ElMessage.warning('请先选择 Provider'); return }
  const r = await call<string>('chat', { baseURL: p.kind === 'local' ? 'http://localhost:11434/v1' : '', model: p.model, messages: [{ role: 'user', content: chatInput.value }] })
  if (r !== undefined) chatOutputDirect.value = r
}

// ── 4) Models ──
const models = ref<string[]>([])
async function loadModels(): Promise<void> {
  if (!providerId.value) { ElMessage.warning('请先选择 Provider'); return }
  const r = await call<string[]>('listModelsByProvider', providerId.value)
  if (r) models.value = r
}

// ── 5/6) Secret ──
const secretName = ref('demo-key')
const secretValue = ref('s3cr3t-123')
const secretReadback = ref('')
async function setSecret(): Promise<void> {
  const r = await call<boolean>('setSecret', secretName.value, secretValue.value)
  if (r) ElMessage.success(`已写入密钥「${secretName.value}」（safeStorage）`)
}
async function getSecret(): Promise<void> {
  const r = await call<string>('getSecret', secretName.value)
  if (r !== undefined) secretReadback.value = r
}

// ── 7) OCR ──
const ocrCommand = ref('paddleocr')
const ocrImage = ref('')
const ocrResult = ref('')
async function runOcr(): Promise<void> {
  if (!ocrCommand.value || !ocrImage.value) { ElMessage.warning('请填写 OCR 命令与图片路径'); return }
  const r = await call<string>('runOcr', { command: ocrCommand.value, args: ['predict', '--image_dir', ocrImage.value], imagePath: ocrImage.value, timeoutMs: 30000 })
  if (r !== undefined) ocrResult.value = r
}

onMounted(() => { void loadProviders() })

const providerOptions = computed(() => providers.value.map((p) => ({ value: p._id, label: `${p.name}（${p.model}）${p.hasApiKey ? ' ✓key' : ''}` })))
</script>

<template>
  <div>
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
      本页演示工具包可声明的全部 7 项宿主能力；所有调用经
      <code>window.api.ipc.invoke('&lt;toolId&gt;:&lt;capability&gt;')</code> 转发主进程，
      密钥不落地渲染层。运行时外部包（examples/template-tool）渲染层与此完全同构。
    </el-alert>

    <el-row :gutter="16">
      <!-- Providers -->
      <el-col :span="12">
        <el-card shadow="hover" header="① 列出 Provider（listProviders）">
          <el-button type="primary" @click="loadProviders">刷新 Provider</el-button>
          <el-select v-model="providerId" placeholder="选择 Provider" style="width:100%;margin-top:10px" :disabled="!providers.length">
            <el-option v-for="o in providerOptions" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
          <el-table :data="providers" size="small" max-height="180" style="margin-top:10px">
            <el-table-column prop="name" label="名称" />
            <el-table-column prop="model" label="模型" />
            <el-table-column label="密钥">
              <template #default="{ row }"><el-tag :type="row.hasApiKey ? 'success' : 'info'" size="small">{{ row.hasApiKey ? '已配置' : '无' }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- Models -->
      <el-col :span="12">
        <el-card shadow="hover" header="④ 查询模型（listModelsByProvider）">
          <el-button type="primary" @click="loadModels">查询所选 Provider 的 /models</el-button>
          <div style="margin-top:10px">
            <el-tag v-for="m in models" :key="m" class="m-1" type="warning" size="small">{{ m }}</el-tag>
            <span v-if="!models.length" class="muted">尚未查询</span>
          </div>
        </el-card>
      </el-col>

      <!-- ChatByProvider -->
      <el-col :span="12">
        <el-card shadow="hover" header="③ 按 Provider 对话（chatByProvider）">
          <el-input v-model="chatInput" type="textarea" :rows="3" placeholder="输入消息" />
          <el-button type="primary" style="margin-top:8px" @click="runChatByProvider">发送（密钥由主进程注入）</el-button>
          <pre class="result">{{ chatOutput || '（返回将显示在此）' }}</pre>
        </el-card>
      </el-col>

      <!-- Chat direct -->
      <el-col :span="12">
        <el-card shadow="hover" header="② 直连对话（chat，需自备密钥）">
          <el-button type="warning" style="margin-top:8px" @click="runChatDirect">直连 host.chat</el-button>
          <pre class="result">{{ chatOutputDirect || '（无密钥时可能失败，用于演示通道）' }}</pre>
        </el-card>
      </el-col>

      <!-- Secret -->
      <el-col :span="12">
        <el-card shadow="hover" header="⑤⑥ 工具专属密钥（set/getToolSecret）">
          <el-input v-model="secretName" placeholder="密钥名" style="margin-bottom:6px" />
          <el-input v-model="secretValue" placeholder="密钥值" style="margin-bottom:6px" />
          <el-button type="success" @click="setSecret">写入 safeStorage</el-button>
          <el-button type="info" @click="getSecret">读取回显</el-button>
          <pre class="result">{{ secretReadback || '（回显将显示在此）' }}</pre>
        </el-card>
      </el-col>

      <!-- OCR -->
      <el-col :span="12">
        <el-card shadow="hover" header="⑦ 本机 OCR（runLocalOcr）">
          <el-input v-model="ocrCommand" placeholder="OCR 命令" style="margin-bottom:6px" />
          <el-input v-model="ocrImage" placeholder="图片绝对路径" style="margin-bottom:6px" />
          <el-button type="primary" @click="runOcr">执行识别</el-button>
          <pre class="result">{{ ocrResult || '（识别结果将显示在此）' }}</pre>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" header="调用日志" style="margin-top:16px">
      <el-empty v-if="!logs.length" description="暂无调用" :image-size="40" />
      <div v-for="l in logs" :key="l.t + l.name" class="log-row">
        <el-tag :type="l.ok ? 'success' : 'danger'" size="small">{{ l.ok ? 'OK' : 'ERR' }}</el-tag>
        <span class="muted">{{ l.t }}</span>
        <b>{{ l.name }}</b>
        <span class="log-detail">{{ l.detail }}</span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.result { background: var(--el-fill-color-light); border-radius: 6px; padding: 8px; margin-top: 8px; max-height: 160px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
.muted { opacity: 0.6; }
.m-1 { margin: 2px; }
.log-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px dashed var(--el-border-color-lighter); font-size: 12px; }
.log-detail { opacity: 0.8; word-break: break-all; }
</style>
