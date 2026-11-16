#!/usr/bin/env node
/**
 * H1 门禁：主进程禁止新增裸 ipcMain.handle（plans/03 §一）。
 * 一律走 ipc-wrap 的 handleOk（宿主注册）或 wrapIpcHandler（代理层），
 * 保证全仓 IPC 零 reject——预期内业务失败统一 resolve 结构化 IpcResult。
 *
 * 豁免（均为包装层实现本身，不允许业务 handler 直接出现）：
 *   - ipc-wrap.ts   handleOk/wrapIpcHandler 实现
 *   - plugins.ts    guardedIpcMain / onRegister / rejectAll（注册动作本身，handler 已全部经 wrapIpcHandler 包装）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_DIR = join(ROOT, 'apps/desktop/src/main')
const ALLOW_FILES = new Set(['ipc-wrap.ts', 'plugins.ts'])
const BARE = /ipcMain\s*\.\s*handle\s*\(/

const offenders = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) { walk(full); continue }
    if (!/\.(ts|mts|js|mjs)$/.test(name) || name.endsWith('.test.ts')) continue
    if (ALLOW_FILES.has(name)) continue
    const src = readFileSync(full, 'utf8')
    if (BARE.test(src)) offenders.push(`${full.replace(ROOT + '\\', '').replace(ROOT + '/', '')} 含裸 ipcMain.handle`)
  }
}

walk(MAIN_DIR)

console.log('IPC 裸调检查（H1：主进程 handler 一律 handleOk / wrapIpcHandler，永不 reject）')
if (offenders.length > 0) {
  for (const line of offenders) console.log('  ✗ ' + line)
  console.log('  豁免文件：', [...ALLOW_FILES].join('、'))
  console.log('  结论     : 不通过（禁止新增裸 ipcMain.handle）')
  process.exit(1)
}
console.log('  扫描目录 : apps/desktop/src/main（豁免 ipc-wrap.ts / plugins.ts 包装层）')
console.log('  结论     : 通过（无业务裸 handler）')
