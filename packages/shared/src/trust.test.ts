import { createHash, createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_DEFAULT_SANDBOX,
  HOST_API_VERSION,
  OFFICIAL_PUBLIC_KEYS,
  TOOL_PACKAGE_EXT,
  TOOL_PACKAGE_SCHEMA_VERSION,
  canLoadInMain,
} from './trust'

describe('运行时工具包信任契约', () => {
  it('官方公钥以 official-keys.json 为唯一真相源（代码里不另写一份）', () => {
    const raw = JSON.parse(readFileSync(new URL('./official-keys.json', import.meta.url), 'utf8')) as unknown[]
    expect(Array.isArray(raw)).toBe(true)
    expect(OFFICIAL_PUBLIC_KEYS).toEqual(raw)
  })

  it('只有「签名有效 + 公钥可信 + 显式信任」才允许进主进程', () => {
    expect(canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: true })).toBe(true)
    expect(canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: false })).toBe(false)
    expect(canLoadInMain({ signatureValid: true, keyTrusted: false, explicitlyTrusted: true })).toBe(false)
    expect(canLoadInMain({ signatureValid: false, keyTrusted: true, explicitlyTrusted: true })).toBe(false)
  })

  it('外部包默认 utility，官方公钥登记结构合法且不允许隐式提权', () => {
    expect(EXTERNAL_DEFAULT_SANDBOX).toBe('utility')
    // 官方公钥已登记且支持多把并存/轮换；逐把校验 keyId 与公钥 PEM 匹配，防止登记错配
    expect(OFFICIAL_PUBLIC_KEYS.length).toBeGreaterThan(0)
    for (const key of OFFICIAL_PUBLIC_KEYS) {
      expect(key.keyId).toMatch(/^[a-f0-9]{32}$/)
      expect(key.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const parsed = createPublicKey(key.pem)
      expect(parsed.asymmetricKeyType).toBe('ed25519')
      const canonicalPem = parsed.export({ type: 'spki', format: 'pem' })
      expect(createHash('sha256').update(canonicalPem).digest('hex').slice(0, 32)).toBe(key.keyId)
    }
    expect(canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: false })).toBe(false)
    expect(TOOL_PACKAGE_SCHEMA_VERSION).toBe(1)
    expect(HOST_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(TOOL_PACKAGE_EXT).toBe('.sshktool')
  })
})
