import { createHash } from 'node:crypto'

/**
 * 敏感操作的访问密钥校验（单一实现）。
 *
 * 复用原本「打包版打开开发者工具」的同一套优先级：
 *   settings.json 的 app.devtoolsKeyHash > 环境变量 SSHK_DEVTOOLS_KEY > 内置 sshk-tools@888
 * 现在「打开 DevTools」与「开启开发者模式」共用，避免两套口令逻辑漂移。
 * 明文口令只在主进程内参与 sha256 比对，不下发、不落盘。
 */
export function devtoolsKeyMatches(configuredHash: string, inputKey: string): boolean {
  const envKey = String(process.env.SSHK_DEVTOOLS_KEY ?? '').trim() || 'sshk-tools@888'
  const expectedHash = configuredHash || createHash('sha256').update(envKey, 'utf8').digest('hex')
  const actualHash = createHash('sha256').update(String(inputKey ?? ''), 'utf8').digest('hex')
  return actualHash === expectedHash
}
