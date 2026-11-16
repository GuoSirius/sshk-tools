#!/usr/bin/env node
/**
 * H4 门禁：computed 内禁止副作用（plans/03 §三）。
 * computed 必须是纯求值：加载/请求一律 watch(source, immediate) + loading/failed 状态。
 * 扫描 renderer 相关源码（apps / tools / packages 的 .vue 与 .ts，跳过测试），
 * 对每个 computed(...) 块做括号配平后检查是否含 await / .then( / async 回调。
 * 存量 2026-11-16 已清零；本脚本防回潮。ESLint vue 插件待用户装包后可替换。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['apps/desktop/src', 'packages', 'tools']
const COMPUTED_HEAD = /computed(?:<[^>()]*>)?\s*\(/g
const SIDE_EFFECT = [/\bawait\b/, /\.then\s*\(/, /\basync\s*(?:\(|[^)=]*=>)/]

const offenders = []

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.test.ts')) yield full
  }
}

function check(file, src) {
  for (const m of src.matchAll(COMPUTED_HEAD)) {
    // 括号配平找 computed 块终点（computed 函数体）
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      i += 1
    }
    if (depth !== 0) continue
    const body = src.slice(m.index, i)
    const hit = SIDE_EFFECT.find((re) => re.test(body))
    if (hit) offenders.push(`${file}: computed 含副作用（${hit.source}），请改 watch + 状态位（plans/03 H4）`)
  }
}

for (const base of SCAN_DIRS) {
  const dir = join(ROOT, base)
  try { statSync(dir) } catch { continue }
  for (const file of walk(dir)) check(file.replace(ROOT + '\\', '').replace(ROOT + '/', ''), readFileSync(file, 'utf8'))
}

console.log('computed 副作用检查（H4：computed 必须纯求值，加载走 watch + 状态位）')
if (offenders.length > 0) {
  for (const line of offenders) console.log('  ✗ ' + line)
  console.log('  结论     : 不通过')
  process.exit(1)
}
console.log('  扫描范围 : apps/desktop/src · packages/* · tools/*（.vue/.ts，跳过测试）')
console.log('  结论     : 通过（存量清零，无副作用 computed）')
