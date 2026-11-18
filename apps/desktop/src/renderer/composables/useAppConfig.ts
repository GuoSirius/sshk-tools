/**
 * 应用级配置读写（模块级单例，应用设置各 tab 共享）。
 * 原 AppSettingsDrawer 内联的 str/bool/num + cfg/load/save 抽到这里，
 * 供 GeneralTab / ShareTab 等共用，避免每个 tab 重复实现配置读写与保存。
 */
import { reactive } from 'vue'
import type { ShareHubMount } from '@sshk/shared'

export const appConfig = reactive({
  outputDir: '',
  launchOnBoot: false,
  tray: true,
  autoUpdate: true,
  autoInstallOnAppQuit: false,
  developerMode: false,
  outputSnapshot: false,
  /** ShareHub（plans/09） */
  shareAutoStart: true,
  sharePort: 56789,
  sharePreferredIp: '',
  shareDefaultTtlHours: 72,
  /** 是否允许浏览目录列表（用户 2026-11-18：默认不允许；直接文件链接不受影响；分享弹框可按次覆盖） */
  shareAllowIndex: false,
  /** 挂载目录（多目录分享，用户 2026-11-18）：app.shareHub.mounts 数组 */
  shareMounts: [] as ShareHubMount[],
})

async function str(key: string, fallback: string): Promise<string> {
  const value = await window.api.config.get(key)
  return value === null || value === undefined ? fallback : String(value)
}
async function bool(key: string, fallback: boolean): Promise<boolean> {
  const value = await window.api.config.get(key)
  return typeof value === 'boolean' ? value : fallback
}
async function num(key: string, fallback: number): Promise<number> {
  const value = Number(await window.api.config.get(key))
  return Number.isFinite(value) ? value : fallback
}
/** 读数组配置（如挂载目录）；非数组返回 null 由调用方给默认 */
async function arr<T>(key: string): Promise<T[] | null> {
  const value = await window.api.config.get(key)
  return Array.isArray(value) ? (value as T[]) : null
}

/** 载入全部应用配置到共享 reactive（供各 tab 展示） */
export async function loadAppConfig(): Promise<void> {
  appConfig.outputDir = (await str('app.outputDir', '')) === 'null' ? '' : await str('app.outputDir', '')
  appConfig.launchOnBoot = await bool('app.launchOnBoot', false)
  appConfig.tray = await bool('app.tray', true)
  appConfig.shareAutoStart = await bool('app.shareHub.autoStart', true)
  appConfig.sharePort = await num('app.shareHub.port', 56789)
  appConfig.sharePreferredIp = (await str('app.shareHub.preferredIp', '')) === 'null' ? '' : await str('app.shareHub.preferredIp', '')
  const ttl = await num('app.shareHub.defaultTtlHours', 72)
  appConfig.shareDefaultTtlHours = Number.isInteger(ttl) && ttl >= 0 ? ttl : 72
  appConfig.shareAllowIndex = await bool('app.shareHub.allowIndex', false)
  appConfig.shareMounts = (await arr<ShareHubMount>('app.shareHub.mounts')) ?? []
  appConfig.autoUpdate = await bool('app.autoUpdate', true)
  appConfig.autoInstallOnAppQuit = await bool('app.autoInstallOnAppQuit', false)
  appConfig.developerMode = await bool('app.developerMode', false)
  appConfig.outputSnapshot = await bool('app.outputSnapshot', false)
}

/** 保存指定分组的配置；groups='general' | 'share'，各 tab 只写自己负责的 key。
 *  shareMounts（挂载目录）不走此函数：ShareTab 在校验/规范化后单独写 app.shareHub.mounts。 */
export async function saveAppConfig(group: 'general' | 'share'): Promise<boolean> {
  const pairs: [string, unknown][] = group === 'share'
    ? [
        ['app.shareHub.autoStart', appConfig.shareAutoStart],
        ['app.shareHub.port', Number.isInteger(Number(appConfig.sharePort)) ? Number(appConfig.sharePort) : 0],
        ['app.shareHub.preferredIp', appConfig.sharePreferredIp.trim()],
        ['app.shareHub.defaultTtlHours', Number.isInteger(Number(appConfig.shareDefaultTtlHours)) && Number(appConfig.shareDefaultTtlHours) >= 0 ? Number(appConfig.shareDefaultTtlHours) : 72],
        ['app.shareHub.allowIndex', appConfig.shareAllowIndex === true],
      ]
    : [
        ['app.outputDir', appConfig.outputDir.trim() || null],
        ['app.launchOnBoot', appConfig.launchOnBoot],
        ['app.tray', appConfig.tray],
        ['app.autoUpdate', appConfig.autoUpdate],
        ['app.autoInstallOnAppQuit', appConfig.autoInstallOnAppQuit],
        ['app.developerMode', appConfig.developerMode],
      ]
  for (const [key, value] of pairs) await window.api.config.set(key, value)
  return true
}
