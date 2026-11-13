#!/usr/bin/env node
/**
 * preload IPC 边界门禁（零依赖）。
 *
 * 背景：Vue 的 ref/reactive 是 Proxy，直接传给 ipcRenderer.invoke 会触发
 * "An object could not be cloned"。修复方案是在 preload 唯一出口用 toPlain()
 * 统一脱壳。这个门禁防止后续新增通道时有人绕过包装，把 bug 带回来：
 *   1) 文件里只允许出现一处 ipcRenderer.invoke，且必须就是 invoke 包装本身；
 *   2) 包装必须调用 toPlain；
 *   3) 所有 IPC 通道调用必须走 invoke(IPC_CHANNELS.xxx)，不得裸调。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const FILE = join(ROOT, 'apps/desktop/src/preload/index.ts')
const text = readFileSync(FILE, 'utf8')
const errors = []

const directInvokes = [...text.matchAll(/ipcRenderer\.invoke\s*\(/g)]
if (directInvokes.length !== 1) {
  errors.push(`ipcRenderer.invoke 应只出现 1 次（在统一包装内），实际 ${directInvokes.length} 次`)
}
const wrapper = text.match(/const invoke\s*=\s*\([\s\S]{0,300}?\n\s*ipcRenderer\.invoke\([^\n]*\)/)
if (!wrapper) {
  errors.push('未找到统一的 invoke 包装函数')
} else if (!/toPlain/.test(wrapper[0])) {
  errors.push('统一 invoke 包装未调用 toPlain()，响应式对象会再次触发克隆报错')
}

const channelCalls = [...text.matchAll(/invoke\s*\(\s*IPC_CHANNELS\.[A-Za-z0-9_]+/g)]
if (channelCalls.length < 10) {
  errors.push(`经统一包装的 IPC 通道数异常偏少（${channelCalls.length}），疑似漏接`)
}
if (!/contextBridge\.exposeInMainWorld\s*\(/.test(text)) {
  errors.push('缺少 contextBridge.exposeInMainWorld')
}

console.log('preload IPC 边界检查')
console.log(`  裸调 ipcRenderer.invoke : ${directInvokes.length}（应为 1）`)
console.log(`  统一包装的通道调用       : ${channelCalls.length}`)
if (errors.length) {
  console.error('\n发现违规：')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log('  结论                     : 通过（所有入参均经 toPlain 脱壳）')
