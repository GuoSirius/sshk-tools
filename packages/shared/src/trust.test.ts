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
  it('只有「签名有效 + 公钥可信 + 显式信任」才允许进主进程', () => {
    expect(canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: true })).toBe(true)
    expect(canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: false })).toBe(false)
    expect(canLoadInMain({ signatureValid: true, keyTrusted: false, explicitlyTrusted: true })).toBe(false)
    expect(canLoadInMain({ signatureValid: false, keyTrusted: true, explicitlyTrusted: true })).toBe(false)
  })

  it('外部包默认 utility，官方公钥暂未登记且不允许隐式提权', () => {
    expect(EXTERNAL_DEFAULT_SANDBOX).toBe('utility')
    expect(OFFICIAL_PUBLIC_KEYS).toHaveLength(0)
    expect(TOOL_PACKAGE_SCHEMA_VERSION).toBe(1)
    expect(HOST_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(TOOL_PACKAGE_EXT).toBe('.sshktool')
  })
})
