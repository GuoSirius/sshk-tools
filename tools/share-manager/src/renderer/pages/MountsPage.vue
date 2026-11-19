<script setup lang="ts">
/**
 * 分享管理 · 挂载管理页（plans/12 §8.4，从应用设置迁入）。
 * 三行卡片：目录/选择/允许索引 · 挂载点/访问密钥/启用 · 地址/复制/删除。保存即生效（同键 app.shareHub.mounts）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, CopyDocument } from '@element-plus/icons-vue'
import type { HubStatus, ShareHubMount } from '@sshk/shared'
import { host } from '../host'

interface MountRow { id: string; dir: string; alias: string; enabled: boolean; allowIndex: boolean; password: string }

const status = ref<HubStatus | null>(null)
const mounts = ref<MountRow[]>([])
const saving = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const savedMounts = ref<ShareHubMount[]>([])

function normAlias(raw: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[a-z0-9][a-z0-9-_]{0,31}$/.test(s) ? s : ''
}
function randomAlias(): string {
  return `dir-${Math.random().toString(36).slice(2, 8)}`
}
function addMount(): void {
  mounts.value.push({ id: window.crypto.randomUUID(), dir: '', alias: randomAlias(), enabled: true, allowIndex: true, password: '' })
}
async function pickMountDir(row: MountRow): Promise<void> {
  try {
    const dir = await host.os.pickDir(row.dir ? { defaultPath: row.dir } : undefined)
    if (dir) row.dir = dir
  } catch { /* 取消/失败保持原值 */ }
}
async function removeMount(index: number): Promise<void> {
  const row = mounts.value[index]
  if (!row) return
  const saved = savedMounts.value.some((m) => m.id === row.id)
  if (saved) {
    try {
      await ElMessageBox.confirm(`移除挂载「${row.alias || row.dir || '未命名'}」？保存后该目录的分享链接将立即失效。`, '移除挂载目录', {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留',
      })
    } catch { return }
  }
  mounts.value.splice(index, 1)
}
function mountLink(row: MountRow): string {
  const s = status.value
  if (!s?.running || !s.port || !row.alias) return ''
  const ak = row.password ? `?ak=${encodeURIComponent(row.password)}` : ''
  return `http://${s.displayIp}:${s.port}/${row.alias}/${ak}`
}
async function copyMountLink(row: MountRow): Promise<void> {
  const url = mountLink(row)
  if (!url) return
  try { await host.os.clipboardWrite(url); ElMessage.success('访问地址已复制') } catch (err) { ElMessage.error((err as Error).message) }
}
async function refresh(): Promise<void> {
  try { status.value = await host.shareHub.status() } catch { /* 静默 */ }
}
/** 保存后服务未运行的生效确认（原 ShareTab 语义） */
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
async function saveMounts(): Promise<void> {
  const seen = new Set<string>()
  const rows: ShareHubMount[] = []
  for (const row of mounts.value) {
    if (!row.dir.trim()) { ElMessage.warning('存在未选择目录的挂载卡片，请补全或删除'); return }
    const alias = normAlias(row.alias) || randomAlias()
    if (seen.has(alias)) { ElMessage.error(`挂载点「${alias}」重复，请修改`); return }
    seen.add(alias)
    row.alias = alias
    rows.push({ id: row.id, dir: row.dir.trim(), alias, enabled: row.enabled === true, allowIndex: row.allowIndex !== false, password: String(row.password ?? '') })
  }
  saving.value = true
  try {
    await host.config.set('app.shareHub.mounts', rows)
    savedMounts.value = rows.map((r) => ({ ...r }))
    await askStartAfterSave('挂载目录')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

onMounted(async () => {
  try {
    const arr = (await host.config.get('app.shareHub.mounts')) as ShareHubMount[] | null
    savedMounts.value = Array.isArray(arr) ? arr : []
    mounts.value = savedMounts.value.map((m) => ({ id: m.id, dir: m.dir, alias: m.alias, enabled: m.enabled, allowIndex: m.allowIndex !== false, password: String(m.password ?? '') }))
  } catch { /* 静默 */ }
  void refresh()
  timer = setInterval(() => { void refresh() }, 3000)
})
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })
</script>

<template>
  <div class="page-wrap">
    <div class="toolbar">
      <el-tag size="small" type="info" class="mini-tag">{{ mounts.length }} 个</el-tag>
      <span class="hint">每个目录一条固定链接；保存即生效。挂载点留空保存时随机生成并记住；填访问密钥后链接自动带 ?ak=。</span>
    </div>
    <div v-for="(row, i) in mounts" :key="row.id" class="mount-card">
      <div class="m-line1">
        <el-input :model-value="row.dir" readonly size="small" placeholder="未选择目录" class="grow" />
        <el-button size="small" type="primary" plain @click="pickMountDir(row)">选择目录</el-button>
        <el-checkbox v-model="row.allowIndex" size="small">允许访问目录</el-checkbox>
      </div>
      <div class="m-line2">
        <el-input v-model="row.alias" size="small" placeholder="挂载点" class="grow" @blur="row.alias = normAlias(row.alias) || row.alias">
          <template #prepend>/</template>
        </el-input>
        <el-input v-model="row.password" size="small" show-password clearable class="grow" placeholder="访问密钥 ak（留空不设）">
          <template #prepend>ak</template>
        </el-input>
        <span class="inline-label">启用</span>
        <el-switch v-model="row.enabled" />
      </div>
      <div class="m-line3">
        <el-input :model-value="mountLink(row)" readonly size="small" class="grow wider" placeholder="（服务未运行）" />
        <el-button size="small" text type="primary" :icon="CopyDocument" :disabled="!mountLink(row)" @click="copyMountLink(row)">复制</el-button>
        <el-button size="small" text type="danger" :icon="Delete" @click="removeMount(i)">删除</el-button>
      </div>
    </div>
    <div v-if="!mounts.length" class="hint">还没有挂载目录，点「添加目录」开始。</div>
    <div class="actions">
      <el-button size="small" type="success" plain @click="addMount">添加目录</el-button>
      <el-button size="small" type="primary" :loading="saving" @click="saveMounts">保存挂载目录</el-button>
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
.grow { flex: 1; min-width: 140px; }
.wider { min-width: 200px; }
.inline-label { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.mini-tag { height: 18px; padding: 0 5px; font-size: 11px; }
</style>
