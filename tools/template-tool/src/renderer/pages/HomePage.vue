<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { call, logs } from '../store'

/** 能力演示页（2026-11-16 用户反馈改版）：左侧能力导航 + 右侧详情面板 */
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

onMounted(() => { void loadProviders() })

const providerOptions = computed(() => providers.value.map((p) => ({ value: p._id, label: `${p.name}（${p.model}）${p.hasApiKey ? ' ✓key' : ''}` })))

// ── 左侧导航：6 项能力 + 调用日志（CF-5/P7-1 本机 OCR 已移除）──
const CAPS = [
  { id: 'providers', label: '列出 Provider', api: 'listProviders' },
  { id: 'chat-direct', label: '直连对话', api: 'chat' },
  { id: 'chat-provider', label: '按 Provider 对话', api: 'chatByProvider' },
  { id: 'models', label: '查询模型', api: 'listModelsByProvider' },
  { id: 'secret', label: '工具专属密钥', api: 'set/getToolSecret' },
  { id: 'logs', label: '调用日志', api: '—' },
] as const
const activeCap = ref<string>('providers')
</script>

<template>
  <div class="cap-page">
    <el-alert type="info" :closable="false" show-icon class="cap-alert">
      工具包可声明的全部 6 项宿主能力演示（本机 OCR 已移除）；调用经
      <code>window.api.ipc.invoke('&lt;toolId&gt;:&lt;capability&gt;')</code> 转发主进程，密钥不落地渲染层。
    </el-alert>

    <div class="cap-layout">
    <!-- 左侧能力导航 -->
    <div class="cap-nav">
      <button
        v-for="cap in CAPS"
        :key="cap.id"
        type="button"
        class="cap-nav-item"
        :class="{ 'is-active': activeCap === cap.id }"
        @click="activeCap = cap.id"
      >
        <span class="cap-name">{{ cap.label }}</span>
        <code class="cap-api">{{ cap.api }}</code>
      </button>
    </div>

    <!-- 右侧详情面板 -->
    <div class="cap-detail">
      <!-- ① Providers -->
      <template v-if="activeCap === 'providers'">
        <div class="panel-head">列出 Provider（listProviders）</div>
        <el-button type="primary" @click="loadProviders">刷新 Provider</el-button>
        <el-select v-model="providerId" placeholder="选择 Provider" style="width:100%;margin-top:10px" :disabled="!providers.length">
          <el-option v-for="o in providerOptions" :key="o.value" :value="o.value" :label="o.label" />
        </el-select>
        <el-table :data="providers" size="small" max-height="240" style="margin-top:10px">
          <el-table-column prop="name" label="名称" />
          <el-table-column prop="model" label="模型" />
          <el-table-column label="密钥">
            <template #default="{ row }"><el-tag :type="row.hasApiKey ? 'success' : 'info'" size="small">{{ row.hasApiKey ? '已配置' : '无' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </template>

      <!-- ② Chat direct -->
      <template v-else-if="activeCap === 'chat-direct'">
        <div class="panel-head">直连对话（chat，需自备密钥）</div>
        <el-button type="warning" @click="runChatDirect">直连 host.chat</el-button>
        <pre class="result">{{ chatOutputDirect || '（无密钥时可能失败，用于演示通道）' }}</pre>
      </template>

      <!-- ③ ChatByProvider -->
      <template v-else-if="activeCap === 'chat-provider'">
        <div class="panel-head">按 Provider 对话（chatByProvider）</div>
        <el-input v-model="chatInput" type="textarea" :rows="3" placeholder="输入消息" />
        <el-button type="primary" style="margin-top:8px" @click="runChatByProvider">发送（密钥由主进程注入）</el-button>
        <pre class="result">{{ chatOutput || '（返回将显示在此）' }}</pre>
      </template>

      <!-- ④ Models -->
      <template v-else-if="activeCap === 'models'">
        <div class="panel-head">查询模型（listModelsByProvider）</div>
        <el-button type="primary" @click="loadModels">查询所选 Provider 的 /models</el-button>
        <div style="margin-top:10px">
          <el-tag v-for="m in models" :key="m" class="m-1" type="warning" size="small">{{ m }}</el-tag>
          <span v-if="!models.length" class="muted">尚未查询</span>
        </div>
      </template>

      <!-- ⑤⑥ Secret -->
      <template v-else-if="activeCap === 'secret'">
        <div class="panel-head">工具专属密钥（set/getToolSecret）</div>
        <el-input clearable v-model="secretName" placeholder="密钥名" style="margin-bottom:6px" />
        <el-input clearable v-model="secretValue" placeholder="密钥值" style="margin-bottom:6px" />
        <el-button type="success" @click="setSecret">写入 safeStorage</el-button>
        <el-button type="info" @click="getSecret">读取回显</el-button>
        <pre class="result">{{ secretReadback || '（回显将显示在此）' }}</pre>
      </template>

      <!-- 调用日志 -->
      <template v-else>
        <div class="panel-head">调用日志</div>
        <el-empty v-if="!logs.length" description="暂无调用" :image-size="40" />
        <div v-for="l in logs" :key="l.t + l.name" class="log-row">
          <el-tag :type="l.ok ? 'success' : 'danger'" size="small">{{ l.ok ? 'OK' : 'ERR' }}</el-tag>
          <span class="muted">{{ l.t }}</span>
          <b>{{ l.name }}</b>
          <span class="log-detail">{{ l.detail }}</span>
        </div>
      </template>
    </div>
    </div><!-- /cap-layout -->
  </div>
</template>

<style scoped>
.cap-page { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.cap-alert { flex: none; }
.cap-layout { flex: 1; min-height: 0; display: flex; gap: 14px; }
.cap-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 210px;
  flex: none;
  overflow-y: auto;
}
.cap-nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s, border-color 0.15s;
}
.cap-nav-item:hover { background: var(--el-fill-color-light); }
.cap-nav-item.is-active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}
.cap-nav-item.is-active .cap-name { color: var(--el-color-primary); font-weight: 600; }
.cap-name { font-size: 13px; }
.cap-api { font-size: 11px; opacity: .55; word-break: break-all; }
.cap-detail {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-y: auto;
}
.panel-head { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.result { background: var(--el-fill-color-light); border-radius: 6px; padding: 8px; margin-top: 8px; max-height: 260px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
.muted { opacity: 0.6; }
.m-1 { margin: 2px; }
.log-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px dashed var(--el-border-color-lighter); font-size: 12px; }
.log-detail { opacity: 0.8; word-break: break-all; }
</style>
