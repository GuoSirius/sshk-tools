<script setup lang="ts">
/**
 * 应用设置 · 分享服务 tab（plans/09；plans/12 瘦身为两卡片）。
 * 仅服务状态 + 基础设置。路由管理/访问日志/挂载目录/代理规则已迁入「分享管理」工具（share-manager），
 * 两处入口同键读写 app.shareHub.* + 同 IPC shareHub:*，天然一致。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IPC_CHANNELS } from '@sshk/shared'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { appConfig, saveAppConfig } from '../../composables/useAppConfig'

type ShareStatus = import('@sshk/shared').HubStatus
type ShareIp = import('@sshk/shared').ShareIpInfo

const SHARE_SPECS = {
  status: { group: 'shareHub', method: 'status', channel: IPC_CHANNELS.shareHubStatus, label: '分享服务状态' },
} satisfies Record<string, HostApiSpec>
function controlSpec(action: 'start' | 'restart' | 'stop' | 'clear'): HostApiSpec {
  return { group: 'shareHubControl', method: action, channel: IPC_CHANNELS.shareHubControl, label: `分享服务${action}` }
}

const shareStatus = ref<ShareStatus | null>(null)
const shareBusy = ref(false)
const saving = ref(false)
const shareIpManual = ref(false) // true = 手输；false = 下拉选（含「自动」）
let shareTimer: ReturnType<typeof setInterval> | null = null

/** IPv4 合法校验：四段 0-255、纯数字，不允许前导空格/多余点 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
}
/** 手动 IP 输入错误文案（空 = 合法）；下拉模式恒合法 */
const shareIpError = computed(() => {
  if (!shareIpManual.value) return ''
  const ip = appConfig.sharePreferredIp.trim()
  if (!ip) return '手动指定模式下 IP 不能为空'
  if (!isValidIPv4(ip)) return 'IP 格式不正确：需为四段 IPv4（如 10.10.101.241）'
  return ''
})

async function refreshShare(): Promise<void> {
  try {
    shareStatus.value = await callHostApi<ShareStatus>(SHARE_SPECS.status)
  } catch { /* 宿主能力未就绪时静默 */ }
}
function statusText(): string {
  const s = shareStatus.value
  if (!s) return '加载中…'
  return s.running ? `运行中 · 端口 ${s.port}` : '已停止'
}
function statusType(): 'success' | 'info' { return shareStatus.value?.running ? 'success' : 'info' }
function ipSummary(): string {
  const s = shareStatus.value
  if (!s) return '—'
  return `${s.displayIp}${appConfig.sharePreferredIp ? '' : '（自动优选）'}`
}

async function shareControl(action: 'start' | 'restart' | 'stop' | 'clear'): Promise<void> {
  const labels: Record<typeof action, string> = { start: '启动', restart: '重启', stop: '停止', clear: '停止服务并清空全部路由' }
  if (action === 'clear') {
    try {
      await ElMessageBox.confirm('停止服务并清空全部分享路由？所有已发链接将永久失效，状态文件会被删除（不影响访问日志）。', '危险操作', {
        type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消',
        closeOnClickModal: false, closeOnPressEscape: false,
      })
    } catch { return }
  }
  shareBusy.value = true
  try {
    await callHostApi(controlSpec(action), action)
    ElMessage.success(`分享服务已${labels[action]}`)
    await refreshShare()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { shareBusy.value = false }
}
async function save(): Promise<void> {
  // 前置校验：非法配置绝不落盘，避免覆盖已保存的正确值（用户 2026-11-17）
  if (shareIpError.value) { ElMessage.error(shareIpError.value); return }
  const port = Number(appConfig.sharePort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    ElMessage.error('监听端口必须是 0-65535 的整数'); return
  }
  const ttl = Number(appConfig.shareDefaultTtlHours)
  if (!Number.isInteger(ttl) || ttl < 0) {
    ElMessage.error('默认分享时长必须是不小于 0 的整数（0 = 永久有效）'); return
  }
  saving.value = true
  try {
    // saveAppConfig('share') 只写 shareHub.* 分组 key，不影响其它 tab 已保存的字段，无需重载
    await saveAppConfig('share')
    // 展示 IP 由 status.displayIp（主进程实时按 preferredIp 计算）决定：保存后立即重拉，
    // 否则要等 3s 定时器才更新（用户 2026-11-20 反馈「改了 IP 保存后服务状态没变」）
    await refreshShare()
    ElMessage.success('分享设置已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

onMounted(() => {
  void refreshShare()
  // 组件仅在激活时挂载：定时器跟随生命周期，持续刷新服务状态/倒计时
  shareTimer = setInterval(() => { void refreshShare() }, 3000)
})
onUnmounted(() => { if (shareTimer) { clearInterval(shareTimer); shareTimer = null } })
</script>

<template>
  <div class="share-tab">
    <!-- 服务状态 -->
    <section class="settings-card">
      <div class="card-title">服务状态</div>
      <div class="share-status-bar">
        <el-tag :type="statusType()" effect="dark" size="small">{{ statusText() }}</el-tag>
        <span class="muted">展示 IP：{{ ipSummary() }}</span>
        <el-tag v-if="shareStatus && !shareStatus.running" type="warning" size="small" effect="plain">已停止时路由保留，重启即恢复</el-tag>
      </div>
      <div class="card-actions share-actions">
        <div class="switch-row autostart-row">
          <span class="switch-label">随应用启动
            <FormHint inline detail="开启后应用启动时自动拉起分享服务（默认开）">默认开</FormHint>
          </span>
          <el-switch v-model="appConfig.shareAutoStart" />
        </div>
        <el-button type="success" size="small" :loading="shareBusy" @click="shareControl('start')">启动</el-button>
        <el-button type="primary" size="small" :loading="shareBusy" @click="shareControl('restart')">重启</el-button>
        <el-button type="warning" size="small" :loading="shareBusy" :disabled="!shareStatus?.running" @click="shareControl('stop')">停止</el-button>
        <el-button type="danger" size="small" :loading="shareBusy" @click="shareControl('clear')">停止服务并清空全部路由</el-button>
      </div>
    </section>

    <!-- 基础设置 -->
    <section class="settings-card">
      <div class="card-title">基础设置</div>
      <el-form size="small" label-position="top">
        <FormGrid>
          <el-form-item label="监听端口">
            <el-input-number v-model="appConfig.sharePort" :min="0" :max="65535" :precision="0" :step="1" />
            <FormHint inline>0 = 自动分配（沿用上次端口，保证链接稳定）；被占用时自动回落并告警</FormHint>
          </el-form-item>
          <el-form-item label="默认分享时长">
            <el-input-number v-model="appConfig.shareDefaultTtlHours" :min="0" :precision="0" :step="1" />
            <FormHint inline>单位小时；0 = 永久有效</FormHint>
          </el-form-item>
          <el-form-item class="full" label="分享地址 IP">
            <div class="share-ip-row">
              <el-select v-model="shareIpManual" style="width: 110px">
                <el-option label="自动（推荐）" :value="false" />
                <el-option label="手动指定" :value="true" />
              </el-select>
              <el-select v-if="!shareIpManual" :model-value="appConfig.sharePreferredIp" clearable placeholder="自动（推荐）" style="flex: 1" @change="(v: unknown) => appConfig.sharePreferredIp = String(v ?? '')">
                <el-option v-for="ip in (shareStatus?.ips ?? [])" :key="ip.ip" :label="`${ip.ip} · ${ip.nic}${ip.virtual ? '（虚拟）' : ''}`" :value="ip.ip" />
              </el-select>
              <el-input v-else v-model="appConfig.sharePreferredIp" :class="{ 'ip-invalid': !!shareIpError }" placeholder="手输 IPv4，如 10.10.101.241" style="flex: 1" />
            </div>
            <FormHint v-if="shareIpError" class="hint-error">{{ shareIpError }}（修复后才能保存）</FormHint>
            <FormHint v-else-if="shareIpManual && appConfig.sharePreferredIp && !(shareStatus?.ips ?? []).some((x: ShareIp) => x.ip === appConfig.sharePreferredIp)">
              该 IP 未在当前网卡上检测到，链接可能无法访问
            </FormHint>
            <FormHint v-else>选中「自动」时每次生成链接实时优选；变更只影响新分享，已发链接不改写</FormHint>
          </el-form-item>
        </FormGrid>
      </el-form>
      <div class="card-actions share-actions">
        <!-- 开关一行布局约定（用户多次订正）：文字与开关同排，行内注释只留短语，长说明进 FormHint detail（❓） -->
        <div class="switch-row allow-index-row">
          <span class="switch-label">允许访问目录
            <FormHint inline detail="默认关：访客只能访问具体文件链接（前缀+路径），打开裸链接/目录路径一律 404，防止翻看整个产物目录；分享弹框可按次覆盖本设置">默认关</FormHint>
          </span>
          <el-switch v-model="appConfig.shareAllowIndex" />
        </div>
        <el-button type="primary" size="small" :loading="saving" @click="save">保存分享设置</el-button>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* 根容器 .share-tab 的多卡片间距在 theme.css 全局统一（.tools-tab 等同规则） */
.share-status-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.share-actions { justify-content: flex-start; gap: 12px; align-items: center; flex-wrap: wrap; }
.autostart-row { margin-right: auto; }
.allow-index-row { margin-right: auto; }
.share-ip-row { display: flex; align-items: center; gap: 8px; width: 100%; }
:deep(.ip-invalid .el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.hint-error { color: var(--el-color-danger); }
</style>
