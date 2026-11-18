<script setup lang="ts">
/**
 * 统一分享对话框（plans/09 · 工具接入零成本）。
 * 界面（用户 2026-11-18 定版）：恢复上一版布局——TTL 三按钮（续期 TTL=在当前到期上累加 /
 * 更新 TTL=从当前重新计时 / 永久有效=0）+ 链接行（下拉+目录开关+复制）+ 二维码 + 剩余时间；
 * 新建与再分享统一为一个界面：无票（含撤销后）出创建态（同一套设置行，点「创建分享」才建），
 * 有票直接展示链接与二维码。
 * 生效原则：打开弹框只读现状不自动创建（防误建）；有票后 TTL 三按钮点击即确认生效（按钮本身即确认）；
 *          目录开关变更需二次确认后才 renew patch 生效（链接不变），失败回滚勾选。
 * 工具只需 <ShareDialog v-model="open" :tool-id="..." :label="..." :default-root="..." />，
 * 底层统一走宿主 ShareHub（@sshk/ui-kit callHostApi 兜底），工具不自建服务、不占端口。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { callHostApi, type HostApiSpec } from '../host-api'
import { shareDialogStorageKey, readShareTicket } from '../share-ticket'
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
  renew: { group: 'shareHub', method: 'renew', channel: IPC_CHANNELS.shareHubRenew, label: '更新分享设置' },
} satisfies Record<string, HostApiSpec>

/** 四态：loading 读取现状 / form 无票（统一创建态，撤销后也回这里）/ ready 有票（链接+TTL三按钮）/ error 读取失败 */
type Phase = 'loading' | 'form' | 'ready' | 'error'
const phase = ref<Phase>('loading')
const busy = ref(false)
const loadError = ref('')
const ticket = ref<ShareRouteTicket | null>(null)
const activeUrlIndex = ref(0)
const nowTick = ref(Date.now())
/** 数字框时长：默认读应用设置 app.shareHub.defaultTtlHours；ready 态供三按钮取值，form 态随创建生效 */
const ttlHours = ref(72)
/** form 态「永久有效」勾选（有票后由 ticket.expiresAt 判定，不用勾选） */
const permanentSel = ref(false)
/** 允许访问目录：form 态随创建生效（默认读应用设置）；ready 态为当前生效值，变更需二次确认。
 *  生效值单独跟踪（allowIndexEffective）：ticket 类型不含 allowIndex，勾选态需与生效值比对判断变更与回滚 */
const allowIndex = ref(false)
const allowIndexEffective = ref(false)
/** form 态补充提示（如「（当前链接已撤销）」） */
const formHint = ref('')

let tickTimer: ReturnType<typeof setInterval> | null = null

/** 同一分享目标跨重启复用链接；键构造收敛在 share-ticket.ts（工具页「复制链接」读同一把键） */
const storageKey = computed(() => shareDialogStorageKey(props.toolId, props.label, props.defaultRoot, props.defaultEntry))

function saveTicket(t: ShareRouteTicket | null): void {
  try {
    if (t) localStorage.setItem(storageKey.value, JSON.stringify(t))
    else localStorage.removeItem(storageKey.value)
  } catch { /* localStorage 不可用时退化为内存态 */ }
}

function readTicket(): ShareRouteTicket | null {
  return readShareTicket(props.toolId, props.label, props.defaultRoot, props.defaultEntry)
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

/** 读取应用设置的「允许访问目录」默认（app.shareHub.allowIndex）；读不到按不允许 */
async function resolveAppAllowIndex(): Promise<boolean> {
  try {
    return (await callHostApi<unknown>(SPEC.configGet, 'app.shareHub.allowIndex')) === true
  } catch { return false }
}

/** 打开弹框：只读取现状，不创建、不修改。有有效票 → ready（复用展示）；无票 → form（创建态等用户确认） */
async function loadTicket(): Promise<void> {
  phase.value = 'loading'
  loadError.value = ''
  formHint.value = ''
  try {
    const hours = await resolveTtlHours()
    ttlHours.value = hours > 0 ? hours : 72
    permanentSel.value = false
    allowIndex.value = await resolveAppAllowIndex()
    const saved = readTicket()
    const savedAlive = saved !== null && (saved.expiresAt === SHARE_PERMANENT_EXPIRES_AT || saved.expiresAt > Date.now())
    let hit: ShareRouteInfo | null = null
    if (savedAlive) {
      try {
        const routes = await callHostApi<ShareRouteInfo[]>(SPEC.list, props.toolId)
        hit = routes.find((r) => r.id === saved!.id && (r.expiresAt === SHARE_PERMANENT_EXPIRES_AT || r.expiresAt > Date.now())) ?? null
      } catch { /* 校验接口失败时信任本地未过期记录（旧路由无 allowIndex 字段视为允许） */ }
    }
    if (savedAlive && saved) {
      ticket.value = saved
      activeUrlIndex.value = 0
      if (hit) allowIndex.value = hit.allowIndex !== false
      allowIndexEffective.value = allowIndex.value
      phase.value = 'ready'
      return
    }
    ticket.value = null
    saveTicket(null)
    phase.value = 'form'
  } catch (err) {
    loadError.value = (err as Error).message
    phase.value = 'error'
  }
}

function validateTtl(): boolean {
  if (permanentSel.value) return true
  if (!Number.isInteger(ttlHours.value) || ttlHours.value < 1) {
    ElMessage.warning('时长需为不小于 1 的整数小时（或勾选「永久有效」）')
    return false
  }
  return true
}

/** 创建分享（form 态唯一生效入口）：按当前设置创建路由并复制链接 */
async function createTicket(): Promise<void> {
  if (!validateTtl()) return
  busy.value = true
  try {
    const t = await callHostApi<ShareRouteTicket>(SPEC.create, {
      toolId: props.toolId,
      label: props.label,
      root: props.defaultRoot,
      entry: props.defaultEntry ?? '',
      ttlHours: permanentSel.value ? 0 : ttlHours.value,
      password: props.password,
      allowIndex: allowIndex.value,
    })
    ticket.value = t
    saveTicket(t)
    activeUrlIndex.value = 0
    formHint.value = ''
    allowIndexEffective.value = allowIndex.value
    phase.value = 'ready'
    if (t.urls[0]) await copyUrl(t.urls[0])
    ElMessage.success(permanentSel.value ? '永久分享已创建，链接已复制' : '分享已创建，链接已复制')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally { busy.value = false }
}

/** TTL 三操作统一入口（用户 2026-11-18 恢复上一版）：均复用 token，URL 不变；点按钮本身即确认生效 */
async function applyTtl(mode: 'extend' | 'reset' | 'permanent'): Promise<void> {
  if (!ticket.value) return
  const hours = mode === 'permanent' ? 0 : ttlHours.value
  if (mode !== 'permanent' && (!Number.isInteger(hours) || hours < 1)) {
    ElMessage.warning('时长需为不小于 1 的整数小时'); return
  }
  busy.value = true
  try {
    const next = await callHostApi<ShareRouteTicket>(SPEC.renew, ticket.value.id, hours, props.toolId, mode === 'reset' ? 'reset' : 'extend')
    ticket.value = next
    saveTicket(next)
    const msg = mode === 'permanent' ? '已设为永久有效，链接不变'
      : mode === 'extend' ? `已累加 ${hours} 小时，链接不变`
      : `已更新为 ${hours} 小时（从当前重新计时），链接不变`
    ElMessage.success(msg)
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

/** 目录开关变更（ready 态）：二次确认后 renew patch 只改属性不改有效期/token（链接与二维码不变），失败回滚勾选 */
async function onAllowIndexChange(next: boolean): Promise<void> {
  if (!ticket.value) return
  const current = allowIndexEffective.value
  if (next === current) return
  try {
    await ElMessageBox.confirm(
      next
        ? '开启后访客打开裸链接/目录路径时可以浏览文件列表。确认开启吗？'
        : '关闭后访客仅能访问具体文件链接，无法浏览目录列表。确认关闭吗？',
      '更改目录访问权限',
      {
        confirmButtonText: '确认更改', cancelButtonText: '取消', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch {
    allowIndex.value = current // 用户取消：恢复勾选为当前生效值
    return
  }
  busy.value = true
  try {
    const t = await callHostApi<ShareRouteTicket>(SPEC.renew, ticket.value.id, null, props.toolId, 'reset', { allowIndex: next })
    ticket.value = t
    allowIndex.value = next
    allowIndexEffective.value = next
    ElMessage.success(next ? '已允许访问目录（链接不变）' : '已禁止访问目录（链接不变）')
  } catch (err) {
    ElMessage.error((err as Error).message)
    allowIndex.value = current // 失败回滚勾选态
  } finally { busy.value = false }
}

async function copyUrl(url?: string): Promise<void> {
  const target = url ?? activeUrl.value
  if (!target) return
  try {
    await callHostApi({ group: 'os', method: 'clipboardWrite', channel: IPC_CHANNELS.osClipboardWrite, label: '写剪贴板' }, target)
  } catch { /* 剪贴板不可用时用户可点首行「复制」 */ }
}

/** 重新生成：二次确认后撤旧路由（立即失效）并按当前设置创建、复制新路由——确认即生效 */
async function regenerate(): Promise<void> {
  if (!ticket.value) return
  if (!Number.isInteger(ttlHours.value) || ttlHours.value < 1) {
    ElMessage.warning('时长需为不小于 1 的整数小时'); return
  }
  try {
    await ElMessageBox.confirm(
      `重新生成会让当前链接立即失效，并按当前设置（${ttlHours.value} 小时）创建、复制新链接。确认继续吗？`,
      '重新生成分享链接',
      {
        confirmButtonText: '确认重新生成', cancelButtonText: '取消', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch { return }
  busy.value = true
  try {
    await callHostApi(SPEC.revoke, ticket.value.id, props.toolId)
    ticket.value = null
    saveTicket(null)
    const t = await callHostApi<ShareRouteTicket>(SPEC.create, {
      toolId: props.toolId,
      label: props.label,
      root: props.defaultRoot,
      entry: props.defaultEntry ?? '',
      ttlHours: ttlHours.value,
      password: props.password,
      allowIndex: allowIndex.value,
    })
    ticket.value = t
    saveTicket(t)
    activeUrlIndex.value = 0
    if (t.urls[0]) await copyUrl(t.urls[0])
    ElMessage.success('新分享已创建，链接已复制（旧链接已失效）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

/** 撤销：二次确认后路由立即失效；弹框回统一创建态（可重新创建），不自动创建 */
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
    permanentSel.value = false
    phase.value = 'form'
    formHint.value = '（当前链接已撤销）'
    ElMessage.success('已撤销分享')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

function close(): void { emit('update:open', false) }

watch(() => props.open, (open) => {
  if (open) {
    ticket.value = null
    activeUrlIndex.value = 0
    void loadTicket()
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
      <!-- 读取现状 -->
      <div v-if="phase === 'loading'" v-loading="true" element-loading-text="正在读取分享状态…" class="share-loading" />

      <!-- 读取失败 -->
      <div v-else-if="phase === 'error'" class="share-loading">
        <p class="share-error">分享状态读取失败：{{ loadError }}，可点「重试」或关闭。</p>
      </div>

      <!-- 创建态（无票 / 撤销后统一回这里）：同一套设置行，点「创建分享」才生效 -->
      <template v-else-if="phase === 'form'">
        <p class="share-form-title">当前未创建分享链接{{ formHint }}。</p>
        <div class="share-form-tip">点「创建分享」后才会创建链接并自动复制；下方设置随创建生效。</div>
        <div class="share-ttl-row">
          <el-input-number v-model="ttlHours" :min="1" :precision="0" :step="1" size="small" class="ttl-input" :disabled="permanentSel" />
          <span class="ttl-unit">小时</span>
          <el-checkbox v-model="permanentSel" class="perm-check">永久有效</el-checkbox>
          <el-checkbox v-model="allowIndex" class="allow-index-check" title="允许访客打开裸链接/目录路径时浏览文件列表；关闭时仅具体文件链接可访问">允许访问目录</el-checkbox>
        </div>
      </template>

      <!-- 已有链接：TTL 三按钮 + 链接行（下拉+目录开关+复制）+ 二维码 + 剩余时间 -->
      <template v-else>
        <div class="share-ttl-row">
          <el-input-number v-model="ttlHours" :min="1" :precision="0" :step="1" size="small" class="ttl-input" />
          <span class="ttl-unit">小时</span>
          <el-button type="primary" size="small" :loading="busy" :disabled="permanent" @click="applyTtl('extend')">续期 TTL</el-button>
          <el-button type="warning" size="small" plain :loading="busy" @click="applyTtl('reset')">更新 TTL</el-button>
          <el-button type="success" size="small" plain :loading="busy" :disabled="permanent" @click="applyTtl('permanent')">永久有效</el-button>
        </div>
        <div class="share-link-head">
          <el-select v-if="(ticket?.urls.length ?? 0) > 1" :model-value="activeUrlIndex" size="small" @change="(v: number) => activeUrlIndex = v">
            <el-option v-for="(u, i) in ticket?.urls ?? []" :key="u" :label="u" :value="i" />
          </el-select>
          <el-checkbox
            v-model="allowIndex"
            :disabled="busy"
            class="allow-index-check"
            title="允许访客打开裸链接/目录路径时浏览文件列表；关闭时仅具体文件链接可访问"
            @change="(v: unknown) => onAllowIndexChange(v === true)"
          >允许访问目录</el-checkbox>
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
      <template v-if="phase === 'loading'">
        <el-button size="small" @click="close">关闭</el-button>
      </template>
      <template v-else-if="phase === 'error'">
        <el-button type="success" size="small" @click="loadTicket">重试</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
      <template v-else-if="phase === 'form'">
        <el-button type="primary" size="small" :loading="busy" @click="createTicket">创建分享</el-button>
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
.share-form-title { margin: 0 0 2px; line-height: 1.6; }
.share-form-tip { margin: 0 0 10px; font-size: 12px; opacity: 0.65; }
.allow-index-check { flex: none; height: auto; }
.allow-index-check :deep(.el-checkbox__label) { font-size: 12px; }
.perm-check { flex: none; height: auto; }
.perm-check :deep(.el-checkbox__label) { font-size: 12px; }
.share-link-head { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.share-link-head .el-select { flex: 1; min-width: 0; }
.share-link-head .el-button { flex: none; margin-left: auto; }
.share-ttl-row { display: flex; align-items: center; gap: 8px; }
.share-ttl-row .ttl-input { flex: 1; min-width: 0; }
.share-ttl-row .ttl-unit { flex: none; font-size: 12px; opacity: 0.7; }
.share-ttl-row .el-button { flex: none; }
.share-ttl-row .el-checkbox { flex: none; }
.share-qr-block { display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 14px; }
.share-qr { flex: none; width: 132px; height: 132px; border: 1px solid var(--el-border-color); border-radius: 6px; overflow: hidden; background: #fff; }
.share-qr :deep(svg) { width: 100%; height: 100%; display: block; }
.share-qr-tip { margin-top: 8px; max-width: 380px; }
.share-qr-tip p { margin: 0 0 4px; }
.share-expire-row { display: flex; justify-content: center; margin-top: 14px; }
.share-bottom-divider { margin: 14px 0 0; }
.muted { opacity: 0.6; font-size: 12px; }
</style>
