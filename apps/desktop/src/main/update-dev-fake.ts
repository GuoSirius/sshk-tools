/**
 * dev 更新测试：版本号伪装 + 测试模式开关。
 * ⚠️ 必须在 import 'electron-updater' **之前**引入并求值（ESM import 按顺序求值）：
 *   AppUpdater 构造函数会 `this.currentVersion = semver.parse(app.version)` 缓存版本快照
 *   （electron-updater AppUpdater.js:212-217），autoUpdater 单例在 index.ts 顶部解构时即构造——
 *   若 app.getVersion 覆盖发生在其之后，currentVersion 永远是真实版本，electron-updater
 *   恒判 not-available → 不下载 → 渲染层拿不到任何进度（2026-11-18 事故根因）。
 * 打包版零影响（非 dev 不覆盖任何行为）。
 */
import { app } from 'electron'
import { getEnvBool, getEnvStr } from '@sshk/shared'

const isDev = !app.isPackaged

/** dev 更新测试模式：仅 dev + SSHK_DEV_UPDATE_TEST=1 生效，走真实 GitHub 更新源验证下载全流程 */
export const updateDevCheck = isDev && getEnvBool('SSHK_DEV_UPDATE_TEST', false)

if (updateDevCheck) {
  const fakeVersion = getEnvStr('SSHK_DEV_UPDATE_FAKE_VERSION')
  if (fakeVersion) {
    const realGetVersion = app.getVersion.bind(app)
    // electron-updater 用 app.getVersion() 与线上 latest.yml 对比；dev 测试期改返回值即可伪装旧版本，
    // 不动任何 package.json（版本号只在 dev + 显式 env 时被覆盖，打包版零影响）。
    app.getVersion = () => fakeVersion
    console.log(`[sshk] dev 更新测试：版本号覆盖为 ${fakeVersion}（真实 ${realGetVersion()}），仅影响本次 dev 进程`)
  }
}
