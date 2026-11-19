import { describe, expect, it } from 'vitest'
import { isProviderId, toolSecretId, uploadSecretId } from './secret-ids'

describe('工具密钥标识（回归：驼峰密钥名曾被误判非法）', () => {
  it('允许工具包名与驼峰 / 下划线 / 连字符密钥名', () => {
    expect(toolSecretId('badge-studio', 'visionApiKey')).toBe('app:tool:badge-studio:visionApiKey')
    expect(toolSecretId('model-console', 'vision_api_key')).toBe('app:tool:model-console:vision_api_key')
    expect(toolSecretId('edm-studio', 'share-token')).toBe('app:tool:edm-studio:share-token')
  })

  it('拒绝空值、路径穿越字符与冒号（避免污染 secrets 命名空间）', () => {
    for (const bad of ['', 'a:b', '../x', '中文', ' x']) {
      expect(() => toolSecretId(bad, 'key')).toThrow('非法工具密钥标识')
      expect(() => toolSecretId('tool', bad)).toThrow('非法工具密钥标识')
    }
  })

  it('providerId 仍必须是 prv_ 前缀 + 小写数字字母', () => {
    expect(isProviderId('prv_01abc')).toBe(true)
    expect(isProviderId('prv_preview')).toBe(true)
    expect(isProviderId('prv_XYZ')).toBe(false)
    expect(isProviderId('app:tool:x:y')).toBe(false)
  })
})

describe('uploadSecretId（应用级上传通道密钥命名空间）', () => {
  it('profileId → app:upload:<pid>', () => {
    expect(uploadSecretId('p_01abc')).toBe('app:upload:p_01abc')
    expect(uploadSecretId('P_12')).toBe('app:upload:P_12')
  })

  it('拒绝空值与非法字符（同工具密钥校验口径）', () => {
    for (const bad of ['', 'a:b', '../x', '中文', ' x']) {
      expect(() => uploadSecretId(bad)).toThrow('非法上传密钥标识')
    }
  })
})
