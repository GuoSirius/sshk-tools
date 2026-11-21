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
let messageBoxCount = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // opening tag 可能跨行，且属性值里可能含 '>'（如模板三元表达式）——引号感知扫描到真正的标签结束
  for (const match of matchOpeningTags(text)) {
    dialogCount += 1
    const { tag, index, kind } = match
    const line = text.slice(0, index).split('\n').length
    const where = `${relative(ROOT, file)}:${line}`
    if (!/close-on-click-modal="false"/.test(tag)) {
      errors.push(`${where} <${kind}> 未禁用点击遮罩关闭`)
    }
    if (!/close-on-press-escape="false"/.test(tag)) {
      errors.push(`${where} <${kind}> 未禁用 ESC 关闭`)
    }
  }
  // Q-21（P0-7 补强）：ElMessageBox.confirm 同守两禁——简单确认走 MessageBox，漏配禁遮罩/ESC 会误触取消
  for (const match of text.matchAll(/ElMessageBox\.confirm\s*\(/g)) {
    messageBoxCount += 1
    const line = text.slice(0, match.index).split('\n').length
    const where = `${relative(ROOT, file)}:${line}`
    // 抓取调用后 600 字符窗口（足以覆盖 options 对象；跨行 options 也在其中）
    const window = text.slice(match.index, match.index + 600)
    if (!/closeOnClickModal\s*:\s*false/.test(window)) {
      errors.push(`${where} ElMessageBox.confirm 未配 closeOnClickModal: false`)
    }
    if (!/closeOnPressEscape\s*:\s*false/.test(window)) {
      errors.push(`${where} ElMessageBox.confirm 未配 closeOnPressEscape: false`)
    }
  }
}

/** 引号感知的开标签匹配：跳过 ' 与 " 字面量内部的 '>'，避免属性值三元表达式截断 */
function matchOpeningTags(text) {
  const out = []
  const re = /<(el-dialog|el-drawer)\b/g
  for (const m of text.matchAll(re)) {
    let i = m.index + m[0].length
    let quote = ''
    while (i < text.length) {
      const c = text[i]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      i++
    }
    out.push({ tag: text.slice(m.index, i + 1), index: m.index, kind: m[1] })
  }
  return out
}

console.log('弹框行为检查（禁遮罩 / 禁 ESC，主动按钮或成功动作才关闭）')
console.log(`  扫描 .vue 文件   : ${files.length}`)
console.log(`  检查弹框         : ${dialogCount}`)
console.log(`  ElMessageBox.confirm : ${messageBoxCount}（Q-21 补强：选项守门）`)
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
