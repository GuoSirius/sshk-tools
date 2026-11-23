<script setup lang="ts">
/**
 * 系统与数据 · 更新卡（P4-3 从 SystemTab 拆入）：
 * 当前版本 / 更新状态（useUpdater 单例，与顶栏胶囊、横幅同源）/ 检查更新 / 立即安装。
 * 禁用态（SSHK_APP_AUTO_UPDATE=0）与 dev 态文案语义不变。
 */
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useUpdater } from '@renderer/composables/useUpdater'

const props = defineProps<{ version: string }>()

const { state: updaterState } = useUpdater()

const updateTagType = computed(() => {
  switch (updaterState.value.phase) {
    case 'downloaded': return 'success'
    case 'available':
    case 'downloading': return 'warning'
    case 'error': return 'danger'
    default: return 'info'
  }
})
const updateStatusText = computed(() => {
  switch (updaterState.value.phase) {
    case 'idle':
    case 'not-available': return '已是最新'
    case 'checking': return '检查中…'
    case 'available': return '有新版本'
    case 'downloading': return '下载中'
    case 'downloaded': return '待安装'
    case 'error': return '检查失败'
    case 'dev': return '开发版本'
    case 'disabled': return '已禁用'
    default: return '未知'
  }
})
async function checkUpdate(): Promise<void> {
  if (updaterState.value.phase === 'checking' || updaterState.value.phase === 'downloading' || updaterState.value.phase === 'available') return
  const result = await window.api.update.check().catch(() => ({}) as { disabled?: boolean; dev?: boolean; updateAvailable?: boolean; version?: string | null; error?: string })
  if (result.disabled) ElMessage.info('自动更新已禁用（SSHK_APP_AUTO_UPDATE=0）')
  else if (result.dev) ElMessage.info('开发环境不检查更新')
  else if (result.error) ElMessage.error('检查更新失败：' + String(result.error))
  else if (result.updateAvailable) ElMessage.success(`发现新版本 ${String(result.version ?? '')}，已开始下载`)
  else ElMessage.success('当前已是最新版本')
}
async function installUpdate(): Promise<void> {
  await window.api.update.quitAndInstall().catch((err: unknown) => { ElMessage.error('安装失败：' + (err as Error).message) })
}
</script>

<template>
  <section class="settings-card">
    <div class="card-title">更新</div>
    <div class="kv-line"><span>当前版本</span><strong>v{{ props.version }}</strong></div>
    <div class="kv-line">
      <span>更新状态</span>
      <el-tag size="small" :type="updateTagType">{{ updateStatusText }}</el-tag>
      <span v-if="updaterState.phase === 'downloading'" class="hint">下载中 {{ updaterState.percent }}%</span>
    </div>
    <el-progress v-if="updaterState.phase === 'downloading'" :percentage="updaterState.percent ?? 0" :stroke-width="8" style="margin: 6px 0 10px" />
    <div v-if="updaterState.version && (updaterState.phase === 'available' || updaterState.phase === 'downloading' || updaterState.phase === 'downloaded')" class="kv-line">
      <span>最新版本</span><strong>v{{ updaterState.version }}</strong>
    </div>
    <div class="card-actions">
      <el-button v-if="updaterState.phase !== 'disabled'" size="small"
        :loading="updaterState.phase === 'checking' || updaterState.phase === 'downloading'" @click="checkUpdate">
        {{ updaterState.phase === 'checking' ? '检查中…' : '检查更新' }}
      </el-button>
      <el-button v-if="updaterState.phase === 'downloaded'" size="small" type="primary" @click="installUpdate">立即安装</el-button>
    </div>
    <div v-if="updaterState.phase === 'error'" class="warning-line">{{ updaterState.error }}</div>
    <div v-if="updaterState.phase === 'disabled'" class="hint">自动更新已被环境变量 SSHK_APP_AUTO_UPDATE=0 禁用：不检查、不下载、不提示新版本（内网/定制分发场景）。</div>
    <div v-else class="hint">自动更新默认开启（见「常规设置」）；新版本后台下载，完成后点「立即安装」重启生效。若需在退出应用时自动安装，请在「常规设置 → 自动安装更新」开启（默认关闭）。</div>
  </section>
</template>
