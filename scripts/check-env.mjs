#!/usr/bin/env node
/**
 * 环境变量双向契约门禁（约定参考 competitor-crawler::packages/crawler/src/envContract.test.ts）。
 *
 * 背景：`process.env.XXX` 的键是字符串，TypeScript / ESLint 都发现不了拼写错误；
 * 而 `.env.example` 里留着「声明了却根本没接线」的占位变量，会让开发者误以为配置生效。
 * 两者都是危险的僵尸配置。
 *
 * 约定：仓库根 `.env.example` 是环境变量的唯一真相源，双向校验：
 *   1. 源码读取的每个键 → 必须在 .env.example 声明（读而未声明 = 臆造 / 拼错）
 *   2. .env.example 声明的每个键 → 必须被源码读取（声明而未读 = 僵尸 env）
 *
 * 两类显式豁免（都要求写明理由，不接受隐式放行）：
 *   - EXTERNAL_KEYS：由运行环境 / 框架注入、不该写进 .env 的键（如 Vite 注入的 ELECTRON_RENDERER_URL）
 *   - 行尾 `# @external <工具名>`：由外部工具（如 electron-builder）直接读取、不经过本项目源码的变量
 *
 * 扫描时剥离注释，避免文档注释里的 `process.env.XXX` 示例被误判成真实读取。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, relative } from 'node:path'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ENV_EXAMPLE = join(ROOT, '.env.example')
const SELF = 'check-env.mjs'
const SCAN_DIRS = ['apps', 'packages', 'tools', 'scripts', 'examples']
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.tmp', '.workbuddy', 'out', 'dist', 'build',
  'coverage', '.nuxt', '.output', 'data',
])
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.mjs', '.cjs', '.js', '.vue'])
const ENV_RES = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
]
/** 由运行环境 / 框架注入，无需在 .env.example 声明；每项写明理由 */
const EXTERNAL_KEYS = new Map([
  ['NODE_ENV', 'Node / npm 运行环境注入'],
  ['CI', 'CI 平台注入'],
  ['NO_COLOR', '终端通用约定（no-color.org）'],
  ['ELECTRON_RENDERER_URL', 'Vite / Electron 开发服务器启动时注入'],
])
/** Vite 内置编译期常量，不是环境变量 */
const VITE_BUILTIN = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR'])

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let isDir = false
    try { isDir = statSync(full).isDirectory() } catch { continue }
    if (isDir) walk(full, out)
    else if (SOURCE_EXT.has(extname(name)) && name !== SELF) out.push(full)
  }
  return out
}

/**
 * 去掉注释后再扫描；块注释用等量空白替换以保持行号。
 * 块注释开头要求斜杠星号前不是星号（lookbehind）：否则 Accept 头字符串里的 MIME 通配符
 * 「星、斜杠、星、分号 q=0.8」会被当成块注释开头，吞掉后面一整段真实代码。
 */
function stripComments(src) {
  const SLASH_STAR = '/' + '*'
  const blockRe = new RegExp('(?<!\\*)' + SLASH_STAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?\\*/', 'g')
  return src
    .replace(blockRe, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}

/** 解析 .env.example：声明键（支持 `KEY=` 与注释模板 `# KEY=`）+ 行尾 @external 豁免理由 */
function declaredKeys() {
  const keys = new Map()
  for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*#?\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)
    if (!m) continue
    const ext = /@external\s+([A-Za-z0-9_.-]+)/.exec(line)
    keys.set(m[1], ext?.[1] ?? null)
  }
  return keys
}

function readKeys() {
  const found = new Map()
  for (const file of SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
    const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const re of ENV_RES) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line)) !== null) {
          const key = m[1]
          if (VITE_BUILTIN.has(key)) continue
          const loc = `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`
          found.set(key, [...(found.get(key) ?? []), loc])
        }
      }
    })
  }
  return found
}

function main() {
  const errors = []
  if (!existsSync(ENV_EXAMPLE)) {
    console.error('缺少 .env.example（环境变量唯一真相源）')
    process.exit(1)
  }
  const declared = declaredKeys()
  const read = readKeys()
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).length

  const undeclared = [...read.entries()]
    .filter(([k]) => !declared.has(k) && !EXTERNAL_KEYS.has(k))
    .map(([k, locs]) => `${k}  ← ${locs.join(', ')}`)
  const zombies = [...declared.entries()]
    .filter(([k, ext]) => !read.has(k) && !ext)
    .map(([k]) => k)

  console.log('环境变量契约检查（.env.example 为唯一真相源）')
  console.log(`  扫描源文件     : ${files}`)
  console.log(`  源码读取的键    : ${read.size}`)
  console.log(`  模板声明的键    : ${declared.size}`)
  console.log(`  外部豁免(@external): ${[...declared.values()].filter(Boolean).length}`)
  console.log(`  框架注入白名单  : ${EXTERNAL_KEYS.size}`)
  if (undeclared.length) {
    errors.push(`读而未声明（臆造 / 拼错，${undeclared.length}）：`)
    for (const e of undeclared) errors.push(`    ${e}`)
  }
  if (zombies.length) {
    errors.push(`声明而未读（僵尸 env，${zombies.length}）：${zombies.join(', ')}`)
    errors.push('    → 删除该声明，或接线到源码；若由外部工具直接读取，行尾加 `# @external <工具名>`')
  }
  if (!declared.size) errors.push('.env.example 未解析出任何变量')

  if (errors.length) {
    console.error('\n发现违规：')
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log('  结论           : 通过（无未定义变量、无僵尸 env）')
}

try { main() } catch (err) { console.error('环境变量检查失败：', err.message); process.exit(1) }
