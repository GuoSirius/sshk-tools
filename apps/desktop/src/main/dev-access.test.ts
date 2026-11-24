/**
 * 开发者口令校验测试（2026-11-24 #191）：优先级 settings 显式哈希 > env > 内置默认；
 * trim 容错——复制粘贴携带首尾空格/换行不再误判「访问密钥不正确」。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { devtoolsKeyMatches } from './dev-access'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const DEFAULT_KEY = 'sshk-tools@888'

describe('devtoolsKeyMatches', () => {
  it('默认口令（无显式哈希、无 env 覆盖）匹配，错误口令不匹配', () => {
    expect(devtoolsKeyMatches('', DEFAULT_KEY)).toBe(true)
    expect(devtoolsKeyMatches('', 'sshk-tools@8888')).toBe(false)
    expect(devtoolsKeyMatches('', 'SSHK-TOOLS@888')).toBe(false) // 大小写敏感
  })

  it('trim 容错：首尾空格 / 换行 / 制表符不导致误判', () => {
    expect(devtoolsKeyMatches('', ` ${DEFAULT_KEY}`)).toBe(true)
    expect(devtoolsKeyMatches('', `${DEFAULT_KEY}\n`)).toBe(true)
    expect(devtoolsKeyMatches('', `\t${DEFAULT_KEY} `)).toBe(true)
    expect(devtoolsKeyMatches(sha256(DEFAULT_KEY), `  ${DEFAULT_KEY}\r\n`)).toBe(true)
  })

  it('settings 显式哈希优先：配置后按自定义口令判定（默认口令失效）', () => {
    const custom = 'my-own-key!'
    expect(devtoolsKeyMatches(sha256(custom), custom)).toBe(true)
    expect(devtoolsKeyMatches(sha256(custom), DEFAULT_KEY)).toBe(false)
  })

  it('显式哈希与默认口令一致时（实锤 #191：settings 789e19… 即 sshk-tools@888 哈希）默认口令通过', () => {
    expect(devtoolsKeyMatches(sha256(DEFAULT_KEY), DEFAULT_KEY)).toBe(true)
  })
})
