#!/usr/bin/env node
/**
 * 确保 Electron 二进制存在（根 package.json 的 postinstall 钩子）。
 * 背景：pnpm 对已装包默认不重跑构建脚本；新增依赖触发重链接后 electron/dist 会被清空，
 * 导致 `pnpm dev` 报 spawn ENOENT。此脚本幂等：二进制在则直接通过。
 *
 * 下载进度（2026-11-17 用户反馈）：不再静默跑 electron 自带 install.js（pipe 后全程无输出，
 * 用户分不清是网络慢还是卡死），改为临时 runner 直调 @electron/get downloadArtifact，
 * 注入 getProgressCallback 实时打印「已下载 x / y MB（z%）」；解压/校验/path.txt 语义与
 * install.js 保持一致（checksums + @electron-internal/extract-zip + path.txt）。
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
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

/** 与 electron install.js 等价、但带下载进度的 runner（CJS，require 从 electron 目录解析） */
function runnerSource(dir) {
  return `const path = require('node:path');
const fs = require('node:fs');
const { downloadArtifact } = require('@electron/get');

const dir = ${JSON.stringify(dir)};
const { version } = require(path.join(dir, 'package.json'));
const checksums = process.env.ELECTRON_USE_REMOTE_CHECKSUMS
  ? undefined
  : require(path.join(dir, 'checksums.json'));

function platformPathOf(platform) {
  switch (platform) {
    case 'mas': case 'darwin': return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd': case 'openbsd': case 'linux': return 'electron';
    case 'win32': return 'electron.exe';
    default: throw new Error('Electron builds are not available on platform: ' + platform);
  }
}
const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.platform;
const arch = process.env.ELECTRON_INSTALL_ARCH || process.arch;
const platformPath = platformPathOf(platform);

let lastLine = '';
let lastPrint = 0;
function report(p) {
  // 每个百分比只打一行 + 至少间隔 300ms，避免刷屏
  const pct = p.total ? Math.min(100, Math.round(p.percent * 100)) : -1;
  const now = Date.now();
  if (pct === lastPrint && p.total) return Promise.resolve();
  if (now - lastPrint < 300 && pct !== 100) return Promise.resolve();
  lastPrint = now;
  const mb = (p.transferred / 1048576).toFixed(1);
  const line = p.total
    ? \`[ensure-electron] 下载进度 \${mb} / \${(p.total / 1048576).toFixed(1)} MB（\${pct}%）\`
    : \`[ensure-electron] 已下载 \${mb} MB（总大小未知）\`;
  if (line !== lastLine) { lastLine = line; process.stderr.write(line + '\\n'); }
  return Promise.resolve();
}

downloadArtifact({
  version,
  artifactName: 'electron',
  force: process.env.ELECTRON_FORCE_NO_CACHE === 'true',
  cacheRoot: process.env.ELECTRON_CONFIG_CACHE || undefined,
  checksums,
  platform,
  arch,
  downloadOptions: { quiet: true, getProgressCallback: report },
})
  .then(async (zipPath) => {
    process.stderr.write('[ensure-electron] 下载完成，解压中…\\n');
    const { extract } = require('@electron-internal/extract-zip');
    const distPath = path.join(dir, 'dist');
    await extract(zipPath, { dir: distPath });
    const srcTypeDef = path.join(distPath, 'electron.d.ts');
    const targetTypeDef = path.join(dir, 'electron.d.ts');
    if (fs.existsSync(srcTypeDef)) fs.renameSync(srcTypeDef, targetTypeDef);
    await fs.promises.writeFile(path.join(dir, 'path.txt'), platformPath);
    process.stderr.write('[ensure-electron] 解压完成\\n');
  })
  .catch((err) => { console.error(err.stack || String(err)); process.exit(1); });
`
}

/** 异步执行 runner 并实时转发输出（spawnSync 的 pipe 要等子进程结束才可见，进度必须用异步 spawn） */
function runWithProgress(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderrTail = ''
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      process.stderr.write(text)
      stderrTail = (stderrTail + text).split('\n').slice(-5).join('\n')
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderrTail })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stderrTail: String(err) })
    })
  })
}

let checked = 0
let repaired = 0

for (const dir of [...new Set(candidates)]) {
  if (!existsSync(dir)) continue
  checked += 1
  if (exeCandidates.some((rel) => existsSync(join(dir, rel)))) continue

  console.log(`[ensure-electron] 缺失二进制，开始下载（ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'}）: ${dir}`)
  const runner = join(dir, '__ensure-electron-runner.cjs')
  writeFileSync(runner, runnerSource(dir), 'utf8')
  try {
    const { code, stderrTail } = await runWithProgress(process.execPath, [runner], dir, 15 * 60_000)
    if (code === 0 && exeCandidates.some((rel) => existsSync(join(dir, rel)))) {
      repaired += 1
      console.log('[ensure-electron] 下载完成')
    } else {
      console.error(`[ensure-electron] 下载失败（exit ${code}）\n${stderrTail}`)
      console.error(`  手动执行：ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node ${join(dir, 'install.js')}`)
      process.exitCode = 1
    }
  } finally {
    try { rmSync(runner, { force: true }) } catch { /* 清理失败不影响结果 */ }
  }
}

if (checked > 0) {
  console.log(`[ensure-electron] 检查 ${checked} 个 electron 实例，修复 ${repaired} 个`)
}
