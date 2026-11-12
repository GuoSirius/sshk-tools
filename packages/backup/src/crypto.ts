import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

/**
 * 密钥加密迁移（D18 / 数据契约 §4.3）：
 * - PBKDF2-SHA256(口令, salt, iterations) → 256bit key
 * - AES-256-GCM 加密 secrets JSON；口令/密钥绝不落盘、绝不进包
 * - 功能开关 SSHK_TOOLS_ALLOW_SECRET_MIGRATION 由主进程检测，本模块不感知
 */
export const PBKDF2_ITERATIONS = 210_000

export interface EncryptedBlob {
  iterations: number
  salt: string
  nonce: string
  ciphertext: string
}

function deriveKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256')
}

export function encryptSecrets(secretsJson: string, passphrase: string): EncryptedBlob {
  if (passphrase.length < 8) {
    throw new Error('迁移口令至少 8 位')
  }
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const enc = Buffer.concat([cipher.update(secretsJson, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    // ciphertext = GCM 密文 + authTag（16 字节，尾部拼接）
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
  }
}

export function decryptSecrets(blob: EncryptedBlob, passphrase: string): string {
  const salt = Buffer.from(blob.salt, 'base64')
  const nonce = Buffer.from(blob.nonce, 'base64')
  const data = Buffer.from(blob.ciphertext, 'base64')
  const enc = data.subarray(0, data.length - 16)
  const tag = data.subarray(data.length - 16)
  const key = deriveKey(passphrase, salt, blob.iterations)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('迁移口令错误或包已损坏（GCM 校验失败）')
  }
}
