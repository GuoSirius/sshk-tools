import { describe, expect, it } from 'vitest'
import { decryptSecrets, encryptSecrets } from './crypto'

describe('密钥加密迁移（D18）', () => {
  it('加密 → 解密往返', () => {
    const secrets = JSON.stringify({ providers: [{ _id: 'prv_1', name: 'ollama' }] })
    const blob = encryptSecrets(secrets, '迁移口令abc123')
    expect(blob.ciphertext).not.toContain('prv_1')
    expect(decryptSecrets(blob, '迁移口令abc123')).toBe(secrets)
  })

  it('错误口令 → 明确报错且不泄露内容', () => {
    const blob = encryptSecrets('{"apiKey":"sk-secret-value"}', '正确口令12345')
    expect(() => decryptSecrets(blob, '错误口令99999')).toThrow('口令错误')
  })

  it('短口令被拒', () => {
    expect(() => encryptSecrets('{}', '短')).toThrow('至少 8 位')
  })

  it('密文不含明文 apiKey 与口令', () => {
    const blob = encryptSecrets('{"apiKey":"sk-abc"}', '口令口令口令123')
    const b64 = Buffer.from(blob.ciphertext, 'base64').toString('latin1')
    expect(b64).not.toContain('sk-abc')
    expect(blob.salt).not.toContain('口令')
  })
})
