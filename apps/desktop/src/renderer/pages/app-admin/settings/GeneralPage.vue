<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 常规设置（P4-3 页化 · 迁即重构，吸收原 GeneralTab）：
 * 外观（主题）/ 启动与托盘 / 更新 / 产物目录 / 开发者选项 五组表单 + 统一保存按钮区。
 * 共享状态走 composables/useAppConfig（appConfig reactive 单例 + saveAppConfig('general') 语义不变）；
 * 开发者模式口令流（promptSecret + verifyDevtoolsKey）原样保留：取消静默复位、失败复位开关。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callHostApi, FormGrid, FormHint, type HostApiSpec } from '@sshk/ui-kit'
import { IPC_CHANNELS, SSHK_DEV } from '@sshk/shared'
import type { ThemeMode } from '@sshk/shared'
import { appConfig, loadAppConfig, saveAppConfig } from '@renderer/composables/useAppConfig'
import { useTheme } from '@renderer/composables/useTheme'
import { promptSecret } from '@renderer/components/secret-prompt'

const isDev = SSHK_DEV
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
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>常规设置</strong>
      <span class="muted" style="margin-left: 12px">主题、启动与托盘、更新、产物目录、开发者选项</span>
    </div>
    <div class="admin-subpage-body">
      <!-- 外观 -->
      <section class="settings-card">
        <div class="card-title">外观</div>
        <el-form size="small" label-width="auto">
          <FormGrid>
            <el-form-item label="主题模式">
              <el-select :model-value="mode" @change="onTheme">
                <el-option label="暗黑" value="dark" />
                <el-option label="亮色" value="light" />
                <el-option label="跟随系统" value="system" />
              </el-select>
              <FormHint inline detail="顶栏主题胶囊与此处同源（useTheme 单例），改一处两处同步">与顶栏同源</FormHint>
            </el-form-item>
          </FormGrid>
        </el-form>
      </section>

      <!-- 启动与托盘 -->
      <section class="settings-card">
        <div class="card-title">启动与托盘</div>
        <div class="switch-row">
          <span class="switch-label">开机自启</span>
          <el-switch v-model="appConfig.launchOnBoot" />
        </div>
        <div class="switch-row">
          <span class="switch-label">系统托盘</span>
          <el-switch v-model="appConfig.tray" />
        </div>
        <div class="switch-row">
          <span class="switch-label">关闭按钮最小化到托盘
            <FormHint inline detail="默认关：点关闭弹确认框，确认后退出应用；开启后点关闭直接隐藏到托盘（托盘需开启）。托盘不可用时仍走确认退出">默认关</FormHint>
          </span>
          <el-switch v-model="appConfig.closeToTray" />
        </div>
      </section>

      <!-- 更新 -->
      <section class="settings-card">
        <div class="card-title">更新</div>
        <div class="switch-row">
          <span class="switch-label">自动更新
            <FormHint inline detail="新版本仅在后台下载，完成后点「立即安装」重启生效">默认开</FormHint>
          </span>
          <el-switch v-model="appConfig.autoUpdate" />
        </div>
        <div class="switch-row">
          <span class="switch-label">自动安装更新
            <FormHint inline detail="默认关：新版本仅在后台下载，可在「系统与数据 → 更新」点「立即安装」；开启后退出应用时自动安装">默认关</FormHint>
          </span>
          <el-switch v-model="appConfig.autoInstallOnAppQuit" />
        </div>
        <div class="hint">检查更新 / 立即安装入口在顶栏更新胶囊与「系统与数据」页；此处只管策略开关。</div>
      </section>

      <!-- 产物目录 -->
      <section class="settings-card">
        <div class="card-title">产物目录</div>
        <el-form size="small" label-width="auto">
          <FormGrid>
            <el-form-item class="full" label="产物目录">
              <div class="combo">
                <el-input clearable v-model="appConfig.outputDir" placeholder="留空 = 默认 userData/sshk-data" />
                <el-button @click="pickDir">选择</el-button>
              </div>
              <FormHint>变更需重启生效；路径不进备份包</FormHint>
            </el-form-item>
          </FormGrid>
        </el-form>
      </section>

      <!-- 开发者选项 -->
      <section class="settings-card">
        <div class="card-title">开发者选项</div>
        <div class="switch-row">
          <span class="switch-label">开发者模式
            <FormHint inline detail="仅打包版生效；源码 dev 运行时开发功能恒开。开启后显示全部工具并开放配置入口，需输入开发者工具访问密钥">打包版</FormHint>
          </span>
          <el-switch :model-value="appConfig.developerMode" @change="(v: unknown) => onDeveloperModeChange(v)" />
        </div>
      </section>

      <!-- 保存按钮区：saveAppConfig('general') 只写本页负责的 key -->
      <div class="card-actions page-save-bar">
        <el-button type="primary" size="small" :loading="saving" @click="save">保存应用配置</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-subpage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 留白 token（规范 §2.1）：页面内边距 var(--sshk-page-padding)，卡片间距 var(--sshk-gap-md) */
.admin-subpage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sshk-page-padding);
  display: flex;
  flex-direction: column;
  gap: var(--sshk-gap-md);
}
/* 保存按钮区独立于卡片：置底不与卡片贴挤 */
.page-save-bar { margin: 0; padding-bottom: 4px; }
</style>
