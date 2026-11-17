<script setup lang="ts">
/**
 * 统一分享对话框（plans/09 · 工具接入零成本）：创建 → 展示多 IP 链接 → 复制 → 二维码 → 倒计时 → 续期/撤销。
 * 工具只需 <ShareDialog v-model="open" :tool-id="..." :label="..." :default-root="..." />，
 * 底层统一走宿主 ShareHub（@sshk/ui-kit callHostApi 兜底），工具不自建服务、不占端口。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { callHostApi, type HostApiSpec } from '../host-api'
import { IPC_CHANNELS } from '@sshk/shared'
import type { ShareRouteTicket } from '@sshk/shared'

const props = defineProps<{
  open: boolean
  /** 归属工具 id（宿主按此记账鉴权） */
  toolId: string
  /** 分享展示名（如「海报：产品A」） */
  label: string
  /** 允许访问的根目录（绝对路径，主进程校验存在） */
  defaultRoot: string
  /** 入口相对路径（缺省 = 目录列表页） */
  defaultEntry?: string
  /** 有效期小时，默认 72 */
  defaultTtlHours?: number
  /** 可选访问口令 */
  password?: string
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const SPEC = {
  create: { group: 'shareHub', method: 'create', channel: IPC_CHANNELS.shareHubCreate, label: '创建分享' },
  revoke: { group: 'shareHub', method: 'revoke', channel: IPC_CHANNELS.shareHubRevoke, label: '撤销分享' },
  renew: { group: 'shareHub', method: 'renew', channel: IPC_CHANNELS.shareHubRenew, label: '续期分享' },
} satisfies Record<string, HostApiSpec>

const busy = ref(false)
const ticket = ref<ShareRouteTicket | null>(null)
const activeUrlIndex = ref(0)
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const activeUrl = computed(() => ticket.value?.urls[activeUrlIndex.value] ?? '')
/** 二维码 PNG（第三方 qrcode 包生成，切换 IP 时重算） */
const qrDataUrl = ref('')
watch(activeUrl, async (url) => {
  if (!url) { qrDataUrl.value = ''; return }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      width: 264, margin: 1,
      color: { dark: '#0b0e1cff', light: '#ffffffff' },
      errorCorrectionLevel: 'M',
    })
  } catch { qrDataUrl.value = '' }
}, { immediate: true })
const minutesLeft = computed(() => {
  if (!ticket.value) return 0
  return Math.max(0, Math.round((ticket.value.expiresAt - nowTick.value) / 60000))
})
const expired = computed(() => ticket.value !== null && minutesLeft.value <= 0)

async function createTicket(): Promise<void> {
  const t = await callHostApi<ShareRouteTicket>(SPEC.create, {
    toolId: props.toolId,
    label: props.label,
    root: props.defaultRoot,
    entry: props.defaultEntry ?? '',
    ttlHours: props.defaultTtlHours ?? 72,
    password: props.password,
  })
  ticket.value = t
  activeUrlIndex.value = 0
  if (t.urls[0]) await copyUrl(t.urls[0])
  ElMessage.success('分享已创建，链接已复制')
}

async function doCreate(): Promise<void> {
  busy.value = true
  try { await createTicket() }
  catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

/** 重新生成：二次确认后先撤旧路由（旧链立即失效）再创建新路由 */
async function regenerate(): Promise<void> {
  if (!ticket.value) return
  try {
    await ElMessageBox.confirm(
      '重新生成会让当前链接立即失效，并自动创建、复制新链接。确认继续吗？',
      '重新生成分享链接',
      {
        confirmButtonText: '确认重新生成', cancelButtonText: '取消', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch { return }
  const oldId = ticket.value.id
  busy.value = true
  try {
    await callHostApi(SPEC.revoke, oldId, props.toolId)
    ticket.value = null
    await createTicket()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

async function copyUrl(url?: string): Promise<void> {
  const target = url ?? activeUrl.value
  if (!target) return
  try {
    await callHostApi({ group: 'os', method: 'clipboardWrite', channel: IPC_CHANNELS.osClipboardWrite, label: '写剪贴板' }, target)
  } catch { /* 剪贴板不可用时用户可手动复制输入框内容 */ }
}

async function renew(): Promise<void> {
  if (!ticket.value) return
  busy.value = true
  try {
    ticket.value = await callHostApi<ShareRouteTicket>(SPEC.renew, ticket.value.id, 72, props.toolId)
    ElMessage.success('已续期 72 小时，新链接已刷新')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

async function revoke(): Promise<void> {
  if (!ticket.value) return
  try {
    await ElMessageBox.confirm(
      '撤销后当前链接立即失效且无法恢复。确认撤销分享吗？',
      '撤销分享',
      {
        confirmButtonText: '确认撤销', cancelButtonText: '取消', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch { return }
  busy.value = true
  try {
    await callHostApi(SPEC.revoke, ticket.value.id, props.toolId)
    ticket.value = null
    ElMessage.success('已撤销分享')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

function close(): void { emit('update:open', false) }

watch(() => props.open, (open) => {
  if (open) {
    ticket.value = null
    activeUrlIndex.value = 0
    if (!tickTimer) tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
  } else if (tickTimer) {
    clearInterval(tickTimer); tickTimer = null
  }
})
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="`分享 · ${label}`"
    width="560px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <div class="share-dialog">
      <!-- 未创建：展示信息与创建按钮 -->
      <template v-if="!ticket">
        <p class="share-tip">将创建一个局域网只读分享链接（默认 72 小时有效，可随时撤销）。同一服务多路由并存，旧链接不受影响。</p>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="分享名称">{{ label }}</el-descriptions-item>
          <el-descriptions-item label="入口">{{ defaultEntry || '目录列表页' }}</el-descriptions-item>
          <el-descriptions-item label="有效期">{{ defaultTtlHours ?? 72 }} 小时</el-descriptions-item>
          <el-descriptions-item v-if="password" label="访问口令">已设置（链接带 key）</el-descriptions-item>
        </el-descriptions>
      </template>

      <!-- 已创建：链接 + 二维码 + 倒计时 -->
      <template v-else>
        <div class="share-link-head">
          <el-select v-if="ticket.urls.length > 1" :model-value="activeUrlIndex" size="small" @change="(v: number) => activeUrlIndex = v">
            <el-option v-for="(u, i) in ticket.urls" :key="u" :label="u" :value="i" />
          </el-select>
          <el-button type="success" size="small" :disabled="!activeUrl" @click="copyUrl()">复制</el-button>
        </div>
        <div class="share-qr-block">
          <img v-if="qrDataUrl" class="share-qr" :src="qrDataUrl" alt="分享二维码" />
          <div class="share-qr-tip">
            <p>手机扫码直达</p>
            <p class="muted">链接含 96bit 随机 token{{ password ? ' 与访问口令' : '' }}，仅限可信局域网访问。</p>
          </div>
        </div>
        <div class="share-expire-row">
          <el-tag :type="expired ? 'danger' : 'success'" effect="dark" size="small">
            {{ expired ? '已过期' : `剩余约 ${minutesLeft} 分钟` }}
          </el-tag>
        </div>

      </template>
    </div>

    <template #footer>
      <template v-if="!ticket">
        <el-button type="success" size="small" :loading="busy" @click="doCreate">创建并复制链接</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
      <template v-else>
        <el-button type="primary" size="small" :loading="busy" @click="renew">续期 72h</el-button>
        <el-button type="danger" size="small" plain :loading="busy" @click="revoke">撤销分享</el-button>
        <el-button type="warning" size="small" :loading="busy" @click="regenerate">重新生成</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.share-tip { margin: 0 0 12px; line-height: 1.6; }
.share-link-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.share-link-head .el-select { flex: 1; min-width: 0; }
.share-link-head .el-button { flex: none; margin-left: auto; }
.share-qr-block { display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 14px; }
.share-qr { flex: none; width: 132px; height: 132px; border: 1px solid var(--el-border-color); border-radius: 6px; overflow: hidden; background: #fff; }
.share-qr :deep(svg) { width: 100%; height: 100%; display: block; }
.share-qr-tip { margin-top: 8px; max-width: 380px; }
.share-qr-tip p { margin: 0 0 4px; }
.share-expire-row { display: flex; justify-content: center; margin-top: 14px; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
