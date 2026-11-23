<script setup lang="ts">
/**
 * 系统与数据 · 回滚快照卡（P4-3 从 SystemTab 拆入）：
 * 输出快照开关（app.outputSnapshot，独立保存不走 saveAppConfig）/ 快照列表恢复（覆盖前二次确认）/ 清空（二次确认）。
 */
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IPC_CHANNELS } from '@sshk/shared'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'
import { appConfig } from '@renderer/composables/useAppConfig'

const SNAPSHOT_LIST_SPEC: HostApiSpec = { group: 'snapshots', method: 'list', channel: IPC_CHANNELS.snapshotList, label: '回滚快照' }
const SNAPSHOT_RESTORE_SPEC: HostApiSpec = { group: 'snapshots', method: 'restore', channel: IPC_CHANNELS.snapshotRestore, label: '快照恢复' }
const SNAPSHOT_CLEAR_SPEC: HostApiSpec = { group: 'snapshots', method: 'clear', channel: IPC_CHANNELS.snapshotClear, label: '快照清空' }
type SnapshotEntry = import('@sshk/repository').OutputSnapshotEntry

const snapshots = ref<SnapshotEntry[]>([])
const snapshotTime = (iso: string): string => String(iso ?? '').slice(0, 19).replace('T', ' ')
async function refreshSnapshots(): Promise<void> {
  try { snapshots.value = await callHostApi<SnapshotEntry[]>(SNAPSHOT_LIST_SPEC) } catch { /* 保持空 */ }
}
async function saveSnapshotSwitch(): Promise<void> {
  try {
    await window.api.config.set('app.outputSnapshot', appConfig.outputSnapshot)
    ElMessage.success(appConfig.outputSnapshot ? '回滚快照已开启（重新生成产物时生效）' : '回滚快照已关闭')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function restoreSnapshotEntry(entry: SnapshotEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`把「${entry.rel}」恢复为快照时的旧版本？当前文件将被覆盖。`, '恢复快照', { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
  } catch { return }
  try {
    const path = await callHostApi<string>(SNAPSHOT_RESTORE_SPEC, entry.id)
    ElMessage.success(`已恢复：${path}`)
  } catch (err) { ElMessage.error(`恢复失败：${(err as Error).message}`) }
}
async function clearSnapshotAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空全部回滚快照？被覆盖的旧产物将无法再恢复。', '清空快照', { type: 'warning', closeOnClickModal: false, closeOnPressEscape: false })
  } catch { return }
  try {
    const { removed } = await callHostApi<{ removed: number }>(SNAPSHOT_CLEAR_SPEC)
    ElMessage.success(`已清空 ${removed} 份快照`)
    await refreshSnapshots()
  } catch (err) { ElMessage.error(`清空失败：${(err as Error).message}`) }
}

onMounted(() => { void refreshSnapshots() })
</script>

<template>
  <section class="settings-card">
    <div class="card-title">
      回滚快照
      <el-switch v-model="appConfig.outputSnapshot" size="small" @change="saveSnapshotSwitch" />
    </div>
    <div class="hint">开启后（默认关，D19 覆盖行为不变）：badge / EDM 重新生成产物前自动把旧文件留一份快照（每文件最近 1 份，总量上限 50MB 自动清最旧）。恢复会覆盖当前产物。</div>
    <div v-for="s in snapshots" :key="s.id" class="kv-line">
      <span class="snap-name">{{ s.toolId }} · {{ s.rel }}</span>
      <span class="hint">{{ (s.sizeBytes / 1024).toFixed(1) }} KB · {{ snapshotTime(s.time) }}</span>
      <el-button size="small" text type="primary" @click="restoreSnapshotEntry(s)">恢复</el-button>
    </div>
    <div v-if="snapshots.length === 0" class="kv-line"><span class="hint">暂无快照（开启开关后重新生成产物即产生）</span></div>
    <div v-if="snapshots.length" class="card-actions">
      <el-button size="small" type="danger" plain @click="clearSnapshotAll">清空快照</el-button>
    </div>
  </section>
</template>
