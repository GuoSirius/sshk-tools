<script setup lang="ts">
/**
 * 系统与数据 · 配置预设卡（P4-3 从 SystemTab 拆入）：
 * 模型 Provider + 上传 Profile 导出/导入 JSON；「包含密钥」开启时导出前敏感操作二次确认（语义不变）。
 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IPC_CHANNELS, toFileName } from '@sshk/shared'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'

const PRESET_EXPORT_SPEC: HostApiSpec = { group: 'presets', method: 'export', channel: IPC_CHANNELS.presetExport, label: '配置预设导出' }
const PRESET_IMPORT_SPEC: HostApiSpec = { group: 'presets', method: 'import', channel: IPC_CHANNELS.presetImport, label: '配置预设导入' }
const presetIncludeSecrets = ref(false)

async function exportPresetFile(): Promise<void> {
  if (presetIncludeSecrets.value) {
    try {
      await ElMessageBox.confirm(
        '「包含密钥」已开启：导出的 JSON 将含有模型 API Key 与上传密钥明文。任何拿到该文件的人都能直接使用你的密钥，请仅用于可信设备间迁移并妥善保管。确定继续吗？',
        '敏感操作确认',
        { type: 'warning', confirmButtonText: '确认包含密钥导出', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
  }
  const save = await window.api.os.pickSave({
    fileName: `sshk-preset-${toFileName()}${presetIncludeSecrets.value ? '-含密钥' : ''}.json`,
    extensions: ['json'],
  })
  if (!save) return
  try {
    const r = await callHostApi<{ file: string; providers: number; uploadProfiles: number; secrets: number }>(
      PRESET_EXPORT_SPEC, save, presetIncludeSecrets.value)
    ElMessage.success(`预设已导出：Provider ${r.providers} / 上传 Profile ${r.uploadProfiles}${r.secrets ? ` / 密钥 ${r.secrets} 条（明文，请妥善保管）` : ''}`)
  } catch (err) { ElMessage.error(`导出失败：${(err as Error).message}`) }
}
async function importPresetFile(): Promise<void> {
  const [file] = await window.api.os.pickFile({ filters: [{ name: '配置预设', extensions: ['json'] }] })
  if (!file) return
  try {
    const r = await callHostApi<{ providersMerged: number; uploadProfilesMerged: number }>(PRESET_IMPORT_SPEC, file)
    ElMessage.success(`预设已导入：Provider ${r.providersMerged} / 上传 Profile ${r.uploadProfilesMerged}（按 id 合并）`)
  } catch (err) { ElMessage.error(`导入失败：${(err as Error).message}`) }
}
</script>

<template>
  <section class="settings-card">
    <div class="card-title">配置预设</div>
    <div class="switch-row">
      <!-- 开关固定居右（用户 2026-11-18：开/关前后位置不变），提示消息插在 label 与开关之间 -->
      <span class="switch-label">
        包含密钥
        <FormHint inline detail="开启后，导出预设会携带模型 API Key 与上传密钥明文，用于可信设备间完整迁移。默认关闭（只导出配置、不含密钥）。含密钥文件请妥善保管，导入会自动写回本机密钥库。">含明文密钥</FormHint>
      </span>
      <span v-if="presetIncludeSecrets" class="hint danger-text switch-inline-tip">当前将导出明文密钥，请仅用于可信设备</span>
      <el-switch v-model="presetIncludeSecrets" size="small" />
    </div>
    <div class="kv-line">
      <span>导出 / 导入</span>
      <div class="btn-group">
        <el-button size="small" type="warning" @click="exportPresetFile">导出预设</el-button>
        <el-button size="small" @click="importPresetFile">导入预设</el-button>
      </div>
    </div>
    <div class="hint">导出模型 Provider 与上传 Profile 为 JSON 预设；默认剔除密钥、本机默认目录不带入。导入按 id 合并（同名覆盖、新增追加），含密钥预设导入时自动写回密钥库。</div>
  </section>
</template>
