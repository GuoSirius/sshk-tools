import { createHash } from 'node:crypto'
import { getEnvStr } from '@sshk/shared'

/**
 * 敏感操作的访问密钥校验（单一实现）。
 *
 * 复用原本「打包版打开开发者工具」的同一套优先级：
 *   settings.json 的 app.devtoolsKeyHash > 环境变量 SSHK_APP_DEVTOOLS_KEY > 内置 sshk-tools@888
 * 现在「打开 DevTools」与「开启开发者模式」共用，避免两套口令逻辑漂移。
 * 明文口令只在主进程内参与 sha256 比对，不下发、不落盘。
 *
 * 会话内授权缓存（2026-11-17 用户验收项9）：
 * - 按「操作类型」分别缓存，有效期内同一操作免输；开启开发者模式与打开开发者工具互不复用；
 * - 有效期默认 8 小时（应用周期内基本免输），过期或应用重启后首次操作需重新输；
 * - 缓存只在主进程内存，重启即清空；不落盘。
 */
export type DevKeyOperation = 'devtools' | 'developerMode'

const AUTH_TTL_MS = 8 * 60 * 60 * 1000
const authCache = new Map<DevKeyOperation, number>()

export function devtoolsKeyMatches(configuredHash: string, inputKey: string): boolean {
  const envKey = getEnvStr('SSHK_APP_DEVTOOLS_KEY', 'sshk-tools@888')
  const expectedHash = configuredHash || createHash('sha256').update(envKey, 'utf8').digest('hex')
  // trim（2026-11-24 #191）：复制粘贴携带首尾空格/换行是验证失败最高频原因；口令本体无空格场景
  const actualHash = createHash('sha256').update(String(inputKey ?? '').trim(), 'utf8').digest('hex')
  return actualHash === expectedHash
}

/** 该操作在有效期内是否已授权（不同操作独立） */
export function isDevOpAuthorized(op: DevKeyOperation): boolean {
  const until = authCache.get(op)
  return typeof until === 'number' && Date.now() < until
}

/** 校验通过后登记授权（含 dev 模式：dev 下直接放行但同样登记，保持语义一致） */
export function markDevOpAuthorized(op: DevKeyOperation): void {
  authCache.set(op, Date.now() + AUTH_TTL_MS)
}

/** 校验失败 / 主动撤销时清除该操作授权 */
export function clearDevOpAuthorization(op: DevKeyOperation): void {
  authCache.delete(op)
}
