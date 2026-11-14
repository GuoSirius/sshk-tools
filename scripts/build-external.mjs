#!/usr/bin/env node
/**
 * 外部工具包产物构建：node scripts/build-external.mjs <id> | --check
 *
 * 作者态源码：examples/<id>/src/{page,main}.{js,ts,mjs}（零 import ESM）
 * 分发产物　：examples/<id>/dist/{page.js,main.js}（零 import，字节级可复现）
 *
 * 设计裁决：外部运行时是 Blob URL 动态 import，裸 import 在渲染层无法解析，
 * 因此作者态源码本身必须是零 import 的纯 ESM；这里**不引入 bundler**——
 * 打包器注入的 helper / 格式转换反而会破坏 Blob URL 下的纯 ESM 组件导出。
 * 构建职责 = TS 转译 + 零 import 校验 + 产物落盘 + 外部 manifest 变体校验/生成。
 *
 *  --check（无 id）：校验所有外部包的 dist 与 src 是否同步，供 pnpm verify 门禁使用，
 *                   防止「手写 dist 与源码漂移」或漏构建就打包。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { ROOT, MANIFEST_FILE } from './lib/tool-package.mjs'

const req = createRequire(fileURLToPath(new URL('../apps/desktop/package.json', import.meta.url)))
const EXAMPLES = join(ROOT, 'examples')
const STEMS = ['page', 'main']
/** 零 import 校验：禁止静态/动态 import、re-export from、CommonJS require */
const IMPORT_LINE = /^\s*(?:import\s|import\s*\(|export\s[^\n]*\sfrom\s|require\s*\()/

function parseArgs(argv) {
  const out = { id: null, check: false }
  for (const a of argv) {
    if (a === '--check') out.check = true
    else if (!a.startsWith('--')) out.id = a
  }
  return out
}

function findSource(dir, stem) {
  for (const ext of ['.js', '.mjs', '.ts']) {
    const file = join(dir, 'src', `${stem}${ext}`)
    if (existsSync(file)) return file
  }
  return null
}

function buildSource(file) {
  const raw = readFileSync(file, 'utf8')
  const content = file.endsWith('.ts')
    ? req('typescript').transpileModule(raw, {
      compilerOptions: { target: 99 /* ESNext */, module: 99 /* ESNext */ },
    }).outputText
    : raw
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (IMPORT_LINE.test(lines[i])) {
      throw new Error(`${relative(ROOT, file)}:${i + 1} 存在模块依赖（外部运行时必须零 import）：${lines[i].trim()}`)
    }
  }
  return content
}

function expectedOutputs(dir) {
  const out = {}
  for (const stem of STEMS) {
    const file = findSource(dir, stem)
    if (!file) throw new Error(`缺少外部作者态源码 ${relative(ROOT, join(dir, 'src', stem))}.{js,mjs,ts}`)
    out[`dist/${stem}.js`] = buildSource(file)
  }
  return out
}

/** 外部 manifest 变体：source=external、renderer/main 指向 dist、带 package 契约 */
function validateExternalManifest(dir, { createIfMissing = false } = {}) {
  const file = join(dir, MANIFEST_FILE)
  const builtin = join(ROOT, 'tools', dir.split(/[\\/]/).pop(), MANIFEST_FILE)
  if (!existsSync(file) && createIfMissing && existsSync(builtin)) {
    const obj = JSON.parse(readFileSync(builtin, 'utf8'))
    obj.plugin = {
      ...obj.plugin,
      source: 'external',
      renderer: 'dist/page.js',
      main: 'dist/main.js',
    }
    obj.package = {
      schemaVersion: 1,
      version: '1.0.0',
      requiresHost: { api: '^1.0', capabilities: [] },
      sandbox: 'utility',
      ipcAllowlist: [],
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  }
  if (!existsSync(file)) throw new Error(`缺少 ${relative(ROOT, file)}`)
  const m = JSON.parse(readFileSync(file, 'utf8'))
  const errors = []
  if (m.plugin?.source !== 'external') errors.push('plugin.source 必须为 external')
  if (m.plugin?.renderer !== 'dist/page.js') errors.push('plugin.renderer 必须为 dist/page.js')
  if (m.plugin?.main !== 'dist/main.js') errors.push('plugin.main 必须为 dist/main.js')
  if (!m.package || m.package.schemaVersion !== 1) errors.push('package 契约缺失或 schemaVersion 不为 1')
  if (!m.package?.requiresHost || !Array.isArray(m.package.requiresHost.capabilities)) errors.push('requiresHost.capabilities 缺失')
  if (errors.length) throw new Error(`${relative(ROOT, file)} 不是合法外部变体：\n  - ${errors.join('\n  - ')}`)
}

function externalDirs() {
  if (!existsSync(EXAMPLES)) return []
  return readdirSync(EXAMPLES)
    .map((n) => join(EXAMPLES, n))
    .filter((d) => existsSync(join(d, MANIFEST_FILE)) && JSON.parse(readFileSync(join(d, MANIFEST_FILE), 'utf8')).plugin?.source === 'external')
}

function main() {
  const arg = parseArgs(process.argv.slice(2))
  const dirs = arg.id ? [join(EXAMPLES, arg.id)] : externalDirs()
  if (!dirs.length) throw new Error('未找到任何外部工具包源码目录')
  const errors = []
  console.log(`外部包构建${arg.check ? '一致性检查' : ''}（零 import ESM → dist）`)

  for (const dir of dirs) {
    const id = dir.split(/[\\/]/).pop()
    let expected
    try {
      expected = expectedOutputs(dir)
      validateExternalManifest(dir, { createIfMissing: !arg.check })
    } catch (err) {
      errors.push(`${id}: ${err.message}`)
      continue
    }
    if (arg.check) {
      for (const [rel, content] of Object.entries(expected)) {
        const target = join(dir, rel)
        if (!existsSync(target)) errors.push(`${id}: 缺少 ${rel}（运行 pnpm build:external ${id}）`)
        else if (readFileSync(target, 'utf8') !== content) {
          errors.push(`${id}: ${rel} 与 src 不同步（运行 pnpm build:external ${id} 重建）`)
        }
      }
      if (!errors.some((e) => e.startsWith(`${id}:`))) console.log(`  ${id.padEnd(28)} ✅ dist 与 src 一致`)
    } else {
      mkdirSync(join(dir, 'dist'), { recursive: true })
      for (const [rel, content] of Object.entries(expected)) writeFileSync(join(dir, rel), content, 'utf8')
      console.log(`  ${id.padEnd(28)} ✅ 已产出 dist/page.js、dist/main.js`)
    }
  }

  if (errors.length) {
    console.error('\n发现违规：')
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log('  结论：通过')
}

try { main() } catch (err) { console.error('外部包构建失败：', err.message); process.exit(1) }
