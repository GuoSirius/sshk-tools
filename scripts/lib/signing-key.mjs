#!/usr/bin/env node
/**
 * 官方签名私钥的本机存放与解析（解决「换设备开发」问题）。
 *
 * 安全红线：私钥绝不进仓库、绝不留在 .tmp（临时目录会被清理）、绝不通过聊天/邮件明文传输。
 * 默认位置：<homedir>/.sshk/official-signing-key.pem —— 用户级、跨项目共用、天然不在仓库内。
 *
 * 私钥来源优先级：
 *   1. env SSHK_OFFICIAL_SIGNING_KEY（PEM 文本，CI / 发布流水线）
 *   2. 本机用户级文件（本机开发，推荐；由 pnpm keys:init 生成或导入）
 *   3. SSHK_ROTATE_SIGNING_KEY=1 → 现场轮换，并把新私钥落盘到用户级目录（旧实现只打印公钥、私钥会丢）
 * 三者都没有 → 明确报错并给出初始化指引，而不是笼统的「未设置环境变量」。
 *
 * 跨设备策略：不搬运私钥，而是每台设备各自持有一把密钥、把公钥登记进
 * packages/shared/src/official-keys.json（纯数据文件，支持多把并存，追加只改数据）。
 * 已签名的 .sshktool 产物本身已入库，新设备 clone 后跑 verify 只需要公钥，不需要私钥。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { sha256 } from './tool-package.mjs'

export const KEY_DIR = join(homedir(), '.sshk')
export const KEY_FILE = join(KEY_DIR, 'official-signing-key.pem')

export function keyIdOf(privatePem) {
  const pub = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' })
  return sha256(pub).slice(0, 32)
}

export function publicPemOf(privatePem) {
  return createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString()
}

function savePrivateKey(privatePem) {
  mkdirSync(KEY_DIR, { recursive: true })
  writeFileSync(KEY_FILE, privatePem, { encoding: 'utf8', mode: 0o600 })
  // Windows 不认 POSIX mode，忽略 chmod 失败即可；Unix 上再兜一次
  try { chmodSync(KEY_FILE, 0o600) } catch { /* noop */ }
}

/** 生成本机密钥对并落盘；已存在则直接返回现有私钥（幂等，不覆盖） */
export function ensureLocalKey() {
  if (existsSync(KEY_FILE)) return { privatePem: readFileSync(KEY_FILE, 'utf8'), created: false }
  const kp = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  savePrivateKey(kp.privateKey)
  return { privatePem: kp.privateKey, created: true }
}

/** 从外部 PEM 导入到本机用户级目录（旧设备/公司密钥库迁移用），先校验是合法私钥 */
export function importLocalKey(pem) {
  createPublicKey(pem)
  savePrivateKey(pem)
  return pem
}

/** 轮换：生成新密钥对并覆盖本机文件；旧公钥仍留在 official-keys.json，此前签发的包继续可信 */
export function rotateLocalKey() {
  const kp = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  savePrivateKey(kp.privateKey)
  return kp.privateKey
}

export function resolvePrivateKey() {
  if (process.env.SSHK_ROTATE_SIGNING_KEY === '1') {
    return { privatePem: rotateLocalKey(), source: KEY_FILE, rotated: true }
  }
  if (process.env.SSHK_OFFICIAL_SIGNING_KEY) {
    return { privatePem: process.env.SSHK_OFFICIAL_SIGNING_KEY, source: 'env:SSHK_OFFICIAL_SIGNING_KEY' }
  }
  if (existsSync(KEY_FILE)) {
    return { privatePem: readFileSync(KEY_FILE, 'utf8'), source: KEY_FILE }
  }
  throw new Error(
    '未找到官方签名私钥。任选其一：\n' +
    '  1) pnpm keys:init                     本机生成新密钥（推荐，公钥需登记进 official-keys.json）\n' +
    '  2) pnpm keys:init -- --import <file>  从密钥库/旧设备导入已有私钥\n' +
    `  3) 设置 SSHK_OFFICIAL_SIGNING_KEY     CI Secret / 临时注入（私钥位置 ${KEY_FILE}）`,
  )
}
