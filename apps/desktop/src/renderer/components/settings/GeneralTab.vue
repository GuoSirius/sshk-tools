<script setup lang="ts">
/**
 * 应用设置 · 常规设置 tab：主题 / 产物目录 / 开机自启 / 托盘 / 自动更新 / 开发者模式。
 */
import { ElMessage } from 'element-plus'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { IPC_CHANNELS } from '@sshk/shared'
import type { ThemeMode } from '@sshk/shared'
import { appConfig, loadAppConfig, saveAppConfig } from '../../composables/useAppConfig'
import { useTheme } from '../../composables/useTheme'
import { promptSecret } from '../secret-prompt'
import { onMounted, ref } from 'vue'

const isDev = import.meta.env.DEV
const { mode, setMode } = useTheme()
const saving = ref(false)

const DEV_KEY_SPEC: HostApiSpec = {
  group: 'app',
  method: 'verifyDevtoolsKey',
  channel: IPC_CHANNELS.appVerifyDevtoolsKey,
  label: '开发者模式口令校验',
}
async function onDeveloperModeChange(next: unknown): Promise<void> {
  const wanted = Boolean(next)
  if (!wanted || isDev) { appConfig.developerMode = wanted; return }
  try {
    const alreadyAuthed = await window.api.app.verifyDevtoolsKey('', 'developerMode').catch(() => false)
    if (!alreadyAuthed) {
      const secret = await promptSecret(
        '开发者模式',
        '开启开发者模式需要访问密钥（与打包版「打开开发者工具」同一口令）',
        '验证并开启',
      )
      if (secret === null) { appConfig.developerMode = false; return } // 用户取消：静默复位开关（2026-11-18）
      await callHostApi<boolean>(DEV_KEY_SPEC, secret, 'developerMode')
    }
    appConfig.developerMode = true
    ElMessage.success('验证通过，点「保存应用配置」后生效')
  } catch (err) {
    appConfig.developerMode = false
    if ((err as Error)?.message && !/cancel|close/i.test(String(err))) {
      ElMessage.error((err as Error).message)
    }
  }
}
async function onTheme(next: ThemeMode): Promise<void> { await setMode(next) }
async function pickDir(): Promise<void> {
  const dir = await window.api.os.pickDir()
  if (dir) appConfig.outputDir = dir
}
async function save(): Promise<void> {
  saving.value = true
  try {
    await saveAppConfig('general')
    ElMessage.success('应用配置已保存（产物目录变更需重启生效）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { saving.value = false }
}

onMounted(() => { void loadAppConfig() })
</script>

<template>
  <section class="settings-card">
    <div class="card-title">常规</div>
    <el-form size="small" label-position="top">
      <FormGrid>
        <el-form-item label="主题模式">
          <div class="switch-row">
            <span class="switch-label">主题模式</span>
            <el-select :model-value="mode" class="theme-select" @change="onTheme">
              <el-option label="暗黑" value="dark" />
              <el-option label="亮色" value="light" />
              <el-option label="跟随系统" value="system" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="开机自启">
          <div class="switch-row">
            <span class="switch-label">开机自启</span>
            <el-switch v-model="appConfig.launchOnBoot" />
          </div>
        </el-form-item>
        <el-form-item label="系统托盘">
          <div class="switch-row">
            <span class="switch-label">系统托盘</span>
            <el-switch v-model="appConfig.tray" />
          </div>
        </el-form-item>
        <el-form-item label="关闭按钮最小化到托盘">
          <div class="switch-row">
            <span class="switch-label">关闭按钮最小化到托盘
              <FormHint inline detail="默认关：点关闭弹确认框，确认后退出应用；开启后点关闭直接隐藏到托盘（托盘需开启）。托盘不可用时仍走确认退出">默认关</FormHint>
            </span>
            <el-switch v-model="appConfig.closeToTray" />
          </div>
        </el-form-item>
        <el-form-item label="自动更新">
          <div class="switch-row">
            <span class="switch-label">自动更新
              <FormHint inline detail="新版本仅在后台下载，完成后点「立即安装」重启生效">默认开</FormHint>
            </span>
            <el-switch v-model="appConfig.autoUpdate" />
          </div>
        </el-form-item>
        <el-form-item label="自动安装更新">
          <div class="switch-row">
            <span class="switch-label">自动安装更新
              <FormHint inline detail="默认关：新版本仅在后台下载，可在「系统与数据 → 更新」点「立即安装」；开启后退出应用时自动安装">默认关</FormHint>
            </span>
            <el-switch v-model="appConfig.autoInstallOnAppQuit" />
          </div>
        </el-form-item>
        <el-form-item label="开发者模式">
          <div class="switch-row">
            <span class="switch-label">开发者模式
              <FormHint inline detail="仅打包版生效；源码 dev 运行时开发功能恒开。开启后显示全部工具并开放配置入口，需输入开发者工具访问密钥">打包版</FormHint>
            </span>
            <el-switch :model-value="appConfig.developerMode" @change="(v: unknown) => onDeveloperModeChange(v)" />
          </div>
        </el-form-item>
        <el-form-item class="full" label="产物目录">
          <div class="combo">
            <el-input clearable v-model="appConfig.outputDir" placeholder="留空 = 默认 userData/sshk-data" />
            <el-button @click="pickDir">选择</el-button>
          </div>
          <FormHint>变更需重启生效；路径不进备份包</FormHint>
        </el-form-item>
      </FormGrid>
    </el-form>
    <div class="card-actions">
      <el-button type="primary" size="small" :loading="saving" @click="save">保存应用配置</el-button>
    </div>
  </section>
</template>

<style scoped>
/* 主题模式下拉：一行布局内固定宽度（el-select 默认 100% 会在 flex 里拉伸挤压 label） */
.theme-select { width: 150px; flex: none; }
</style>
