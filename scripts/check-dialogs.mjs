#!/usr/bin/env node
/**
 * 弹框行为门禁（零依赖）。
 *
 * 统一规则：所有 el-dialog / el-drawer 禁止点遮罩或按 ESC 关闭，
 * 必须由用户主动点关闭 / 取消按钮，或业务操作成功后由代码关闭。
 * 新增弹框若漏配，开发期即以非零退出报错，而不是等用户点出来才发现。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', '.tmp', 'dist', 'out', 'coverage'])

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

const files = ['apps', 'tools', 'packages'].flatMap((d) => walk(join(ROOT, d)))
const errors = []
let dialogCount = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // opening tag 可能跨行；属性值中不含 '>'，到第一个 '>' 即为标签结束
  for (const match of text.matchAll(/<(el-dialog|el-drawer)\b[\s\S]*?>/g)) {
    dialogCount += 1
    const tag = match[0]
    const line = text.slice(0, match.index).split('\n').length
    const where = `${relative(ROOT, file)}:${line}`
    if (!/close-on-click-modal="false"/.test(tag)) {
      errors.push(`${where} <${match[1]}> 未禁用点击遮罩关闭`)
    }
    if (!/close-on-press-escape="false"/.test(tag)) {
      errors.push(`${where} <${match[1]}> 未禁用 ESC 关闭`)
    }
  }
}

console.log('弹框行为检查（禁遮罩 / 禁 ESC，主动按钮或成功动作才关闭）')
console.log(`  扫描 .vue 文件   : ${files.length}`)
console.log(`  检查弹框         : ${dialogCount}`)
if (errors.length) {
  console.error('\n发现违规：')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
if (dialogCount === 0) {
  console.error('未扫描到任何弹框，检查脚本是否失效')
  process.exit(1)
}
console.log('  结论             : 通过')
