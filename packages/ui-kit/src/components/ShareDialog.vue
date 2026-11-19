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
import FormHint from './FormHint.vue'
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
const emit = defineEmits<{ 'update:open': [boolean]; /** 创建/重新生成/撤销等路由变更后通知宿主刷新列表状态（无需等弹框关闭） */ 'changed': [] }>()

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
/** 访问密钥 accessKey（accessKey）：form 态用户填写（留空 = 继承父级/不设）；ready 态为当前生效值，变更需二次确认。
 *  props.password 作为外部传入的初始值（工具页可预置），每次打开弹框时复位。 */
const accessKey = ref('')
const accessKeyEffective = ref('')
/** TTL 暂存（用户 2026-11-18 定版）：三按钮只选择「要做什么」，点「应用更改」才 renew 生效 */
const pendingTtl = ref<null | 'extend' | 'reset' | 'permanent'>(null)
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
    // 应用设置 defaultTtlHours：0 = 永久（内核既定语义），数字框直接显示 0，不强转
    ttlHours.value = await resolveTtlHours()
    permanentSel.value = false
    allowIndex.value = await resolveAppAllowIndex()
    accessKey.value = String(props.password ?? '')
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
      if (hit) {
        allowIndex.value = hit.allowIndex !== false
        accessKey.value = String(hit.password ?? '')
      }
      allowIndexEffective.value = allowIndex.value
      accessKeyEffective.value = accessKey.value
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
  if (permanentSel.value || ttlHours.value === 0) return true // 0 = 永久（内核既定语义）
  if (!Number.isInteger(ttlHours.value) || ttlHours.value < 0) {
    ElMessage.warning('时长需为不小于 0 的整数小时（0 = 永久有效）')
    return false
  }
  return true
}

/** 「永久有效」勾选与数字框联动：勾选 → 数字框归 0；取消勾选且为 0 → 回落 72 */
watch(permanentSel, (on) => {
  if (on) ttlHours.value = 0
  else if (ttlHours.value === 0) ttlHours.value = 72
})

/** 创建分享（form 态唯一生效入口）：按当前设置创建路由并复制链接；0 = 永久 */
async function createTicket(): Promise<void> {
  if (!validateTtl()) return
  const permanentCreate = permanentSel.value || ttlHours.value === 0
  busy.value = true
  try {
    const t = await callHostApi<ShareRouteTicket>(SPEC.create, {
      toolId: props.toolId,
      label: props.label,
      root: props.defaultRoot,
      entry: props.defaultEntry ?? '',
      ttlHours: permanentCreate ? 0 : ttlHours.value,
      password: accessKey.value,
      allowIndex: allowIndex.value,
    })
    ticket.value = t
    saveTicket(t)
    activeUrlIndex.value = 0
    formHint.value = ''
    allowIndexEffective.value = allowIndex.value
    accessKeyEffective.value = accessKey.value
    phase.value = 'ready'
    emit('changed')
    if (t.urls[0]) await copyUrl(t.urls[0])
    ElMessage.success(permanentCreate ? '永久分享已创建，链接已复制' : '分享已创建，链接已复制')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally { busy.value = false }
}

/** TTL 三按钮（用户 2026-11-18 恢复上一版界面）：点击只暂存选择，应用时才 renew（复用 token，URL 不变）；再点已选中的按钮 = 取消暂存；时长 0 = 永久 */
function stageTtl(mode: 'extend' | 'reset' | 'permanent'): void {
  if (pendingTtl.value === mode) { pendingTtl.value = null; return }
  if (mode !== 'permanent' && (!Number.isInteger(ttlHours.value) || ttlHours.value < 0)) {
    ElMessage.warning('时长需为不小于 0 的整数小时（0 = 永久有效）'); return
  }
  pendingTtl.value = mode
}

/** 暂存描述（实时取数字框当前值，应用时以此为准）；时长 0 = 永久 */
const pendingTtlText = computed(() => {
  const zero = ttlHours.value === 0
  switch (pendingTtl.value) {
    case 'extend': return permanent.value
      ? '当前已是永久有效，续期不会改变有效期'
      : zero ? '时长为 0，将设为永久有效' : `将在当前到期上累加 ${ttlHours.value} 小时`
    case 'reset': return zero ? '时长为 0，将设为永久有效' : `有效期将更新为 ${ttlHours.value} 小时（从当前重新计时）`
    case 'permanent': return permanent.value ? '当前已是永久有效' : '将设为永久有效'
    default: return ''
  }
})

/** 应用更改（ready 态唯一 TTL 生效入口）：按暂存项一次 renew；时长 0 = 永久 */
async function applyPendingTtl(): Promise<void> {
  const mode = pendingTtl.value
  if (!ticket.value || !mode || busy.value) return
  if (mode !== 'permanent' && (!Number.isInteger(ttlHours.value) || ttlHours.value < 0)) {
    ElMessage.warning('时长需为不小于 0 的整数小时（0 = 永久有效）'); return
  }
  busy.value = true
  try {
    const hours = mode === 'permanent' || ttlHours.value === 0 ? 0 : ttlHours.value
    const next = await callHostApi<ShareRouteTicket>(SPEC.renew, ticket.value.id, hours, props.toolId, mode === 'reset' ? 'reset' : 'extend')
    ticket.value = next
    saveTicket(next)
    pendingTtl.value = null
    const msg = hours === 0 ? '已设为永久有效，链接不变'
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

/** 访问密钥变更（ready 态）：二次确认后 renew patch 只改密钥不改有效期/token；URL 会变（?ak= 更新），需重新复制 */
async function applyAccessKey(): Promise<void> {
  if (!ticket.value || busy.value) return
  const next = String(accessKey.value ?? '')
  if (next === accessKeyEffective.value) { ElMessage.warning('访问密钥未变更'); return }
  const clearing = !next
  try {
    await ElMessageBox.confirm(
      clearing
        ? '清空访问密钥后，任何拿到链接的人都可访问（链接不再带 ?ak=）。确认清空吗？'
        : '更新访问密钥后，链接里的 ?ak= 会同步更新。此前已复制的旧链接将立即失效，需重新复制。确认更新吗？',
      '更改访问密钥',
      {
        confirmButtonText: '确认更改', cancelButtonText: '取消', type: clearing ? 'warning' : 'info',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch { return }
  busy.value = true
  try {
    const t = await callHostApi<ShareRouteTicket>(SPEC.renew, ticket.value.id, null, props.toolId, 'reset', { password: next })
    ticket.value = t
    saveTicket(t)
    accessKeyEffective.value = next
    activeUrlIndex.value = 0
    await copyUrl(t.urls[0])
    ElMessage.success(clearing ? '已清空访问密钥，新链接已复制' : '访问密钥已更新，新链接已复制（旧链接已失效）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

/** 写剪贴板：成功 true / 失败 false（创建、重新生成的静默复制不弹反馈，按钮路径由 copyActive 提示） */
async function copyUrl(url?: string): Promise<boolean> {
  const target = url ?? activeUrl.value
  if (!target) return false
  try {
    await callHostApi({ group: 'os', method: 'clipboardWrite', channel: IPC_CHANNELS.osClipboardWrite, label: '写剪贴板' }, target)
    return true
  } catch { return false /* 剪贴板不可用时由调用方提示 */ }
}

/** 链接行「复制」按钮：写剪贴板并给出成功/失败反馈（创建/重新生成的静默复制不带此提示，避免双 toast） */
async function copyActive(): Promise<void> {
  const ok = await copyUrl()
  if (ok) ElMessage.success('链接已复制到剪贴板')
  else ElMessage.error('复制失败：剪贴板不可用，可手动选中链接复制')
}

/** 重新生成：二次确认后撤旧路由（立即失效）并按当前设置创建、复制新路由——确认即生效；
 *  暂存了「永久有效」或时长为 0（0 = 永久，内核既定语义）则按永久生成，否则按数字框时长 */
async function regenerate(): Promise<void> {
  if (!ticket.value) return
  const regenPermanent = pendingTtl.value === 'permanent' || ttlHours.value === 0
  if (!regenPermanent && (!Number.isInteger(ttlHours.value) || ttlHours.value < 0)) {
    ElMessage.warning('时长需为不小于 0 的整数小时（0 = 永久有效）'); return
  }
  const regenText = regenPermanent ? '永久有效' : `${ttlHours.value} 小时`
  try {
    await ElMessageBox.confirm(
      `重新生成会让当前链接立即失效，并按当前设置（${regenText}）创建、复制新链接。确认继续吗？`,
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
      ttlHours: regenPermanent ? 0 : ttlHours.value,
      password: accessKey.value,
      allowIndex: allowIndex.value,
    })
    ticket.value = t
    saveTicket(t)
    accessKeyEffective.value = accessKey.value
    activeUrlIndex.value = 0
    pendingTtl.value = null
    emit('changed')
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
    pendingTtl.value = null
    phase.value = 'form'
    formHint.value = '（当前链接已撤销）'
    emit('changed')
    ElMessage.success('已撤销分享')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { busy.value = false }
}

function close(): void { emit('update:open', false) }

watch(() => props.open, (open) => {
  if (open) {
    ticket.value = null
    activeUrlIndex.value = 0
    pendingTtl.value = null
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
    :width="phase === 'form' ? '460px' : '560px'"
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

      <!-- 创建态（无票 / 撤销后统一回这里）：居中卡片式设置，点「创建分享」才生效 -->
      <template v-else-if="phase === 'form'">
        <div class="share-form">
          <div class="form-hero">
            <div class="hero-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" />
              </svg>
            </div>
            <p class="hero-title">{{ formHint ? '分享链接已撤销' : '还没有分享链接' }}</p>
            <p class="hero-sub">确认下方设置后点「创建分享」，创建成功会自动复制链接。</p>
          </div>
          <div class="form-card">
            <div class="form-row">
              <span class="row-label">有效期</span>
              <el-input-number v-model="ttlHours" :min="0" :precision="0" :step="1" size="small" class="ttl-num" :disabled="permanentSel" />
              <span class="row-unit">小时（0 = 永久）</span>
              <el-checkbox v-model="permanentSel" class="row-check">永久有效</el-checkbox>
            </div>
            <el-divider class="card-divider" />
            <div class="form-row">
              <span class="row-label">访问密钥</span>
              <el-input v-model="accessKey" size="small" show-password clearable class="ak-input" placeholder="留空 = 继承父级" />
              <FormHint
                inline
                detail="填写后链接形如 …/?ak=访问密钥，访客需链接带正确的 ak 才能访问；留空则继承同目录下最近父级分享的密钥（无父级则不设）。浏览目录、切换文件时密钥随链接一路透传，每一请求都会校验。"
              >密钥说明</FormHint>
            </div>
            <el-divider class="card-divider" />
            <div class="form-row">
              <span class="row-label">目录访问</span>
              <el-checkbox v-model="allowIndex" class="row-check">允许访问目录</el-checkbox>
              <FormHint
                inline
                detail="勾选后本链接即目录树入口：访客可浏览目录，点进子目录/文件都复用这条链接（整棵子树通用），新增文件也立即可见；不勾选则仅该目录本身可访问。目录里的任意子项也可单独点「分享链接」生成独立链接（独立有效期、可单独撤销）。默认取应用设置，可自行勾选，创建后仍可更改。"
              >目录树链接说明</FormHint>
            </div>
          </div>
        </div>
      </template>

      <!-- 已有链接：TTL 三按钮（暂存选择）+ 链接行（下拉+目录开关+复制）+ 二维码 + 剩余时间 -->
      <template v-else>
        <div class="share-ttl-row">
          <el-input-number v-model="ttlHours" :min="0" :precision="0" :step="1" size="small" class="ttl-input" />
          <span class="ttl-unit">小时（0 = 永久）</span>
          <!-- 三按钮只暂存选择（选中变实心高亮），点「应用更改」才生效；permanent 下三按钮均可选（续期对永久是安全 no-op） -->
          <el-button type="primary" size="small" :plain="pendingTtl !== 'extend'" :loading="busy" @click="stageTtl('extend')">续期 TTL</el-button>
          <el-button type="warning" size="small" :plain="pendingTtl !== 'reset'" :loading="busy" @click="stageTtl('reset')">更新 TTL</el-button>
          <el-button type="success" size="small" :plain="pendingTtl !== 'permanent'" :loading="busy" @click="stageTtl('permanent')">永久有效</el-button>
        </div>
        <div v-if="pendingTtl" class="pending-tip-row">
          <span class="dirty-tip">{{ pendingTtlText }}，点「应用更改」后生效（链接不变）。</span>
        </div>
        <div class="share-ak-row">
          <span class="ak-label">访问密钥</span>
          <el-input v-model="accessKey" size="small" show-password clearable class="ak-input" placeholder="未设置（链接不含 ak）" />
          <el-button
            type="warning" size="small" plain :loading="busy"
            :disabled="accessKey === accessKeyEffective"
            @click="applyAccessKey"
          >更新密钥</el-button>
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
          <el-button type="success" size="small" :disabled="!activeUrl" @click="copyActive">复制</el-button>
        </div>
        <div class="share-qr-block">
          <img v-if="qrDataUrl" class="share-qr" :src="qrDataUrl" alt="分享二维码" />
          <div class="share-qr-tip">
            <p>手机扫码直达</p>
            <p class="muted">链接含 96bit 随机 token{{ accessKeyEffective ? ' 与访问密钥 ak' : '' }}，仅限可信局域网访问。</p>
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
        <el-button type="primary" size="small" :loading="busy" :disabled="!pendingTtl" @click="applyPendingTtl">应用更改</el-button>
        <el-button size="small" @click="close">关闭</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.share-dialog { min-height: 340px; display: flex; flex-direction: column; }
.share-loading { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 340px; text-align: center; }
.share-error { margin: 0 16px; color: var(--el-color-danger); line-height: 1.6; }

/* ── 创建态：居中 hero + 设置卡片，紧凑不空旷 ── */
.share-form { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 18px; padding: 0 8px; }
.form-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding-top: 6px; }
.hero-badge {
  flex: none; width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  margin-bottom: 4px;
}
.hero-badge svg { width: 24px; height: 24px; }
.hero-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.hero-sub { margin: 0; font-size: 12px; opacity: 0.65; line-height: 1.5; }
.form-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  padding: 4px 16px;
}
.form-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
.form-row .row-label { flex: none; width: 56px; font-size: 13px; opacity: 0.75; }
.form-row .ttl-num { flex: none; width: 130px; }
.form-row .row-unit { flex: none; font-size: 12px; opacity: 0.7; }
.form-row .row-check { flex: none; height: auto; }
.form-row .row-check :deep(.el-checkbox__label) { font-size: 12px; }
.form-row .sshk-form-hint { flex: 1; min-width: 0; }
.form-row .ak-input { flex: 1; min-width: 0; }
.card-divider { margin: 0; }

/* ── 已有链接态 ── */
.dirty-tip { color: var(--el-color-warning); opacity: 1; font-size: 12px; }
.pending-tip-row { margin-top: 8px; font-size: 12px; opacity: 0.9; }
.allow-index-check { flex: none; height: auto; }
.allow-index-check :deep(.el-checkbox__label) { font-size: 12px; }
.share-link-head { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.share-link-head .el-select { flex: 1; min-width: 0; }
.share-link-head .el-button { flex: none; margin-left: auto; }
.share-ak-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.share-ak-row .ak-label { flex: none; width: 56px; font-size: 13px; opacity: 0.75; }
.share-ak-row .ak-input { flex: 1; min-width: 0; }
.share-ak-row .el-button { flex: none; margin-left: 0; }
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
