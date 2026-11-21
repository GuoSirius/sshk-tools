/**
 * dev 判据唯一真相源（P0-1 · D55 终审：developerMode 保留，dev 判据唯一化照旧执行）。
 *
 * `__SSHK_DEV__` 由 apps/desktop/electron.vite.config.ts 构建期注入 main/preload/renderer
 * 三端，定值 `mode === 'development' || mode === 'dev' || mode === 'preview'`
 * （终审 C-1：preview 归 dev；electron-vite dev 实际 mode=development，preview 专链
 * `electron-vite preview --mode preview`）。全仓禁止再用 `import.meta.env.DEV`、
 * `!app.isPackaged` 判 dev（ESLint no-restricted-syntax + verify-structure 双门禁）。
 *
 * `SSHK_DEV` 是唯一的运行时消费形态（纯常量，构建期被 define 替换为字面量）；
 * typeof 守卫：vitest 等无 define 的执行环境回退 false，避免 ReferenceError。
 */
declare const __SSHK_DEV__: boolean
export const SSHK_DEV: boolean = typeof __SSHK_DEV__ !== 'undefined' && __SSHK_DEV__

/**
 * 开发者功能总开关唯一口径（D-2 写法收敛 · P0-2）：dev 运行态（含 preview）或用户显式 developerMode。
 * 2026-11-14 铁律原文不变：dev 下恒全量展示全量可编辑、不受配置控制；
 * 打包/安装版由 app.developerMode 决定（developerMode 保留，D55）。
 * 全仓禁止散拼 `isDev || developerMode`（ESLint no-restricted-syntax），一律走本函数或 catalog 下发的 devFeatures。
 */
export function isDevFeaturesEnabled(isDev: boolean, developerMode: boolean): boolean {
  // eslint-disable-next-line no-restricted-syntax -- 本函数即 D-2 唯一口径的定义点
  return isDev || developerMode
}
