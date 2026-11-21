/**
 * 应用级配置读写（模块级单例，应用设置各页共享）。
 * 原 AppSettingsDrawer 内联的 str/bool/num + cfg/load/save 抽到这里，现供常规设置页等共用，
 * 避免每页重复实现配置读写与保存。
 * 分享服务配置（app.shareHub.*）不在此管：应用设置分享页已取消（P4-3），
 * 同键读写归「分享管理」工具 service 页（tools/share-manager，两处入口同键天然一致）。
 */
import { reactive } from 'vue'

export const appConfig = reactive({
  outputDir: '',
  launchOnBoot: false,
  tray: true,
  autoUpdate: true,
  autoInstallOnAppQuit: false,
  developerMode: false,
  /** 回滚快照开关（D19）：「系统与数据」页快照卡独立保存（不走 saveAppConfig） */
  outputSnapshot: false,
  /** 关闭按钮最小化到托盘（用户 2026-11-18）：默认关=关闭需二次确认后退出应用；开=点关闭隐藏到托盘 */
  closeToTray: false,
})

async function str(key: string, fallback: string): Promise<string> {
  const value = await window.api.config.get(key)
  return value === null || value === undefined ? fallback : String(value)
}
async function bool(key: string, fallback: boolean): Promise<boolean> {
  const value = await window.api.config.get(key)
  return typeof value === 'boolean' ? value : fallback
}

/** 载入全部应用配置到共享 reactive（供各页展示） */
export async function loadAppConfig(): Promise<void> {
  appConfig.outputDir = (await str('app.outputDir', '')) === 'null' ? '' : await str('app.outputDir', '')
  appConfig.launchOnBoot = await bool('app.launchOnBoot', false)
  appConfig.tray = await bool('app.tray', true)
  appConfig.autoUpdate = await bool('app.autoUpdate', true)
  appConfig.autoInstallOnAppQuit = await bool('app.autoInstallOnAppQuit', false)
  appConfig.developerMode = await bool('app.developerMode', false)
  appConfig.outputSnapshot = await bool('app.outputSnapshot', false)
  appConfig.closeToTray = await bool('app.closeToTray', false)
}

/** 保存常规设置分组配置，各页只写自己负责的 key；未知分组直接拒绝不落盘。
 *  outputSnapshot（回滚快照）不走此函数：「系统与数据」页快照卡开关即改即存。 */
export async function saveAppConfig(group: 'general'): Promise<boolean> {
  if (group !== 'general') return false
  const pairs: [string, unknown][] = [
    ['app.outputDir', appConfig.outputDir.trim() || null],
    ['app.launchOnBoot', appConfig.launchOnBoot],
    ['app.tray', appConfig.tray],
    ['app.autoUpdate', appConfig.autoUpdate],
    ['app.autoInstallOnAppQuit', appConfig.autoInstallOnAppQuit],
    ['app.developerMode', appConfig.developerMode],
    ['app.closeToTray', appConfig.closeToTray === true],
  ]
  for (const [key, value] of pairs) await window.api.config.set(key, value)
  return true
}
