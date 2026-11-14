#!/usr/bin/env node
/**
 * 工具包签名：node scripts/sign-tool.mjs <id> [--src <dir>]
 *
 * 私钥来源（详见 scripts/lib/signing-key.mjs，绝不入库）：
 *   env SSHK_OFFICIAL_SIGNING_KEY > 本机 ~/.sshk/official-signing-key.pem > SSHK_ROTATE_SIGNING_KEY=1 轮换
 *   三者都没有时执行 pnpm keys:init 初始化；换设备开发见 docs/05-release/官方签名密钥跨设备开发.md。
 *
 * 行为（口径统一由 scripts/lib/tool-package.mjs 提供，与运行时验签严格一致）：
 *   1. 读取源 manifest，先规范化并剔除旧的 package.signature（保证重复签名幂等，不把旧签名带进新签名对象）
 *   2. 签名对象 = 规范 manifest 原文 + '\n' + 其余文件（排除 manifest 自身与 SIGNATURE）的 name:sha256 排序清单
 *   3. 用私钥 Ed25519 签名，写两处：
 *      - <src>/SIGNATURE        （两行：keyId 换行 base64，安装器优先读取）
 *      - manifest.package.signature（契约要求 main 必带；兜底字段）
 *   4. 重跑 scripts/pack-tool.mjs <id> 即得到带签名的 .sshktool
 *
 * 轮换：SSHK_ROTATE_SIGNING_KEY=1 时生成全新密钥对、落盘新私钥，并打印新公钥 PEM 与 keyId，
 *   供登记进 packages/shared/src/official-keys.json（旧公钥保留，此前签发的包继续可信）。
 */
import { sign as cryptoSign } from 'node:crypto'
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
import { keyIdOf, publicPemOf, resolvePrivateKey } from './lib/signing-key.mjs'

function parseArgs(argv) {
  const out = { id: null, src: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') out.src = argv[++i]
    else if (!a.startsWith('--')) out.id = a
  }
  return out
}

function main() {
  const arg = parseArgs(process.argv.slice(2))
  const src = resolveToolSrc(arg)
  const manifestPath = join(src, MANIFEST_FILE)

  // 1. 规范化源 manifest：剔除旧签名，避免「签名覆盖签名自身」并让重复签名幂等
  const canonical = canonicalManifestText(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, canonical, 'utf8')

  // 2. 解析私钥（env / 本机用户级文件 / 轮换），轮换时把新公钥打印出来供登记
  const { privatePem, source, rotated } = resolvePrivateKey()
  const keyId = keyIdOf(privatePem)
  if (rotated) {
    console.log('🔄 已轮换密钥对，新私钥已落盘；请把以下公钥登记进 packages/shared/src/official-keys.json：')
    console.log('---NEW PUBLIC KEY---')
    process.stdout.write(publicPemOf(privatePem))
    console.log('---END---')
    console.log(`   keyId : ${keyId}`)
  }

  // 3. 其余文件哈希清单（排除 SIGNATURE / manifest 自身由 buildSignaturePayload 负责）
  const files = collectFiles(src)
    .filter((f) => f.rel !== SIGNATURE_FILE)
    .map((f) => ({ name: f.rel, sha256: sha256(readFileSync(f.full)) }))
  const payload = buildSignaturePayload(canonical, files)
  const value = cryptoSign(null, Buffer.from(payload, 'utf8'), privatePem).toString('base64')

  // 4. 写 SIGNATURE 文件（两行：keyId / base64）
  writeFileSync(join(src, SIGNATURE_FILE), `${keyId}\n${value}\n`, 'utf8')

  // 5. 回写 manifest.package.signature（契约要求；运行时验签会先把它剔除再复算）
  const manifest = JSON.parse(canonical)
  manifest.package = manifest.package ?? {}
  manifest.package.signature = { algorithm: 'ed25519', keyId, value }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log(`✅ 已签名 ${arg.id ?? src}`)
  console.log(`   源目录     : ${src}`)
  console.log(`   私钥来源   : ${source}`)
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
