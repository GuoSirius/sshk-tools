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

function compareSemver(a, b) {
  const pa = a.split(/[.-]/).map((x) => Number.isFinite(Number(x)) ? Number(x) : x)
  const pb = b.split(/[.-]/).map((x) => Number.isFinite(Number(x)) ? Number(x) : x)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return String(pa[3] ?? '').localeCompare(String(pb[3] ?? ''))
}

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

// 3. 时间规范：业务源码不得出现 UTC 序列化 / toLocale* / Date.parse（P0-3 扩展）
const forbiddenList = ['toISOString(', 'toLocaleString(', 'toLocaleDateString(', 'toLocaleTimeString(', 'Date.parse(']
for (const file of all.filter((f) => /\.(ts|tsx|mjs|js|vue)$/.test(f))) {
  const rel = relative(ROOT, file)
  if (!['apps', 'packages', 'tools'].includes(rel.split(sep)[0])) continue
  srcCount += 1
  const content = readFileSync(file, 'utf8')
  for (const forbidden of forbiddenList) {
    if (content.includes(forbidden)) {
      errors.push(`时间规范违规 ${rel}: 禁止 ${forbidden}，请使用 @sshk/shared 的 time.ts（数字千分位用 Intl.NumberFormat）`)
    }
  }
}

// 3a-1. 产物文件名字面量禁令（CR-23 A案 · P0-7）：文件名契约唯一真相源 = shared/constants.ts
{
  const literals = [
    /(['"])assembled\.html/, /(['"])inlined\.html/, /(['"])final\.html/,
    /(['"])badged\.html/, /(['"])poster\.png/,
  ]
  for (const file of all.filter((f) => /\.(ts|tsx|vue)$/.test(f))) {
    const rel = relative(ROOT, file)
    if (!['apps', 'packages', 'tools'].includes(rel.split(sep)[0])) continue
    if (rel.includes('constants.ts')) continue
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.vue')) continue
    const content = readFileSync(file, 'utf8')
    for (const re of literals) {
      if (re.test(content)) errors.push(`产物文件名字面量违规 ${rel}: 命中 ${re} —— 请 import @sshk/shared 的 EDM_OUTPUT_FILES / POSTER_OUTPUT_FILES`)
    }
  }
}

// 3a-2. verify-steps 工具 id 合法性门禁（CR-25④ · P0-7）：target 工具 id 必须在册，改名漏改即红
{
  // 'share' = 局域网分享预览页（分享管理路由产物，非工具 id 但同为合法路由目标）
  // P4-8c（C-11）：file-manager/share-manager/model-manager = 应用模块 id（verify-steps 直达目标，
  // VerifyGuidePage 映射到应用管理页）；原 model-console 工具 id 已退役
  const KNOWN = new Set(['edm-studio', 'badge-studio', 'template-tool', 'model-manager', 'file-manager', 'share-manager', 'share'])
  const vsPath = join(ROOT, 'packages/shared/src/verify-steps.ts')
  if (existsSync(vsPath)) {
    const content = readFileSync(vsPath, 'utf8')
    for (const m of content.matchAll(/target: '([^']+)'/g)) {
      const t = m[1]
      // type: 'settings' 的 target 是设置抽屉分组名（常规/系统与数据/工具与权限），route 的 target 是工具 id
      const settingsNames = new Set(['常规', '系统与数据', '工具与权限', '分享服务', '关于应用', '常规设置'])
      if (!KNOWN.has(t) && !settingsNames.has(t) && !t.startsWith('app.') && !t.startsWith('tools.')) {
        errors.push(`verify-steps target 违规：'${t}' 不是在册工具 id 也非设置键（KNOWN 白名单见 verify-structure.mjs）`)
      }
    }
  }
}

// 3a-3. CHANGELOG 结构校验（P0-7）：release 流程产物结构守门，AI 手写/顺序破坏即红
{
  const clPath = join(ROOT, 'CHANGELOG.md')
  if (existsSync(clPath)) {
    const cl = readFileSync(clPath, 'utf8')
    const lines = cl.split('\n')
    if (!/^# Changelog/.test(lines[0] ?? '')) errors.push('CHANGELOG.md 首行必须是 "# Changelog"（release 流程产物结构）')
    const versions = [...cl.matchAll(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/gm)].map((m) => m[1])
    for (let i = 1; i < versions.length; i++) {
      const cmp = compareSemver(versions[i], versions[i - 1])
      if (cmp >= 0) errors.push(`CHANGELOG.md 版本顺序违规：${versions[i]} 应早于（小于）${versions[i - 1]}`)
    }
    const dup = versions.find((v, i) => versions.indexOf(v) !== i)
    if (dup) errors.push(`CHANGELOG.md 重复版本段：${dup}`)
  }
}

// 3b. dev 判据唯一化（P0-1 · D55）：electron.vite.config.ts 必须三端注入 __SSHK_DEV__，
// shared 必须保有唯一消费形态 SSHK_DEV；业务源码禁止 !app.isPackaged 判 dev
{
  const viteCfg = join(ROOT, 'apps/desktop/electron.vite.config.ts')
  if (!existsSync(viteCfg)) {
    errors.push('缺少 apps/desktop/electron.vite.config.ts')
  } else {
    const cfg = readFileSync(viteCfg, 'utf8')
    if (!cfg.includes('__SSHK_DEV__')) errors.push('dev 判据唯一化违规：electron.vite.config.ts 未注入 __SSHK_DEV__')
    for (const layer of ['main', 'preload', 'renderer']) {
      const re = new RegExp(`${layer}:\\s*\\{[\\s\\S]*?define:\\s*\\{[^}]*DEV_DEFINE`)
      if (!re.test(cfg)) errors.push(`dev 判据唯一化违规：electron.vite.config.ts ${layer} 端 define 未含 __SSHK_DEV__（DEV_DEFINE）`)
    }
  }
  if (!existsSync(join(ROOT, 'packages/shared/src/dev-flag.ts'))) {
    errors.push('缺少 packages/shared/src/dev-flag.ts（SSHK_DEV 唯一真相源）')
  }
}

// 4. 关键文件与配置一致性
const required = [
  'README.md', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
  'eslint.config.js', 'commitlint.config.js', '.gitignore',
  'docs/00-index.md', 'docs/02-architecture/2026-11-12-技术选型与任务拆分.md',
  'docs/04-api/2026-11-12-数据契约.md',
  'packages/shared/package.json', 'packages/shared/src/time.ts',
  'packages/shared/src/dev-flag.ts',
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
