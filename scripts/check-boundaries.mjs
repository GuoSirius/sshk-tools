#!/usr/bin/env node
/**
 * 分层依赖静态检查（零依赖）。
 * 依赖方向单向：apps -> tools -> packages，禁止反向与跨工具直接引用。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', '.tmp', 'dist', 'out', 'coverage', 'docs', 'scripts'])
const SRC_EXT = /\.(ts|tsx|js|mjs|cjs|vue)$/
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (SRC_EXT.test(name)) acc.push(full)
  }
  return acc
}

function layerOf(relPath) {
  const parts = relPath.split(sep)
  if (parts[0] === 'apps' || parts[0] === 'tools' || parts[0] === 'packages') return parts[0]
  return 'root'
}

function toolIdOf(relPath) {
  const parts = relPath.split(sep)
  return parts[0] === 'tools' ? parts[1] : null
}

function targetLayer(spec, fromLayer) {
  if (spec.startsWith('@sshk/')) return 'packages'
  if (spec.startsWith('tools/') || spec.includes('/tools/')) return 'tools'
  if (spec.startsWith('apps/') || spec.includes('/apps/')) return 'apps'
  if (spec.startsWith('packages/') || spec.includes('/packages/')) return 'packages'
  // 相对路径：以来源文件所在层为准，不跨层判定
  if (spec.startsWith('.')) return fromLayer
  return 'external'
}

const files = ['apps', 'tools', 'packages'].flatMap((d) => walk(join(ROOT, d)))
const violations = []
let importCount = 0

for (const file of files) {
  const rel = relative(ROOT, file)
  const fromLayer = layerOf(rel)
  const fromTool = toolIdOf(rel)
  const text = readFileSync(file, 'utf8')
  let match
  while ((match = IMPORT_RE.exec(text)) !== null) {
    const spec = match[1]
    importCount += 1
    const toLayer = targetLayer(spec, fromLayer)

    if (fromLayer === 'tools' && toLayer === 'tools') {
      const targetTool = spec.split('/').find((p, i, arr) => arr[i - 1] === 'tools')
      if (targetTool && targetTool !== fromTool) {
        violations.push({ file: rel, spec, reason: 'tools/* 禁止直接 import 另一个 tools/*' })
      }
    }
    if (fromLayer === 'packages' && (toLayer === 'apps' || toLayer === 'tools')) {
      violations.push({ file: rel, spec, reason: 'packages/* 禁止反向依赖 apps / tools' })
    }
  }
}

console.log('分层依赖检查 (apps -> tools -> packages 单向)')
console.log(`  扫描源码文件 : ${files.length}`)
console.log(`  检查 import  : ${importCount}`)

if (violations.length > 0) {
  console.error('\n发现违规引用：')
  for (const v of violations) console.error(`  ${v.file} -> ${v.spec}  [${v.reason}]`)
  process.exit(1)
}
console.log('  结论         : 通过')
