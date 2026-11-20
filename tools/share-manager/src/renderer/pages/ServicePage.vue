<script setup lang="ts">
/**
 * 分享管理 · 服务配置页（plans/12 §8.3）。
 * 服务状态 + 基础设置（与应用设置同键读写天然一致）+ 日志容量卡片（仅此页配置）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import type { HubStatus, ShareIpInfo } from '@sshk/shared'
import { FormGrid, FormHint } from '@sshk/ui-kit'
import { host } from '../host'

const status = ref<HubStatus | null>(null)
const busy = ref(false)
const saving = ref(false)
const savingCap = ref(false)
const ipManual = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// 基础设置（同键 app.shareHub.*）
const autoStart = ref(true)
const port = ref(56789)
const defaultTtlHours = ref(72)
const allowIndex = ref(false)
const preferredIp = ref('')
// 日志容量（plans/12：仅工具页；clamp 1~100000 / 1~365）
const logMaxCount = ref(5000)
const logRetentionDays = ref(30)

function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
}
const ipError = computed(() => {
  if (!ipManual.value) return ''
  const ip = preferredIp.value.trim()
  if (!ip) return '手动指定模式下 IP 不能为空'
  if (!isValidIPv4(ip)) return 'IP 格式不正确：需为四段 IPv4（如 10.10.101.241）'
  return ''
})

function statusText(): string {
  const s = status.value
  if (!s) return '加载中…'
  return s.running ? `运行中 · 端口 ${s.port}` : '已停止'
}
function statusType(): 'success' | 'info' { return status.value?.running ? 'success' : 'info' }
function ipSummary(): string {
  const s = status.value
  if (!s) return '—'
  return `${s.displayIp}${preferredIp.value ? '' : '（自动优选）'}`
}

async function refresh(): Promise<void> {
  try { status.value = await host.shareHub.status() } catch { /* 未就绪静默 */ }
}

async function control(action: 'start' | 'restart' | 'stop' | 'clear'): Promise<void> {
  const labels: Record<typeof action, string> = { start: '启动', restart: '重启', stop: '停止', clear: '停止服务并清空全部路由' }
  if (action === 'clear') {
    try {
      await ElMessageBox.confirm('停止服务并清空全部分享路由？所有已发链接将永久失效，状态文件会被删除（不影响访问日志）。', '危险操作', {
        type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
      })
    } catch { return }
  }
  busy.value = true
  try {
    await (host.shareHubControl as Record<string, (a: string) => Promise<unknown>>)[action]!(action)
    ElMessage.success(`分享服务已${labels[action]}`)
    await refresh()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

async function loadConfig(): Promise<void> {
  const get = (key: string): Promise<unknown> => host.config.get(key) as Promise<unknown>
  try {
    autoStart.value = (await get('app.shareHub.autoStart')) !== false
    port.value = Number(await get('app.shareHub.port')) || 56789
    defaultTtlHours.value = Number(await get('app.shareHub.defaultTtlHours')) || 72
    allowIndex.value = (await get('app.shareHub.allowIndex')) === true
    preferredIp.value = String(await get('app.shareHub.preferredIp') ?? '')
    ipManual.value = !!preferredIp.value
    const c = Number(await get('app.shareHub.logMaxCount')) || 5000
    logMaxCount.value = Math.min(Math.max(c, 1), 100000)
    const d = Number(await get('app.shareHub.logRetentionDays')) || 30
    logRetentionDays.value = Math.min(Math.max(d, 1), 365)
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function saveBase(): Promise<void> {
  if (ipError.value) { ElMessage.error(ipError.value); return }
  if (!Number.isInteger(port.value) || port.value < 0 || port.value > 65535) { ElMessage.error('监听端口必须是 0-65535 的整数'); return }
  if (!Number.isInteger(defaultTtlHours.value) || defaultTtlHours.value < 0) { ElMessage.error('默认分享时长必须是不小于 0 的整数（0 = 永久有效）'); return }
  saving.value = true
  try {
    await host.config.set('app.shareHub.autoStart', autoStart.value)
    await host.config.set('app.shareHub.port', port.value)
    await host.config.set('app.shareHub.defaultTtlHours', defaultTtlHours.value)
    await host.config.set('app.shareHub.allowIndex', allowIndex.value)
    await host.config.set('app.shareHub.preferredIp', ipManual.value ? preferredIp.value.trim() : '')
    ElMessage.success('基础设置已保存（同键两处入口一致）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

async function saveCapacity(): Promise<void> {
  if (!Number.isInteger(logMaxCount.value) || logMaxCount.value <= 0 || logMaxCount.value > 100000) {
    logMaxCount.value = 5000
    ElMessage.warning('保留条数须为 1~100000 的整数，已回弹默认 5000'); return
  }
  if (!Number.isInteger(logRetentionDays.value) || logRetentionDays.value <= 0 || logRetentionDays.value > 365) {
    logRetentionDays.value = 30
    ElMessage.warning('保留天数须为 1~365 的整数，已回弹默认 30'); return
  }
  savingCap.value = true
  try {
    await host.config.set('app.shareHub.logMaxCount', logMaxCount.value)
    await host.config.set('app.shareHub.logRetentionDays', logRetentionDays.value)
    ElMessage.success('日志容量已保存并即时生效')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { savingCap.value = false }
}

onMounted(() => {
  void refresh()
  void loadConfig()
  timer = setInterval(() => { void refresh() }, 3000)
})
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })
</script>

<template>
  <div class="page-wrap">
    <section class="settings-card">
      <div class="card-title">服务状态</div>
      <div class="status-bar">
        <el-tag :type="statusType()" effect="dark" size="small">{{ statusText() }}</el-tag>
        <span class="ip-text">展示 IP：<strong>{{ ipSummary() }}</strong></span>
        <el-tag v-if="status && !status.running" type="warning" size="small" effect="plain" class="mini-tag">已停止时路由保留，重启即恢复</el-tag>
      </div>
      <div class="actions">
        <el-button type="success" size="small" plain :loading="busy" :disabled="status?.running" @click="control('start')">启动</el-button>
        <el-button type="primary" size="small" plain :loading="busy" @click="control('restart')">重启</el-button>
        <el-button type="warning" size="small" plain :loading="busy" :disabled="!status?.running" @click="control('stop')">停止</el-button>
        <el-divider direction="vertical" />
        <el-button
          type="danger" size="small" plain :loading="busy"
          title="停止服务并删除状态文件，所有已发链接将永久失效（不影响访问日志）"
          @click="control('clear')"
        >停止并清空路由</el-button>
        <el-button size="small" :icon="Refresh" circle @click="refresh" />
      </div>
    </section>

    <section class="settings-card">
      <div class="card-title">基础设置</div>
      <el-form size="small" label-width="auto">
        <FormGrid>
          <el-form-item label="监听端口">
            <el-input-number v-model="port" :min="0" :max="65535" :precision="0" :step="1" />
            <FormHint inline>0 = 自动分配（沿用上次端口）；被占用自动回落并告警</FormHint>
          </el-form-item>
          <el-form-item label="默认分享时长">
            <el-input-number v-model="defaultTtlHours" :min="0" :precision="0" :step="1" />
            <FormHint inline>单位小时；0 = 永久有效</FormHint>
          </el-form-item>
          <el-form-item class="full" label="分享地址 IP">
            <div class="ip-row">
              <el-select v-model="ipManual" style="width: 110px">
                <el-option label="自动（推荐）" :value="false" />
                <el-option label="手动指定" :value="true" />
              </el-select>
              <el-select v-if="!ipManual" :model-value="preferredIp" clearable placeholder="自动（推荐）" style="flex: 1" @change="(v: unknown) => preferredIp = String(v ?? '')">
                <el-option v-for="ip in (status?.ips ?? [])" :key="ip.ip" :label="`${ip.ip} · ${ip.nic}${ip.virtual ? '（虚拟）' : ''}`" :value="ip.ip" />
              </el-select>
              <el-input v-else v-model="preferredIp" :class="{ 'ip-invalid': !!ipError }" placeholder="手输 IPv4，如 10.10.101.241" style="flex: 1" />
            </div>
            <FormHint v-if="ipError" class="hint-error">{{ ipError }}（修复后才能保存）</FormHint>
            <FormHint v-else-if="ipManual && preferredIp && !(status?.ips ?? []).some((x: ShareIpInfo) => x.ip === preferredIp)">该 IP 未在当前网卡上检测到，链接可能无法访问</FormHint>
            <FormHint v-else>选中「自动」时每次生成链接实时优选；变更只影响新分享，已发链接不改写</FormHint>
          </el-form-item>
        </FormGrid>
      </el-form>
      <div class="actions">
        <div class="switch-row">
          <span class="switch-label">随应用启动
            <FormHint inline detail="开启后应用启动时自动拉起分享服务（默认开）">默认开</FormHint>
          </span>
          <el-switch v-model="autoStart" />
        </div>
        <div class="switch-row">
          <span class="switch-label">允许访问目录
            <FormHint inline detail="默认关：访客只能访问具体文件链接，打开裸链接/目录路径一律 404；分享弹框可按次覆盖">默认关</FormHint>
          </span>
          <el-switch v-model="allowIndex" />
        </div>
        <el-button type="primary" size="small" :loading="saving" @click="saveBase">保存基础设置</el-button>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-title">日志容量</div>
      <el-form size="small" label-width="auto">
        <FormGrid>
          <el-form-item label="最多保留条数">
            <el-input-number v-model="logMaxCount" :min="1" :max="100000" :precision="0" :step="100" />
            <FormHint inline>默认 5000，超出后自动删除最旧</FormHint>
          </el-form-item>
          <el-form-item label="保留天数">
            <el-input-number v-model="logRetentionDays" :min="1" :max="365" :precision="0" :step="1" />
            <FormHint inline>默认 30 天，滚动清理过期记录</FormHint>
          </el-form-item>
        </FormGrid>
      </el-form>
      <div class="actions">
        <span class="muted">访问日志持久化到本地数据库（随备份导出）；清空入口在「访问日志」页</span>
        <el-button type="primary" size="small" :loading="savingCap" @click="saveCapacity">保存日志容量</el-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-wrap { padding: var(--sshk-page-padding); box-sizing: border-box; display: flex; flex-direction: column; gap: var(--sshk-gap-md); }
.settings-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 12px 16px; }
.card-title { font-weight: 600; font-size: 13px; margin-bottom: var(--sshk-gap-sm); }
.status-bar { display: flex; align-items: center; gap: var(--sshk-gap-sm); flex-wrap: wrap; }
.actions { display: flex; align-items: center; gap: var(--sshk-gap-sm); flex-wrap: wrap; margin-top: var(--sshk-gap-md); }
.ip-text { font-size: 13px; color: var(--el-text-color-secondary); }
.ip-text strong { color: var(--el-text-color-primary); font-weight: 600; }
.switch-row { margin-right: auto; display: inline-flex; align-items: center; gap: 6px; }
.switch-label { font-size: 12px; color: var(--el-text-color-secondary); }
.ip-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.ip-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.hint-error { color: var(--el-color-danger); }
.muted { font-size: 12px; color: var(--el-text-color-secondary); margin-right: auto; }
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
.full { grid-column: 1 / -1; }
</style>
