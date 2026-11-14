#!/usr/bin/env node
/**
 * 工具包签名：node scripts/sign-tool.mjs <id> [--src <dir>]
 *
 * 前置：设置环境变量 SSHK_OFFICIAL_SIGNING_KEY 为官方 Ed25519 私钥 PEM（pkcs8）。
 *   export SSHK_OFFICIAL_SIGNING_KEY="-----BEGIN PRIVATE KEY-----
 *   ...
 *   -----END PRIVATE KEY-----"
 *
 * 行为（口径统一由 scripts/lib/tool-package.mjs 提供，与运行时验签严格一致）：
 *   1. 读取源 manifest，先规范化并剔除旧的 package.signature（保证重复签名幂等，不把旧签名带进新签名对象）
 *   2. 签名对象 = 规范 manifest 原文 + '\n' + 其余文件（排除 manifest 自身与 SIGNATURE）的 name:sha256 排序清单
 *   3. 用私钥 Ed25519 签名，写两处：
 *      - <src>/SIGNATURE        （两行：keyId 换行 base64，安装器优先读取）
 *      - manifest.package.signature（契约要求 main 必带；兜底字段）
 *   4. 重跑 scripts/pack-tool.mjs <id> 即得到带签名的 .sshktool
 *
 * 轮换：设置 SSHK_ROTATE_SIGNING_KEY=1 时，生成全新密钥对并用新私钥签名，
 *   同时打印新公钥 PEM 与 keyId，供登记进 packages/shared/src/trust.ts 的 OFFICIAL_PUBLIC_KEYS 实现轮换。
 */
import { createPublicKey, sign as cryptoSign, generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MANIFEST_FILE,
  SIGNATURE_FILE,
  buildSignaturePayload,
  canonicalManifestText,
  collectFiles,
  resolveToolSrc,
  sha256,
} from './lib/tool-package.mjs'

function parseArgs(argv) {
  const out = { id: null, src: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') out.src = argv[++i]
    else if (!a.startsWith('--')) out.id = a
  }
  return out
}

function keyIdOf(privatePem) {
  const pub = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' })
  return sha256(pub).slice(0, 32)
}

function main() {
  const arg = parseArgs(process.argv.slice(2))
  const src = resolveToolSrc(arg)
  const manifestPath = join(src, MANIFEST_FILE)

  // 1. 规范化源 manifest：剔除旧签名，避免「签名覆盖签名自身」并让重复签名幂等
  const canonical = canonicalManifestText(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, canonical, 'utf8')

  // 取私钥：默认用 env；轮换时现场生成新密钥对
  let privatePem = process.env.SSHK_OFFICIAL_SIGNING_KEY
  const rotate = process.env.SSHK_ROTATE_SIGNING_KEY === '1'
  if (rotate) {
    const kp = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    privatePem = kp.privateKey
    console.log('🔄 轮换：已生成新密钥对，请将以下公钥登记进 packages/shared/src/trust.ts 的 OFFICIAL_PUBLIC_KEYS：')
    console.log('---NEW PUBLIC KEY---')
    process.stdout.write(kp.publicKey)
    console.log('---END---')
  } else if (!privatePem) {
    throw new Error('未设置环境变量 SSHK_OFFICIAL_SIGNING_KEY（官方 Ed25519 私钥 PEM）。轮换请设置 SSHK_ROTATE_SIGNING_KEY=1。')
  }

  const keyId = keyIdOf(privatePem)

  // 2. 其余文件哈希清单（排除 SIGNATURE / manifest 自身由 buildSignaturePayload 负责）
  const files = collectFiles(src)
    .filter((f) => f.rel !== SIGNATURE_FILE)
    .map((f) => ({ name: f.rel, sha256: sha256(readFileSync(f.full)) }))
  const payload = buildSignaturePayload(canonical, files)
  const value = cryptoSign(null, Buffer.from(payload, 'utf8'), privatePem).toString('base64')

  // 3. 写 SIGNATURE 文件（两行：keyId / base64）
  writeFileSync(join(src, SIGNATURE_FILE), `${keyId}\n${value}\n`, 'utf8')

  // 4. 回写 manifest.package.signature（契约要求；运行时验签会先把它剔除再复算）
  const manifest = JSON.parse(canonical)
  manifest.package = manifest.package ?? {}
  manifest.package.signature = { algorithm: 'ed25519', keyId, value }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log(`✅ 已签名 ${arg.id ?? src}`)
  console.log(`   源目录     : ${src}`)
  console.log(`   keyId      : ${keyId}`)
  console.log(`   签名算法   : ed25519`)
  console.log(`   纳入哈希   : ${files.filter((f) => f.name !== MANIFEST_FILE).length} 个文件（manifest 自身由原文覆盖）`)
  console.log('   下一步     : node scripts/pack-tool.mjs <id> 生成带签名的 .sshktool')
}

try {
  main()
} catch (err) {
  console.error('签名失败：', err.message)
  process.exit(1)
}
