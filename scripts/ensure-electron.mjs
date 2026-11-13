#!/usr/bin/env node
/**
 * 确保 Electron 二进制存在（根 package.json 的 postinstall 钩子）。
 * 背景：pnpm 对已装包默认不重跑构建脚本；新增依赖触发重链接后 electron/dist 会被清空，
 * 导致 `pnpm dev` 报 spawn ENOENT。此脚本幂等：二进制在则直接通过。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const candidates = []

// 1) workspace 各包作用域下的 electron（symlink 目标才是真实目录）
try {
  const require = (await import('node:module')).createRequire(join(root, 'apps/desktop/package.json'))
  candidates.push(dirname(require.resolve('electron/package.json')))
} catch { /* electron 未安装则跳过 */ }

// 2) .pnpm 存储里的全部 electron 实例
import { readdirSync } from 'node:fs'
const pnpmDir = join(root, 'node_modules/.pnpm')
if (existsSync(pnpmDir)) {
  for (const name of readdirSync(pnpmDir)) {
    if (/^electron@\d/.test(name)) candidates.push(join(pnpmDir, name, 'node_modules/electron'))
  }
}

// Electron 二进制布局按平台不同：mac 是 Electron.app 包，不是 dist/electron
// （曾因只查 dist/electron 在 mac 上误判缺失，install.js 成功也报失败）
const exeCandidates = {
  win32: ['dist/electron.exe'],
  darwin: ['dist/Electron.app/Contents/MacOS/Electron', 'dist/Electron.app'],
  linux: ['dist/electron'],
}[process.platform] ?? ['dist/electron']

let checked = 0
let repaired = 0

for (const dir of [...new Set(candidates)]) {
  if (!existsSync(dir)) continue
  checked += 1
  if (exeCandidates.some((rel) => existsSync(join(dir, rel)))) continue

  console.log(`[ensure-electron] 缺失二进制，开始下载: ${dir}`)
  // 注意：Windows 下从工具进程 spawn 必须 pipe 输出，stdio:'inherit' 会 EBUSY
  const res = spawnSync(process.execPath, [join(dir, 'install.js')], {
    cwd: dir,
    encoding: 'utf8',
    // 默认 npmmirror（国内可达）；可用根目录 .env 的 ELECTRON_MIRROR 覆盖
    env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' },
    timeout: 10 * 60_000,
  })
  if (res.status === 0 && exeCandidates.some((rel) => existsSync(join(dir, rel)))) {
    repaired += 1
    console.log('[ensure-electron] 下载完成')
  } else {
    const tail = (res.stdout ?? '').split('\n').slice(-3).join('\n')
    const errTail = (res.stderr ?? '').split('\n').slice(-3).join('\n')
    console.error(`[ensure-electron] 下载失败（exit ${res.status}）\n${tail}${errTail}`)
    console.error(`  手动执行：ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node ${join(dir, 'install.js')}`)
    process.exitCode = 1
  }
}

if (checked > 0) {
  console.log(`[ensure-electron] 检查 ${checked} 个 electron 实例，修复 ${repaired} 个`)
}
