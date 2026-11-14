#!/usr/bin/env node
/**
 * 本地构建测试专用脚本（Windows）。
 *
 * 用法（根目录执行）：
 *   pnpm local            # 构建 NSIS 安装包（x64）→ dist/*.exe（仓库根）
 *   pnpm local -- --dir   # 快速模式：只出免安装目录 win-unpacked（不发安装包）
 *   pnpm local -- --run   # 构建完成后直接启动安装包 / 免安装 exe
 *
 * 已内置国内镜像（electron-builder 二进制 + electron），无需科学上网。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const desktop = join(root, 'apps/desktop')
// 安装包产物落到仓库根 dist/（electron-builder.yml directories.output: ../../dist）
const outDir = join(root, 'dist')
const args = process.argv.slice(2)
const fast = args.includes('--dir')
const runAfter = args.includes('--run')

// 默认镜像/TLS 兜底，但必须允许 .env / 真实环境变量覆盖，否则 .env.example 里的声明就成了「配了也不生效」的僵尸 env
const MIRRORS = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  NODE_USE_SYSTEM_CA: process.env.NODE_USE_SYSTEM_CA || '1',
  // 仅本地构建：公司网络/安全软件的 TLS 中间链会导致 "unable to verify the first certificate"
  NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0',
}

const PM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function step(name, cmd, opts = {}) {
  console.log(`\n▶ ${name}`)
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: opts.cwd ?? root,
    env: opts.env ?? MIRRORS,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: opts.timeout ?? 15 * 60_000,
    // Node 22 起 spawn .cmd 必须 shell:true（否则 exit null）
    shell: opts.shell ?? process.platform === 'win32',
  })
  if (res.stdout?.trim()) console.log(res.stdout.trim().split('\n').slice(-6).join('\n'))
  if (res.stderr?.trim() && res.status !== 0) {
    console.error(res.stderr.trim().split('\n').slice(-10).join('\n'))
  }
  if (res.status !== 0) {
    console.error(`\n✗ ${name} 失败（exit ${res.status}）`)
    process.exit(res.status ?? 1)
  }
  console.log(`✓ ${name} 完成`)
}

// ① 确保 electron 二进制在位（避免 spawn ENOENT）
step('检查 Electron 二进制', [process.execPath, join(root, 'scripts/ensure-electron.mjs')], { timeout: 10 * 60_000 })

// ② 三端构建（main / preload / renderer → out/）
step('electron-vite 构建', [PM, '--filter', '@sshk/desktop', 'build'], { timeout: 5 * 60_000 })

// ③ 打包：--dir 出免安装目录；默认出 NSIS 安装包（仅 x64，arm64 本地测试不需要）
const builderArgs = fast
  ? ['--dir']
  : ['--win', 'nsis:x64', '--publish', 'never']
step(
  fast ? 'electron-builder 打包（免安装目录）' : 'electron-builder 打包（NSIS 安装包）',
  [PM, '--filter', '@sshk/desktop', 'exec', 'electron-builder', ...builderArgs],
  { cwd: desktop, timeout: 20 * 60_000 },
)

// ④ 列出产物
function listArtifacts(dir, depth = 0) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory() && name !== 'win-unpacked') out.push(...listArtifacts(full, depth + 1))
    else if (st.isFile()) out.push({ full, sizeMB: (st.size / 1024 / 1024).toFixed(1) })
  }
  return out
}

const artifacts = listArtifacts(outDir).filter((a) => a.sizeMB > 1 || a.full.endsWith('.exe'))
// --dir 模式：免安装目录本身是产物
const unpackedExe = join(outDir, 'win-unpacked', 'sshk-tools.exe')
if (fast && existsSync(unpackedExe)) {
  artifacts.unshift({ full: unpackedExe, sizeMB: (statSync(unpackedExe).size / 1024 / 1024).toFixed(1) })
}
console.log('\n📦 产物清单（dist/）：')
for (const a of artifacts) console.log(`  ${(a.sizeMB + ' MB').padStart(9)}  ${a.full}`)
if (artifacts.length === 0) console.log('  （无）')

// ⑤ 可选：直接启动
if (runAfter) {
  const installer = artifacts.find((a) => a.full.endsWith('-setup.exe') || (a.full.endsWith('.exe') && !a.full.includes('unpacked')))
  const target = fast
    ? join(outDir, 'win-unpacked', 'sshk-tools.exe')
    : installer?.full
  if (target && existsSync(target)) {
    console.log(`\n▶ 启动 ${target}`)
    spawnSync('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' })
  } else {
    console.log('\n未找到可启动的 exe')
  }
}

console.log('\n✅ 本地构建完成。安装包可直接双击安装测试（允许选择安装目录）。')
