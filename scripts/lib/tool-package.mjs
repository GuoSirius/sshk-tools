#!/usr/bin/env node
/**
 * 工具包分发链路的唯一口径模块（sign-tool / pack-tool / check-signature 共用）。
 *
 * 关键：签名对象必须与运行时 apps/desktop/src/main/runtime-installer.ts 的 verifySignature
 * 完全一致，否则「签出来的包运行时验不过」。规范定义在 packages/shared/src/trust.ts：
 *
 *   canonicalManifestText(raw) = JSON.parse 后删除 package.signature，再 JSON.stringify(obj, null, 2) + '\n'
 *   payload = canonicalManifestText + '\n' + 其余文件（排除 manifest 自身与 SIGNATURE）的 name:sha256 排序清单
 *
 * 为什么排除 manifest 自身的哈希、且要剔除 package.signature：
 *   签名值最终会被写回 manifest.package.signature，若 manifest 参与哈希清单或原文含签名值，
 *   就构成「签名覆盖签名自身」的循环依赖，数学上永远验不过。
 *   manifest 已由 payload 第一行原文整体覆盖，再列一次哈希只是冗余。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const MANIFEST_FILE = 'tool.manifest.json'
export const SIGNATURE_FILE = 'SIGNATURE'
/** 不随包分发的目录（源码 / 依赖 / 临时产物） */
export const EXCLUDES = new Set(['node_modules', '.git', '.tmp', 'coverage', 'src', 'scripts'])
export const isDeniedFile = (name) => name.startsWith('.') || name.endsWith('.log')

/**
 * 解析工具源目录。
 *  - --src 显式指定优先
 *  - 否则优先 examples/<id>：打包/签名语义上只针对「外部分发包」，内置 tools/<id> 不该被打成 .sshktool
 *  - 内置与外部同名（如 template-tool）时打印提示，避免误签内置版
 */
export function resolveToolSrc(arg) {
  if (arg.src) return resolve(ROOT, arg.src)
  const id = arg.id
  if (!id) throw new Error('用法：node scripts/<script>.mjs <id> [--src <dir>]')
  const candidates = [`examples/${id}`, `tools/${id}`]
  for (const base of candidates) {
    const dir = join(ROOT, base)
    if (!existsSync(join(dir, MANIFEST_FILE))) continue
    const other = candidates.find((b) => b !== base && existsSync(join(ROOT, b, MANIFEST_FILE)))
    if (other) {
      console.log(`ℹ️ 检出同名内置/外部工具（${base} / ${other}），按分发包语义选用 ${base}；需指定其他目录请加 --src`)
    }
    return dir
  }
  throw new Error(`未找到工具 ${id}（期望 examples/${id}/ 或 tools/${id}/ 下有 ${MANIFEST_FILE}）`)
}

/** 递归收集待分发文件；与 sign-tool / pack-tool / runtime-installer 的文件口径一致 */
export function collectFiles(dir, base = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    if (EXCLUDES.has(name) || isDeniedFile(name)) continue
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectFiles(full, rel))
    else out.push({ rel, full })
  }
  return out
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 规范 manifest 文本：剔除 package.signature（签名值本身），统一 2 空格缩进 + 末尾换行 */
export function canonicalManifestText(raw) {
  const obj = JSON.parse(raw)
  if (obj.package) delete obj.package.signature
  return JSON.stringify(obj, null, 2) + '\n'
}

/** 规范签名对象。files 只需传「除 manifest / SIGNATURE 之外」的文件；函数内再做一次防御性过滤 */
export function buildSignaturePayload(raw, files) {
  const covered = new Set([MANIFEST_FILE, SIGNATURE_FILE])
  const listed = files
    .filter((f) => !covered.has(f.name))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `${f.name}:${f.sha256}`)
  return [canonicalManifestText(raw), ...listed].join('\n')
}

export { dirname, join }
