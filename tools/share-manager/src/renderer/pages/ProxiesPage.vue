<script setup lang="ts">
/**
 * 分享管理 · 代理管理页（plans/12 §8.5，从应用设置迁入）。
 * 三行卡片：目标地址/保留Host · 前缀/启用 · 地址/复制/删除。保存即生效（同键 app.shareHub.proxies）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, CopyDocument } from '@element-plus/icons-vue'
import type { HubStatus, ShareHubProxy } from '@sshk/shared'
import { host } from '../host'

interface ProxyRow { id: string; prefix: string; target: string; keepHost: boolean; enabled: boolean }

/** 属性值含 http:// 字面量会触发 vue-tsc v-for 作用域解析 bug，示例文案走常量绑定 */
const TARGET_PLACEHOLDER = '目标地址（示例 http://192.168.1.10:8080/base，支持 https）'

const status = ref<HubStatus | null>(null)
const proxyRows = ref<ProxyRow[]>([])
const saving = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
const savedProxies = ref<ShareHubProxy[]>([])

function normAlias(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}
function addProxy(): void {
  proxyRows.value.push({ id: window.crypto.randomUUID(), prefix: '', target: '', keepHost: true, enabled: true })
}
async function removeProxy(index: number): Promise<void> {
  const row = proxyRows.value[index]
  if (!row) return
  const saved = savedProxies.value.some((m) => m.id === row.id)
  if (saved) {
    try {
      await ElMessageBox.confirm(`移除代理「/${row.prefix || '未命名'}」？保存后该代理入口将立即失效。`, '移除代理规则', {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
      })
    } catch { return }
  }
  proxyRows.value.splice(index, 1)
}
function proxyLink(row: ProxyRow): string {
  const s = status.value
  if (!s?.running || !s.port || !row.prefix) return ''
  return `http://${s.displayIp}:${s.port}/${row.prefix}/`
}
async function copyProxyLink(row: ProxyRow): Promise<void> {
  const url = proxyLink(row)
  if (!url) return
  try { await host.os.clipboardWrite(url); ElMessage.success('代理地址已复制') } catch (err) { ElMessage.error((err as Error).message) }
}
async function refresh(): Promise<void> {
  try { status.value = await host.shareHub.status() } catch { /* 静默 */ }
}
async function askStartAfterSave(label: string): Promise<void> {
  await refresh()
  if (status.value?.running) { ElMessage.success(`${label}已保存并即时生效`); return }
  try {
    await ElMessageBox.confirm(`${label}已保存。分享服务当前未运行，是否立即启动使链接可访问？`, '保存成功', {
      type: 'info', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '启动服务', cancelButtonText: '暂不启动',
    })
    await (host.shareHubControl as Record<string, (a: string) => Promise<unknown>>).start!('start')
  } catch { /* 暂不启动 */ }
}
async function saveProxies(): Promise<void> {
  const seen = new Set<string>()
  const rows: ShareHubProxy[] = []
  for (const row of proxyRows.value) {
    const prefix = normAlias(row.prefix)
    if (!prefix) { ElMessage.warning('存在路径前缀为空或非法的代理卡片（限小写字母/数字/连字符/下划线）'); return }
    if (!row.target.trim()) { ElMessage.warning('存在目标地址为空的代理卡片，请补全或删除'); return }
    if (seen.has(prefix)) { ElMessage.error(`路径前缀「${prefix}」重复，请修改`); return }
    seen.add(prefix)
    rows.push({ id: row.id, prefix, target: row.target.trim(), keepHost: row.keepHost !== false, enabled: row.enabled === true })
  }
  saving.value = true
  try {
    await host.config.set('app.shareHub.proxies', rows)
    savedProxies.value = rows.map((r) => ({ ...r }))
    await askStartAfterSave('代理规则')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

onMounted(async () => {
  try {
    const arr = (await host.config.get('app.shareHub.proxies')) as ShareHubProxy[] | null
    savedProxies.value = Array.isArray(arr) ? arr : []
    proxyRows.value = savedProxies.value.map((r) => ({ id: r.id, prefix: r.prefix, target: r.target, keepHost: r.keepHost !== false, enabled: r.enabled }))
  } catch { /* 静默 */ }
  void refresh()
  timer = setInterval(() => { void refresh() }, 3000)
})
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })
</script>

<template>
  <div class="page-wrap">
    <div class="toolbar">
      <el-tag size="small" type="info" class="mini-tag">{{ proxyRows.length }} 条</el-tag>
      <span class="hint">访问 http://IP:端口/前缀/… 转发到目标地址（全方法含 POST，响应流式回传）；保存即生效。前缀不得与分享链接/挂载点重复。</span>
    </div>
    <div v-for="(prow, pi) in proxyRows" :key="prow.id" class="mount-card">
      <div class="m-line1">
        <el-input :model-value="prow.target" size="small" :placeholder="TARGET_PLACEHOLDER" class="grow" @update:model-value="prow.target = $event" />
        <el-checkbox :model-value="prow.keepHost" size="small" @update:model-value="prow.keepHost = $event === true">
          保留原始 Host
        </el-checkbox>
      </div>
      <div class="m-line2">
        <el-input :model-value="prow.prefix" size="small" class="grow" @update:model-value="prow.prefix = normAlias($event) || $event" @blur="prow.prefix = normAlias(prow.prefix) || prow.prefix">
          <template #prepend>/</template>
        </el-input>
        <span class="inline-label">启用</span>
        <el-switch v-model="prow.enabled" />
      </div>
      <div class="m-line3">
        <el-input :model-value="proxyLink(prow)" readonly size="small" class="grow wider" placeholder="（服务未运行）" />
        <el-button size="small" text type="primary" :icon="CopyDocument" :disabled="!proxyLink(prow)" @click="copyProxyLink(prow)">复制</el-button>
        <el-button size="small" text type="danger" :icon="Delete" @click="removeProxy(pi)">删除</el-button>
      </div>
    </div>
    <div v-if="!proxyRows.length" class="hint">还没有代理规则，点「添加规则」开始。</div>
    <div class="actions">
      <el-button size="small" type="success" plain @click="addProxy">添加规则</el-button>
      <el-button size="small" type="primary" :loading="saving" @click="saveProxies">保存代理规则</el-button>
    </div>
  </div>
</template>

<style scoped>
.page-wrap { padding: 12px 16px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); }
.mount-card { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.m-line1, .m-line2, .m-line3 { display: flex; align-items: center; gap: 8px; }
.m-line2, .m-line3 { margin-top: 8px; }
.m-line3 { gap: 6px; }
.m-line3 :deep(.el-button + .el-button) { margin-left: 0; }
.m-line3 :deep(.el-button) { padding: 3px 6px; }
.grow { flex: 1; min-width: 160px; }
.wider { min-width: 200px; }
.inline-label { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
</style>
