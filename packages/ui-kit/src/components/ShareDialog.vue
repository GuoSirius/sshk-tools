<script setup lang="ts">
/**
 * 统一分享对话框（plans/09 · 工具接入零成本）：打开即复用有效链接/自动创建 → 二维码 → 复制 → 倒计时 → TTL 管理/撤销/重新生成。
 * 工具只需 <ShareDialog v-model="open" :tool-id="..." :label="..." :default-root="..." />，
 * 底层统一走宿主 ShareHub（@sshk/ui-kit callHostApi 兜底），工具不自建服务、不占端口。
 * TTL 三按钮（用户 2026-11-17 拍板）：续期 TTL=在当前到期上累加；更新 TTL=从当前重新计时；永久有效=ttlHours 0。三者均复用 token，URL 不变。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { callHostApi, type HostApiSpec } from '../host-api'
import { IPC_CHANNELS, SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'
import type { ShareRouteTicket, ShareRouteInfo } from '@sshk/shared'

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
  /** 可选访问口令 */
  password?: string
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const SPEC = {
  configGet: { group: 'config', method: 'get', channel: IPC_CHANNELS.configGet, label: '读取应用配置' },
  create: { group: 'shareHub', method: 'create', channel: IPC_CHANNELS.shareHubCreate, label: '创建分享' },
  list: { group: 'shareHub', method: 'list', channel: IPC_CHANNELS.shareHubList, label: '分享路由列表' },
  revoke: { group: 'shareHub', method: 'revoke', channel: IPC_CHANNELS.shareHubRevoke, label: '撤销分享' },
  renew: { group: 'shareHub', method: 'renew', channel: IPC_CHANNELS.shareHubRenew, label: '更新分享时长' },
} satisfies Record<string, HostApiSpec>

const busy = ref(false)
const ticket = ref<ShareRouteTicket | null>(null)
const activeUrlIndex = ref(0)
const nowTick = ref(Date.now())
const loadError = ref('')
/** 数字框时长：默认读应用设置 app.shareHub.defaultTtlHours，用户可自行调整 */
const ttlHours = ref(72)
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 同一分享目标跨重启复用链接；key 只对四元组取短哈希，不把路径/中文直接塞进 localStorage 键 */
const storageKey = computed(() => {
  const raw = [props.toolId, props.label, props.defaultRoot, props.defaultEntry ?? ''].join('|')
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `sshk:share-dialog:${(h >>> 0).toString(36)}`
})

function saveTicket(t: ShareRouteTicket | null): void {
  try {
    if (t) localStorage.setItem(storageKey.value, JSON.stringify(t))
    else localStorage.removeItem(storageKey.value)
  } catch { /* localStorage 不可用时退化为内存态 */ }
}

function readTicket(): ShareRouteTicket | null {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (!raw) return null
    const t = JSON.parse(raw) as ShareRouteTicket
    if (!t?.id || !Array.isArray(t.urls) || !t.urls.length || typeof t.expiresAt !== 'number') return null
    return t
  } catch { return null }
}

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
const permanent = computed(() => ticket.value !== null && ticket.value.expiresAt === SHARE_PERMANENT_EXPIRES_AT)
const minutesLeft = computed(() => {
  if (!ticket.value) return 0
  if (permanent.value) return 0
  return Math.max(0, Math.round((ticket.value.expiresAt - nowTick.value) / 60000))
})
const expired = computed(() => ticket.value !== null && !permanent.value && minutesLeft.value <= 0)

/** 读取应用设置的默认时长；非法回落 72。0 = 永久有效 */
async function resolveTtlHours(): Promise<number> {
  try {
    const raw = await callHostApi<unknown>(SPEC.configGet, 'app.shareHub.defaultTtlHours')
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return n
  } catch { /* 配置不可读时用默认值 */ }
  return 72
}

async function createTicket(): Promise<void> {
  const t = await callHostApi<ShareRouteTicket>(SPEC.create, {
    toolId: props.toolId,
    label: props.label,
    root: props.defaultRoot,
    entry: props.defaultEntry ?? '',
    ttlHours: ttlHours.value,
    password: props.password,
  })
  ticket.value = t
  saveTicket(t)
  activeUrlIndex.value = 0
  if (t.urls[0]) await copyUrl(t.urls[0])
  ElMessage.success(permanent.value ? '永久分享已创建，链接已复制' : '分享已创建，链接已复制')
}

/** 打开即准备链接：有效期 + 路由列表双重校验，有效则复用，失效/撤销/未创建才自动创建 */
async function ensureTicket(): Promise<void> {
  if (busy.value) return
  busy.value = true
  loadError.value = ''
  try {
    ttlHours.value = await resolveTtlHours()
    const saved = readTicket()
    if (saved && (saved.expiresAt === SHARE_PERMANENT_EXPIRES_AT || saved.expiresAt > Date.now())) {
      let alive = true
      try {
        const routes = await callHostApi<ShareRouteInfo[]>(SPEC.list, props.toolId)
        alive = routes.some((r) => r.id === saved.id && (r.expiresAt === SHARE_PERMANENT_EXPIRES_AT || r.expiresAt > Date.now()))
      } catch { /* 校验接口失败时信任本地未过期记录 */ }
      if (alive) { ticket.value = saved; return }
    }
    ticket.value = null
    saveTicket(null)
    await createTicket()
  } catch (err) {
    loadError.value = (err as Error).message
    ElMessage.error(loadError.value)
  } finally {
    busy.value = false
  }
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
    saveTicket(null)
    await createTicket()
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

async function copyUrl(url?: string): Promise<void> {
  const target = url ?? activeUrl.value
  if (!target) return
  try {
    await callHostApi({ group: 'os', method: 'clipboardWrite', channel: IPC_CHANNELS.osClipboardWrite, label: '写剪贴板' }, target)
  } catch { /* 剪贴板不可用时用户可点首行「复制」 */ }
}

/** TTL 三操作统一入口：均复用 token，URL 不变 */
async function applyTtl(mode: 'extend' | 'reset' | 'permanent'): Promise<void> {
  if (!ticket.value) return
  const hours = mode === 'permanent' ? 0 : ttlHours.value
  if (mode !== 'permanent' && (!Number.isInteger(hours) || hours < 1)) {
    ElMessage.warning('时长需为不小于 1 的整数小时'); return
  }
  busy.value = true
  try {
    const id = ticket.value.id
    const next = await callHostApi<ShareRouteTicket>(SPEC.renew, id, hours, props.toolId, mode === 'reset' ? 'reset' : 'extend')
    ticket.value = next
    saveTicket(next)
    const msg = mode === 'permanent' ? '已设为永久有效，链接不变'
      : mode === 'extend' ? `已累加 ${hours} 小时，链接不变`
      : `已更新为 ${hours} 小时（从当前重新计时），链接不变`
    ElMessage.success(msg)
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
    saveTicket(null)
    ElMessage.success('已撤销分享')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

function close(): void { emit('update:open', false) }

watch(() => props.open, (open) => {
  if (open) {
    ticket.value = null
    activeUrlIndex.value = 0
    void ensureTicket()
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
      <template v-if="!ticket">
        <div v-loading="!loadError" element-loading-text="正在准备分享链接…" class="share-loading">
          <p v-if="loadError" class="share-error">分享创建失败：{{ loadError }}，可点「重试」或关闭。</p>
        </div>
      </template>

      <template v-else>
        <div class="share-ttl-row">
          <el-input-number v-model="ttlHours" :min="1" :precision="0" :step="1" size="small" class="ttl-input" />
          <span class="ttl-unit">小时</span>
          <el-button type="primary" size="small" :loading="busy" :disabled="permanent" @click="applyTtl('extend')">续期 TTL</el-button>
          <el-button type="warning" size="small" plain :loading="busy" @click="applyTtl('reset')">更新 TTL</el-button>
          <el-button type="success" size="small" plain :loading="busy" :disabled="permanent" @click="applyTtl('permanent')">永久有效</el-button>
        </div>
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
          <el-tag v-if="permanent" type="warning" effect="dark" size="small">永久有效</el-tag>
          <el-tag v-else :type="expired ? 'danger' : 'success'" effect="dark" size="small">
            {{ expired ? '已过期' : `剩余约 ${minutesLeft} 分钟` }}
          </el-tag>
        </div>
        <el-divider class="share-bottom-divider" />
      </template>
    </div>

    <template #footer>
      <template v-if="!ticket">
        <el-button v-if="loadError" type="success" size="small" @click="ensureTicket">重试</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
      <template v-else>
        <el-button type="danger" size="small" plain :loading="busy" @click="revoke">撤销分享</el-button>
        <el-button type="warning" size="small" :loading="busy" @click="regenerate">重新生成</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.share-loading { display: flex; align-items: center; justify-content: center; min-height: 180px; text-align: center; }
.share-error { margin: 0 16px; color: var(--el-color-danger); line-height: 1.6; }
.share-link-head { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.share-link-head .el-select { flex: 1; min-width: 0; }
.share-link-head .el-button { flex: none; margin-left: auto; }
.share-ttl-row { display: flex; align-items: center; gap: 8px; }
.share-ttl-row .ttl-input { flex: 1; min-width: 0; }
.share-ttl-row .ttl-unit { flex: none; font-size: 12px; opacity: 0.7; }
.share-ttl-row .el-button { flex: none; }
.share-qr-block { display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 14px; }
.share-qr { flex: none; width: 132px; height: 132px; border: 1px solid var(--el-border-color); border-radius: 6px; overflow: hidden; background: #fff; }
.share-qr :deep(svg) { width: 100%; height: 100%; display: block; }
.share-qr-tip { margin-top: 8px; max-width: 380px; }
.share-qr-tip p { margin: 0 0 4px; }
.share-expire-row { display: flex; justify-content: center; margin-top: 14px; }
.share-bottom-divider { margin: 14px 0 0; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
