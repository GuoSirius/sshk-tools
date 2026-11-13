#!/usr/bin/env node
/**
 * release.mjs —— 发布 + changelog 完整流程（#39）。
 *
 * 流程（先构建后发布，杜绝发布后构建失败）：
 *   前置检验（git 干净 / main 且与远程同步 / pnpm verify 全绿）
 *   → 版本选择（方向键，实时预览 current → next）
 *   → changelog 预览 + 二次确认
 *   → bump 全部 package.json + 生成 CHANGELOG.md
 *   → pnpm build + electron-builder --publish never（出 latest.yml + exe 并验证）
 *   → chore(release) 提交 + 打 tag + 推送
 *   → 给出 GitHub Release 发布指引（body 只含本次版本段）
 *
 * 用法：pnpm release [--dry-run]
 *
 * 交互用 @inquirer/prompts（与 juice-cli 同款，本机终端长期验证箭头键可用）：
 * 曾用 @clack/prompts，其重绘实现在本机终端产生残影重复行（2026-11-13），
 * 同终端下 inquirer 一直正常 —— 问题在库不在终端，换库即根治。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DRY_RUN = process.argv.includes('--dry-run')
const BLUE = (t) => `\x1b[36m${t}\x1b[0m`
const RED = (t) => `\x1b[31m${t}\x1b[0m`
const GREEN = (t) => `\x1b[32m${t}\x1b[0m`
const DIM = (t) => `\x1b[2m${t}\x1b[0m`
const step = (msg) => console.log(`${BLUE('▸')} ${msg}`)
const ok = (msg) => console.log(`${GREEN('✔')} ${msg}`)
const die = (msg) => { console.error(`${RED('✖')} ${msg}`); process.exit(1) }

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: ROOT, ...opts }).trim()
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(win(cmd), args, { stdio: 'inherit', shell: process.platform === 'win32', cwd: ROOT, ...opts })
  if (r.status !== 0) die(`命令失败：${cmd} ${args.join(' ')}`)
}
function win(bin) { return process.platform === 'win32' ? `${bin}.cmd` : bin }

/* ── @inquirer/prompts：未安装给友好提示；Ctrl+C 优雅退出 ── */
let select, confirm, input
try {
  ;({ select, confirm, input } = await import('@inquirer/prompts'))
} catch {
  die('缺少交互依赖 @inquirer/prompts，请执行：pnpm install')
}
process.on('uncaughtException', (err) => {
  if (err?.name === 'ExitPromptError' || /User force closed/i.test(String(err?.message ?? ''))) {
    console.log('\n已取消')
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})

/* ── semver（零依赖） ── */
function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
  if (!m) die(`无法解析版本号: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] ?? '' }
}
function fmt(v, pre = '') { return `v${v.major}.${v.minor}.${v.patch}${pre ? `-${pre}` : ''}` }
function bump(v, kind, custom) {
  if (custom) {
    const raw = custom.replace(/^v/, '')
    parseSemver(raw)
    return `v${raw}`
  }
  if (kind === 'major') return fmt({ ...v, major: v.major + 1, minor: 0, patch: 0 })
  if (kind === 'minor') return fmt({ ...v, minor: v.minor + 1, patch: 0 })
  if (kind === 'patch') return fmt({ ...v, patch: v.patch + 1 })
  // beta：预发布号递增（含从正式版进入 -beta.1）
  const m = /^beta\.(\d+)$/.exec(v.prerelease)
  const n = v.prerelease ? (m ? +m[1] + 1 : 1) : 1
  const base = v.prerelease ? v : { ...v, patch: v.patch + 1 }
  return fmt(base, `beta.${n}`)
}

/* ── changelog：conventional commits → 本次版本段 ── */
const SECTIONS = [
  ['feat', '### ✨ Features'],
  ['fix', '### 🐛 Bug Fixes'],
  ['perf', '### ⚡ Performance'],
  ['refactor', '### ♻ Refactors'],
  ['docs', '### 📝 Docs'],
]
function collectCommits(from) {
  const range = from ? `${from}..HEAD` : 'HEAD'
  const raw = git(['log', range, '--pretty=%s']).split('\n').filter(Boolean)
  const groups = Object.fromEntries(SECTIONS.map(([t]) => [t, []]))
  const others = []
  for (const subject of raw) {
    const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject)
    const type = m?.[1] ?? ''
    const body = m?.[2] ?? subject
    if (groups[type]) groups[type].push(body)
    else others.push(subject)
  }
  let md = ''
  for (const [type, title] of SECTIONS) {
    if (groups[type].length === 0) continue
    md += `${title}\n${groups[type].map((s) => `- ${s}`).join('\n')}\n\n`
  }
  if (others.length) md += `### 🔧 Others\n${others.map((s) => `- ${s}`).join('\n')}\n\n`
  return { md, counts: groups, others }
}
function lastTag() {
  try { return git(['describe', '--tags', '--abbrev=0']) } catch { return '' }
}

/* ── 0. 前置检验 ── */
console.log(DRY_RUN ? '🚀 sshk-tools 发布（dry-run 预演）' : '🚀 sshk-tools 发布')

step('前置检验')
if (!existsSync(join(ROOT, '.git'))) die('不在 git 仓库根目录')
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') die(`必须在 main 分支发布，当前：${branch}`)
const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean)
if (dirty.length && !DRY_RUN) {
  console.error(RED('工作区有未提交变更：'))
  for (const line of dirty) console.error(`  ${line}`)
  die('请先提交或暂存（stash）后再发布')
}
git(['fetch', 'origin', 'main'])
const ahead = git(['rev-list', '--count', 'origin/main..HEAD'])
const behind = git(['rev-list', '--count', 'HEAD..origin/main'])
if (behind !== '0') die(`本地落后远程 ${behind} 个提交，请先 pull`)
ok(ahead === '0' ? '分支 main 与远程同步' : `本地领先 ${ahead} 个提交（将随本次发布一并推送）`)

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const current = parseSemver(rootPkg.version)
const tag = lastTag()
ok(`当前版本 ${current.prerelease ? DIM(current.prerelease) : GREEN(fmt(current))}${tag ? DIM(`（上个 tag：${tag}）`) : DIM('（无历史 tag，从首个提交起算）')}`)

if (!DRY_RUN) {
  step('pnpm verify（结构/分层/弹框/契约/typecheck/lint/test）')
  console.log(DIM('  运行中，预计 1-2 分钟，请稍候…'))
  const r = spawnSync(win('pnpm'), ['verify'], { stdio: 'inherit', shell: process.platform === 'win32', cwd: ROOT })
  if (r.status !== 0) die('pnpm verify 未通过，已中止')
  ok('门禁全绿')
}

/* ── 1. 版本选择（上下箭头 + 实时预览） ── */
let kind = 'patch'
if (!DRY_RUN) {
  kind = await select({
    message: `选择版本类型（当前 ${fmt(current)}）`,
    default: 'patch',
    choices: [
      { value: 'patch', name: `patch   ${fmt(current)} -> ${bump(current, 'patch')}` },
      { value: 'minor', name: `minor   ${fmt(current)} -> ${bump(current, 'minor')}` },
      { value: 'major', name: `major   ${fmt(current)} -> ${bump(current, 'major')}` },
      { value: 'beta', name: `beta    ${fmt(current)} -> ${bump(current, 'beta')}` },
      { value: 'custom', name: 'custom  自定义版本号' },
    ],
  })
  ok(`已选择 ${kind}`)
}
let next = bump(current, kind)
if (kind === 'custom') {
  const raw = DRY_RUN ? '' : await input({ message: '输入版本号（v 可省略）', default: fmt(current) })
  // 空输入回退当前版本，而不是误入 beta 分支
  next = bump(current, 'custom', String(raw || fmt(current)))
}
const nextSemver = next.replace(/^v/, '')

/* ── 2. changelog 预览 + 二次确认 ── */
step('生成本版本 changelog')
const { md, counts, others } = collectCommits(tag)
const featureCount = counts.feat.length + counts.fix.length + counts.perf.length
// changelog 全文不进控制台：分组计数即可，全文在 body 文件里看
const statLine = [
  counts.feat.length && `feat ${counts.feat.length}`,
  counts.fix.length && `fix ${counts.fix.length}`,
  counts.perf.length && `perf ${counts.perf.length}`,
  counts.refactor.length && `refactor ${counts.refactor.length}`,
  counts.docs.length && `docs ${counts.docs.length}`,
  others.length && `其他 ${others.length}`,
].filter(Boolean).join(' · ')
console.log(DIM(`  ${statLine || '（无提交）'}`))
if (!featureCount && !others.length) die('上个版本以来没有任何提交，无需发布')

const changedFiles = ['package.json', 'apps/desktop/package.json', 'CHANGELOG.md', 'pnpm-lock.yaml']
console.log(`\n${BLUE('发布预览')}`)
console.log(`  版本      : ${GREEN(fmt(current))} → ${GREEN(next)}`)
console.log(`  配置变更  : ${changedFiles.join('、')}（共 ${changedFiles.length} 个固定文件 + dist/* 产物）`)
if (!DRY_RUN) {
  const go = await confirm({ message: '确认按以上内容发布？', default: false })
  if (!go) die('已取消')
}

/* ── 3. bump + CHANGELOG.md ── */
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const entry = `## ${next} (${today})\n\n${md}`
step(`写入版本号 ${next} 与 CHANGELOG.md`)
if (!DRY_RUN) {
  const pkgPaths = ['package.json', 'apps/desktop/package.json']
  for (const rel of pkgPaths) {
    const f = join(ROOT, rel)
    const pkg = JSON.parse(readFileSync(f, 'utf8'))
    pkg.version = nextSemver
    writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`)
  }
  const clPath = join(ROOT, 'CHANGELOG.md')
  const old = existsSync(clPath) ? readFileSync(clPath, 'utf8') : '# Changelog\n\n'
  writeFileSync(clPath, `${old.replace(/^# Changelog\n\n?/, '# Changelog\n\n')}${entry}`)
  ok('版本号与 changelog 已写入')
} else {
  console.log(DIM(`  [dry-run] 将写入 ${changedFiles.join(' / ')}；CHANGELOG 顶部新增 ${next} 段`))
}

/* ── 4. 先构建：vite 产物 + electron-builder 打包 ── */
if (!DRY_RUN) {
  step('pnpm build（main / preload / renderer）')
  sh('pnpm', ['build'])
  step('electron-builder 打包（--publish never，先验证可出包）')
  // 公司网络 TLS 中间人：electron-builder 下载打包工具（NSIS/winCodeSign）时证书校验失败。
  // 按既定约定「证书非必须，绕过优先于阻断」：先试系统 CA（装了 MITM 根证书即可通过），
  // 并对打包子进程放宽 TLS 校验——仅作用于此子进程，不影响仓库其他命令。
  sh('pnpm', ['--filter', '@sshk/desktop', 'exec', 'electron-builder', '--publish', 'never'], {
    env: { ...process.env, NODE_USE_SYSTEM_CA: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  })
  const distDir = join(ROOT, 'dist')
  const artifacts = readdirSync(distDir).filter((f) => f.endsWith('.exe') || f === 'latest.yml')
  if (!artifacts.some((f) => f.endsWith('.exe')) || !artifacts.includes('latest.yml')) {
    die(`产物缺失（${artifacts.join(', ') || '空'}），已中止，未提交未推送`)
  }
  ok(`产物就绪：${artifacts.join(', ')}`)
}

/* ── 5. 提交 + tag + 推送 ── */
if (!DRY_RUN) {
  step('提交 release 与 tag')
  sh('git', ['add', 'package.json', 'apps/desktop/package.json', 'CHANGELOG.md', 'pnpm-lock.yaml'])
  sh('git', ['-c', 'core.hooksPath=.git/cph', 'commit', '-m', `chore(release): ${next}`])
  git(['tag', next])
  sh('git', ['push', 'origin', `HEAD:refs/heads/main`, next])
  ok(`已推送 ${next}（提交 + tag）`)
}

/* ── 6. GitHub Release 指引 ── */
// changelog 全文统一落盘预览：dry-run 用 -draft，正式发布用版本号命名
const bodyPath = join(ROOT, '.tmp', DRY_RUN ? 'release-body-draft.md' : `release-body-${nextSemver}.md`)
mkdirSync(join(ROOT, '.tmp'), { recursive: true })
writeFileSync(bodyPath, entry)
if (!DRY_RUN) {
  console.log(`\n${GREEN('🎉 发布流程完成')} —— 剩下最后一步，创建 GitHub Release（body 只含 ${next} 段）：`)
  if (process.env.GH_TOKEN) {
    console.log(`  检测到 GH_TOKEN：cd apps/desktop && pnpm exec electron-builder --publish always（自动建 Release 并上传产物）`)
  } else {
    console.log(`  1) 打开 https://github.com/GuoSirius/sshk-tools/releases/new?tag=${next}`)
  }
  console.log(`  2) 标题 ${next}；正文粘贴 ${bodyPath}（已只含本次版本段）`)
  console.log(`  3) 上传 dist/ 下的 *.exe 与 latest.yml`)
} else {
  console.log(`\ndry-run 完成：${fmt(current)} → ${next}；changelog 全文见 ${bodyPath}`)
}
