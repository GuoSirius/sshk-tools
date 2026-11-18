<script setup lang="ts">
/**
 * 应用设置 · 分享服务 tab（plans/09）。
 * 服务状态 / 基础设置 / 路由管理 / 访问日志。分享本体在主进程 ShareHub 单例，
 * 本组件只做状态展示与生命周期控制，配置走共享 appConfig composable。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { IPC_CHANNELS, SHARE_PERMANENT_EXPIRES_AT, type ShareHubMount } from '@sshk/shared'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { appConfig, saveAppConfig } from '../../composables/useAppConfig'

type ShareStatus = import('@sshk/shared').HubStatus
type ShareRoute = import('@sshk/shared').ShareRouteInfo
type ShareIp = import('@sshk/shared').ShareIpInfo

const SHARE_SPECS = {
  status: { group: 'shareHub', method: 'status', channel: IPC_CHANNELS.shareHubStatus, label: '分享服务状态' },
  revoke: { group: 'shareHub', method: 'revoke', channel: IPC_CHANNELS.shareHubRevoke, label: '撤销分享路由' },
  renew: { group: 'shareHub', method: 'renew', channel: IPC_CHANNELS.shareHubRenew, label: '续期分享路由' },
} satisfies Record<string, HostApiSpec>
function controlSpec(action: 'start' | 'restart' | 'stop' | 'clear'): HostApiSpec {
  return { group: 'shareHubControl', method: action, channel: IPC_CHANNELS.shareHubControl, label: `分享服务${action}` }
}

const shareStatus = ref<ShareStatus | null>(null)
const shareRoutes = ref<ShareRoute[]>([])
const shareRouteFilter = ref('')
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

const filteredRoutes = computed(() => {
  const rows = shareRoutes.value
  const f = shareRouteFilter.value.trim()
  return f ? rows.filter((r) => r.toolId.includes(f) || r.label.includes(f)) : rows
})

async function refreshShare(): Promise<void> {
  try {
    shareStatus.value = await callHostApi<ShareStatus>(SHARE_SPECS.status)
    shareRoutes.value = shareStatus.value.routes
  } catch { /* 宿主能力未就绪时静默 */ }
}
function ttlLeft(expiresAt: number): string {
  if (expiresAt === SHARE_PERMANENT_EXPIRES_AT) return '永久'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return '已过期'
  const h = Math.floor(ms / 3600_000)
  const m = Math.max(1, Math.floor((ms % 3600_000) / 60000))
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
  const labels: Record<typeof action, string> = { start: '启动', restart: '重启', stop: '停止', clear: '停止并清空' }
  if (action === 'clear') {
    try {
      await ElMessageBox.confirm('停止服务并清空全部分享路由？所有已发链接将永久失效，状态文件会被删除。', '危险操作', {
        type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消',
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
async function revokeRoute(row: ShareRoute): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认撤销「${row.label}」的分享路由？该链接会立即失效且不可恢复。`,
      '撤销分享路由',
      {
        type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消',
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
  } catch { return }
  try {
    const ok = await callHostApi<boolean>(SHARE_SPECS.revoke, row.id, '*')
    if (ok) { ElMessage.success('已撤销'); await refreshShare() }
    else ElMessage.warning('路由已不存在')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function renewRoute(row: ShareRoute): Promise<void> {
  const raw = Number(appConfig.shareDefaultTtlHours)
  const hours = Number.isInteger(raw) && raw >= 0 ? raw : 72 // 0=永久
  try {
    await callHostApi(SHARE_SPECS.renew, row.id, hours, '*', 'reset')
    ElMessage.success(hours === 0 ? '已设为永久有效' : `已更新为 ${hours} 小时（从当前重新计时）`)
    await refreshShare()
  } catch (err) { ElMessage.error((err as Error).message) }
}
function logTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
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
    ElMessage.success('分享设置已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

// ── 挂载目录（多目录分享，用户 2026-11-18 定版）──
// 一行一个：目录（选择）+ 别名（新增自动生成可改，留空保存时随机生成并持久化）
// + 复选（是否允许访问）+ 只读链接 + 删除；保存即生效，无需重启
interface MountRow { id: string; dir: string; alias: string; enabled: boolean }
const mounts = ref<MountRow[]>([])
const mountsSaving = ref(false)
/** 别名规范化：与内核 normalizeMountAlias 同规则（渲染层不能 import node 依赖包，规则真相源在内核） */
function normAlias(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}
/** 随机别名 dir-xxxxxx（新增行自动生成；留空保存时随机生成后写回并持久化，避免每次不一样） */
function randomAlias(): string {
  return `dir-${Math.random().toString(36).slice(2, 8)}`
}
function addMount(): void {
  mounts.value.push({ id: window.crypto.randomUUID(), dir: '', alias: randomAlias(), enabled: true })
}
async function pickMountDir(row: MountRow): Promise<void> {
  try {
    const dir = await window.api.os.pickDir(row.dir ? { defaultPath: row.dir } : undefined)
    if (dir) row.dir = dir
  } catch { /* 用户取消或选目录失败，保持原值 */ }
}
async function removeMount(index: number): Promise<void> {
  const row = mounts.value[index]
  if (!row) return
  // 已保存过的行删除保存后链接即失效——按危险操作约定二次确认（禁遮罩禁 ESC）
  const saved = appConfig.shareMounts.some((m) => m.id === row.id)
  if (saved) {
    try {
      await ElMessageBox.confirm(
        `移除挂载「${row.alias || row.dir || '未命名'}」？保存后该目录的分享链接将立即失效。`,
        '移除挂载目录',
        { type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留' },
      )
    } catch { return }
  }
  mounts.value.splice(index, 1)
}
/** 只读链接展示：服务运行中拼 displayIp+端口；未运行给空占位 */
function mountLink(row: MountRow): string {
  const s = shareStatus.value
  if (!s?.running || !s.port || !row.alias) return ''
  return `http://${s.displayIp}:${s.port}/${row.alias}/`
}
async function saveMounts(): Promise<void> {
  // 校验 + 规范化；空别名随机生成并写回（用户要求：随机值要持久化记住，不能每次变）
  const seen = new Set<string>()
  const rows: ShareHubMount[] = []
  for (const row of mounts.value) {
    if (!row.dir.trim()) { ElMessage.warning('存在未选择目录的挂载行，请补全或删除该行'); return }
    const alias = normAlias(row.alias) || randomAlias()
    if (seen.has(alias)) { ElMessage.error(`别名「${alias}」重复，请修改`); return }
    seen.add(alias)
    row.alias = alias
    rows.push({ id: row.id, dir: row.dir.trim(), alias, enabled: row.enabled === true })
  }
  mountsSaving.value = true
  try {
    await window.api.config.set('app.shareHub.mounts', rows)
    appConfig.shareMounts = rows.map((r) => ({ ...r }))
    await refreshShare()
    if (!shareStatus.value?.running) {
      // 服务未运行：挂载已保存但不可访问——询问是否立即启动（用户 2026-11-18：需生效确认）
      try {
        await ElMessageBox.confirm('挂载目录已保存。分享服务当前未运行，是否立即启动使链接可访问？', '保存成功', {
          type: 'info', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
          confirmButtonText: '启动服务', cancelButtonText: '暂不启动',
        })
        await shareControl('start')
      } catch { /* 暂不启动 */ }
    } else {
      ElMessage.success('挂载目录已保存并即时生效')
    }
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { mountsSaving.value = false }
}

onMounted(() => {
  // 挂载目录编辑态：从已保存配置拷贝（保存成功前不影响权威配置）
  mounts.value = appConfig.shareMounts.map((m) => ({ id: m.id, dir: m.dir, alias: m.alias, enabled: m.enabled }))
  void refreshShare()
  // 组件仅在激活时挂载：定时器跟随生命周期，持续刷新路由状态/访问日志/倒计时
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
        <el-button type="danger" size="small" :loading="shareBusy" @click="shareControl('clear')">停止并清空</el-button>
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

    <!-- 挂载目录（多目录分享，用户 2026-11-18 定版）：一行一个 -->
    <section class="settings-card">
      <div class="card-title">挂载目录 <el-tag size="small" type="info" class="mini-tag">{{ mounts.length }} 个</el-tag></div>
      <div class="hint" style="margin-bottom: 10px">
        每个目录一条固定链接（http://IP:端口/别名/），可放下载文件、预览文件或 HTML 页面；保存即生效，无需重启。别名留空保存时随机生成并记住。
      </div>
      <div v-for="(row, i) in mounts" :key="row.id" class="mount-row">
        <el-input :model-value="row.dir" readonly size="small" placeholder="未选择目录" class="mount-dir" />
        <el-button size="small" type="primary" plain @click="pickMountDir(row)">选择…</el-button>
        <el-input v-model="row.alias" size="small" placeholder="别名" class="mount-alias" @blur="row.alias = normAlias(row.alias) || row.alias">
          <template #prepend>/</template>
        </el-input>
        <el-checkbox v-model="row.enabled" size="small">允许访问</el-checkbox>
        <el-input :model-value="mountLink(row)" readonly size="small" class="mount-link" placeholder="（服务未运行）" />
        <el-button size="small" text type="danger" :icon="Delete" title="移除该挂载目录" @click="removeMount(i)" />
      </div>
      <div v-if="!mounts.length" class="hint">还没有挂载目录，点「添加目录」开始。</div>
      <div class="card-actions share-actions">
        <el-button size="small" type="success" plain @click="addMount">添加目录</el-button>
        <el-button size="small" type="primary" :loading="mountsSaving" @click="saveMounts">保存挂载目录</el-button>
      </div>
    </section>

    <!-- 路由管理 -->
    <section class="settings-card">
      <div class="card-title">路由管理 <el-tag size="small" type="info" class="mini-tag">{{ shareRoutes.length }} 条</el-tag></div>
      <div class="share-route-filter">
        <el-input v-model="shareRouteFilter" clearable placeholder="按工具 / 标签过滤" size="small" />
      </div>
      <el-table :data="filteredRoutes" size="small" max-height="280" empty-text="暂无分享路由">
        <el-table-column type="index" label="序号" width="60" align="center" fixed="left" />
        <el-table-column prop="toolId" label="工具" width="120" show-overflow-tooltip />
        <el-table-column prop="label" label="标签" min-width="120" show-overflow-tooltip />
        <el-table-column label="剩余" width="76">
          <template #default="{ row }">
            <el-tag v-if="row.expiresAt === SHARE_PERMANENT_EXPIRES_AT" type="warning" size="small" effect="plain" class="mini-tag">永久</el-tag>
            <span v-else :class="{ 'expired-text': row.expiresAt <= Date.now() }">{{ ttlLeft(row.expiresAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="hits" label="访问数" width="70" />
        <el-table-column label="操作" width="86" align="center" fixed="right">
          <template #default="{ row }">
            <div class="route-op-row">
              <el-button size="small" text type="primary" @click="renewRoute(row)">续期</el-button>
              <el-button size="small" text type="danger" @click="revokeRoute(row)">撤销</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 访问日志 -->
    <section class="settings-card">
      <div class="card-title">访问日志 <span class="muted">（最近 {{ shareStatus?.logs.length ?? 0 }} 条）</span></div>
      <el-table :data="shareStatus?.logs ?? []" size="small" max-height="240" empty-text="暂无访问记录">
        <el-table-column type="index" label="序号" width="60" align="center" fixed="left" />
        <el-table-column label="时间" width="90">
          <template #default="{ row }">{{ logTime(row.at) }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="来源 IP" width="150" show-overflow-tooltip />
        <el-table-column prop="path" label="路径" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="70">
          <template #default="{ row }">
            <span :style="{ color: row.status >= 200 && row.status < 400 ? 'var(--el-color-success)' : 'var(--el-color-danger)' }">{{ row.status }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
/* 根容器 .share-tab 的多卡片间距在 theme.css 全局统一（.tools-tab 等同规则） */
.share-status-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.share-actions { justify-content: flex-start; gap: 12px; align-items: center; flex-wrap: wrap; }
.autostart-row { margin-right: auto; }
.allow-index-row { margin-right: auto; }
/* 行内双按钮：flex 收紧间距防换行（el-button 默认 margin-left 12px 会挤爆窄列），padding 同步收紧 */
.route-op-row { display: inline-flex; align-items: center; gap: 2px; }
.route-op-row .el-button+.el-button { margin-left: 0; }
.route-op-row :deep(.el-button) { padding: 3px 5px; font-size: 12px; }
/* 迷你 tag：高度/内边距收紧（用户 2026-11-18：剩余列 tag 也可以小一点） */
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
.share-ip-row { display: flex; align-items: center; gap: 8px; width: 100%; }
:deep(.ip-invalid .el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.hint-error { color: var(--el-color-danger); }
.share-route-filter { margin-bottom: 10px; }
.expired-text { color: var(--el-color-danger); }
/* 挂载目录行：一行一个（用户 2026-11-18 定版）——目录+选择+别名+复选+只读链接+删除 */
.mount-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mount-dir { width: 200px; }
.mount-alias { width: 160px; }
.mount-link { flex: 1; min-width: 180px; }
.mount-row :deep(.el-checkbox) { margin-right: 0; white-space: nowrap; }
</style>
