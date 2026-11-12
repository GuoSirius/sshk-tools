#!/usr/bin/env node
/**
 * M0 骨架结构校验（零依赖，不需要安装 npm 包即可运行）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', '.tmp', 'dist', 'out', 'coverage'])
const errors = []
const warnings = []
let jsonCount = 0
let jsCount = 0
let srcCount = 0

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

const all = walk(ROOT)

// 1. 所有 JSON 可解析
for (const file of all.filter((f) => f.endsWith('.json'))) {
  jsonCount += 1
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // 模块规范：ESM 优先，所有包必须声明 type: module
    if (file.endsWith('package.json') && parsed.type !== 'module') {
      errors.push(`模块规范违规 ${relative(ROOT, file)}: 必须声明 "type": "module"（ESM 优先）`)
    }
  } catch (err) {
    errors.push(`JSON 解析失败 ${relative(ROOT, file)}: ${err.message}`)
  }
}

// 2. 所有 JS/MJS/CJS 语法可过
for (const file of all.filter((f) => /\.(mjs|cjs|js)$/.test(f))) {
  jsCount += 1
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (res.status !== 0) errors.push(`语法检查失败 ${relative(ROOT, file)}: ${res.stderr.trim()}`)
}

// 3. 时间规范：业务源码不得出现 UTC 序列化
const forbidden = 'toISOString('
for (const file of all.filter((f) => /\.(ts|tsx|mjs|js|vue)$/.test(f))) {
  const rel = relative(ROOT, file)
  if (!['apps', 'packages', 'tools'].includes(rel.split(sep)[0])) continue
  srcCount += 1
  if (readFileSync(file, 'utf8').includes(forbidden)) {
    errors.push(`时间规范违规 ${rel}: 禁止 ${forbidden}，请使用 @sshk/shared 的 time.ts`)
  }
}

// 4. 关键文件与配置一致性
const required = [
  'README.md', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
  'eslint.config.js', 'commitlint.config.js', '.gitignore',
  'docs/00-index.md', 'docs/02-architecture/2026-11-12-技术选型与任务拆分.md',
  'docs/04-api/2026-11-12-数据契约.md',
  'packages/shared/package.json', 'packages/shared/src/time.ts',
  '.github/workflows/ci.yml',
]
for (const rel of required) {
  if (!existsSync(join(ROOT, rel))) errors.push(`缺少关键文件 ${rel}`)
}

const gitignore = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : ''
if (/^\s*pnpm-lock\.yaml\s*$/m.test(gitignore)) {
  errors.push('.gitignore 不得忽略 pnpm-lock.yaml（lockfile 必须提交）')
}

if (!existsSync(join(ROOT, 'pnpm-lock.yaml'))) {
  warnings.push('pnpm-lock.yaml 尚未生成：请在本机执行 pnpm install 后提交（AI 不代跑安装）')
}

console.log('M0 骨架结构校验')
console.log(`  JSON 文件   : ${jsonCount}`)
console.log(`  JS 语法检查 : ${jsCount}`)
console.log(`  业务源码    : ${srcCount}`)
for (const w of warnings) console.log(`  ⚠ ${w}`)

if (errors.length > 0) {
  console.error('\n发现问题：')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log('  结论        : 通过')
