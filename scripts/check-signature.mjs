#!/usr/bin/env node
/**
 * 分发包签名门禁：扫描 examples/*.sshktool，用「运行时同一口径」真实验签。
 *
 * 之所以需要这道闸：签名脚本与运行时验签各自实现，一旦口径漂移（例如签名对象把
 * manifest 自身哈希或 package.signature 算了进去），签出来的包在客户端会静默降级为
 * utility 沙箱甚至不可用，而字段级契约检查发现不了。
 *
 * 校验项：
 *   1. 包内必须有合法 tool.manifest.json
 *   2. 外部包必须有 dist/page.js 与 dist/main.js（拒绝不可安装的空壳包）
 *   3. 有 SIGNATURE → 用 OFFICIAL_PUBLIC_KEYS 验签，必须通过；keyId 必须匹配
 *   4. sandbox=main 但无 SIGNATURE → 拒绝
 *   5. 未签名 utility 包 → 合法，跳过验签
 */
import { createRequire } from 'node:module'
import { verify as cryptoVerify, createPublicKey } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  ROOT,
  MANIFEST_FILE,
  SIGNATURE_FILE,
  buildSignaturePayload,
  canonicalManifestText,
  sha256,
} from './lib/tool-package.mjs'

const req = createRequire(fileURLToPath(new URL('../apps/desktop/package.json', import.meta.url)))
const { unzipSync } = req('fflate')
const EXAMPLES = join(ROOT, 'examples')
const REQUIRED_DIST = ['dist/page.js', 'dist/main.js']

function officialKeys() {
  const src = readFileSync(join(ROOT, 'packages/shared/src/trust.ts'), 'utf8')
  const re = /keyId:\s*'([^']+)'[\s\S]*?pem:\s*`([^`]+)`/g
  const keys = []
  for (const m of src.matchAll(re)) keys.push({ keyId: m[1], pem: m[2].replace(/\n\s*/g, '\n') })
  if (!keys.length) throw new Error('解析 OFFICIAL_PUBLIC_KEYS 失败')
  return keys
}

function check(file) {
  const errors = []
  const entries = unzipSync(new Uint8Array(readFileSync(file)))
  const names = Object.keys(entries).filter((n) => entries[n] instanceof Uint8Array)
  const has = (n) => names.includes(n)

  if (!has(MANIFEST_FILE)) return [`缺少 ${MANIFEST_FILE}`]
  const manifestRaw = Buffer.from(entries[MANIFEST_FILE]).toString('utf8')
  let manifest
  try { manifest = JSON.parse(manifestRaw) } catch (e) { return [`${MANIFEST_FILE} 非法 JSON：${e.message}`] }

  if (manifest.plugin?.source === 'external') {
    for (const n of REQUIRED_DIST) if (!has(n)) errors.push(`外部包缺少运行时产物 ${n}`)
  }

  const sigEntry = has(SIGNATURE_FILE) ? Buffer.from(entries[SIGNATURE_FILE]).toString('utf8') : null
  if (sigEntry) {
    const [keyId, value] = sigEntry.trim().split(/\r?\n/)
    const key = officialKeys().find((k) => k.keyId === keyId)
    if (!key) errors.push(`SIGNATURE keyId ${keyId} 不在 OFFICIAL_PUBLIC_KEYS 中`)
    else {
      const files = names
        .filter((n) => n !== SIGNATURE_FILE && n !== MANIFEST_FILE)
        .map((name) => ({ name, sha256: sha256(Buffer.from(entries[name])) }))
      const payload = buildSignaturePayload(manifestRaw, files)
      let valid = false
      try {
        valid = cryptoVerify(null, Buffer.from(payload, 'utf8'), createPublicKey(key.pem), Buffer.from(value ?? '', 'base64'))
      } catch (e) { errors.push(`验签异常：${e.message}`) }
      if (!valid && !errors.length) errors.push('签名与内容不匹配（签名对象口径漂移或包被篡改）')
      if (manifest.package?.signature?.keyId && manifest.package.signature.keyId !== keyId) {
        errors.push('manifest.package.signature.keyId 与 SIGNATURE 文件不一致')
      }
    }
  } else if (manifest.package?.sandbox === 'main') {
    errors.push('申请 main 沙箱但包内没有 SIGNATURE')
  }

  return errors
}

function main() {
  const packs = readdirSync(EXAMPLES).filter((n) => n.endsWith('.sshktool')).sort()
  const errors = []
  console.log('分发包签名检查')
  console.log(`  扫描包数     : ${packs.length}`)
  for (const pack of packs) {
    const file = join(EXAMPLES, pack)
    const signed = unzipSync(new Uint8Array(readFileSync(file)))[SIGNATURE_FILE] ? '已签名' : '未签名(utility)'
    const errs = check(file)
    console.log(`  ${pack.padEnd(34)} ${signed.padEnd(16)} ${errs.length ? `❌ ${errs.length} 项` : '✅ 通过'}`)
    for (const e of errs) errors.push(`${pack}: ${e}`)
  }
  if (errors.length) {
    console.error('\n发现违规：')
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log('  结论         : 通过（规范签名对象：canonical manifest + 其余文件哈希清单）')
}

try { main() } catch (err) { console.error('签名检查失败：', err.message); process.exit(1) }
