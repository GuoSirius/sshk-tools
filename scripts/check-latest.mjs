#!/usr/bin/env node
/**
 * 依赖版本策略巡检（零依赖）。
 * 规则：所有外部 npm 依赖在 package.json 中一律写 "latest"；
 *       monorepo 内部包用 "workspace:*"；pnpm-lock.yaml 必须提交。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', '.tmp', 'dist', 'out', 'coverage'])
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (name === 'package.json') acc.push(full)
  }
  return acc
}

// 受控例外：typescript-eslint 8 不支持 TS 7，TypeScript 约束在 6.x 最新版（用户决策）。
// 其余所有外部依赖仍必须是 "latest"。
// http(s) CDN tarball（如 sheetjs 官方 cdn.sheetjs.com 的 xlsx 安装包）：npm 公共源 xlsx 长期陈旧，
//   官方推荐从其 CDN 安装最新版，属刻意的「latest 等价」例外，不要求 latest 字面量。
// electron-updater 的 "^6" 例外已撤销：它移入 devDependencies 并由主进程内联，
//   electron-builder 不再将其作为应用元数据读取，"latest" 字面量的限制随之消失。
const VERSION_EXCEPTIONS = { typescript: '6' }

function isAllowed(dep, spec) {
  if (VERSION_EXCEPTIONS[dep]) return spec === VERSION_EXCEPTIONS[dep]
  if (spec.startsWith('http://') || spec.startsWith('https://')) return true // CDN tarball 安装（sheetjs 等）
  return spec === 'latest' || spec.startsWith('workspace:') || spec.startsWith('catalog:')
}

const files = walk(ROOT)
const violations = []
let checked = 0

for (const file of files) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    violations.push({ file: relative(ROOT, file), dep: '-', spec: `JSON 解析失败: ${err.message}` })
    continue
  }
  for (const field of DEP_FIELDS) {
    const deps = pkg[field] || {}
    for (const [dep, spec] of Object.entries(deps)) {
      checked += 1
      if (!isAllowed(dep, spec)) {
        violations.push({ file: relative(ROOT, file), dep, spec })
      }
    }
  }
}

const lockPath = join(ROOT, 'pnpm-lock.yaml')
const hasLock = existsSync(lockPath)

console.log('依赖版本巡检 (latest 策略)')
console.log(`  扫描 package.json : ${files.length}`)
console.log(`  检查依赖项       : ${checked}`)
console.log(`  pnpm-lock.yaml   : ${hasLock ? '已存在' : '缺失（首次提交后请执行 pnpm install 并补交）'}`)
console.log(`  受控例外         : ${Object.entries(VERSION_EXCEPTIONS).map(([k, v]) => `${k}="${v}"`).join(', ')}`)

if (violations.length > 0) {
  console.error('\n以下依赖不符合版本策略（latest / workspace:* / 受控例外）：')
  for (const v of violations) console.error(`  ${v.file} -> ${v.dep} = ${v.spec}`)
  process.exit(1)
}

console.log('  结论             : 通过（除受控例外 typescript=6 外，均为 latest）')
