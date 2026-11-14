#!/usr/bin/env node
/**
 * 通用工具包打包：node scripts/pack-tool.mjs <id> [--out <file>] [--src <dir>]
 *
 * 产出 <id>.sshktool（zip 归档），供「设置中心 → 运行时工具包 → 导入安装」。
 *
 * 打包范围（方案 A：仅分发运行时所需，体积最小、源码不随包泄露）：
 *   - tool.manifest.json（必须）
 *   - dist/（零 import 渲染层 page.js + 打包 main.js）
 *   - assets/（图标等静态资源）
 *   - SIGNATURE（若已签名）
 * 排除：src/ scripts/ node_modules/ .git/ .tmp/ coverage/ 及一切点文件。
 *
 * 硬校验（防交付坏包）：外部包必须含 dist/page.js 与 dist/main.js；申请 main 沙箱必须已签名。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import {
  ROOT,
  MANIFEST_FILE,
  SIGNATURE_FILE,
  collectFiles,
  resolveToolSrc,
} from './lib/tool-package.mjs'

const req = createRequire(fileURLToPath(new URL('../apps/desktop/package.json', import.meta.url)))
const { zipSync } = req('fflate')

function parseArgs(argv) {
  const out = { id: null, src: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') out.src = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (!a.startsWith('--')) out.id = a
  }
  return out
}

function main() {
  const arg = parseArgs(process.argv.slice(2))
  const src = resolveToolSrc(arg)
  const manifestPath = join(src, MANIFEST_FILE)
  if (!existsSync(manifestPath)) throw new Error(`缺少 ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const id = manifest.id

  const files = collectFiles(src)
  const names = new Set(files.map((f) => f.rel))
  if (!names.has(MANIFEST_FILE)) throw new Error('包内必须包含 tool.manifest.json')

  // 外部包运行时强依赖零 import 渲染层与 main 产物；缺失时直接拒绝，绝不产出不可安装的包
  if (manifest.plugin?.source === 'external') {
    const missing = ['dist/page.js', 'dist/main.js'].filter((n) => !names.has(n))
    if (missing.length) {
      throw new Error(`外部包缺少运行时产物：${missing.join('、')}；请先构建 dist/ 再打包（拒绝产出不可安装的包）`)
    }
    if (manifest.package?.sandbox === 'main' && !names.has(SIGNATURE_FILE)) {
      throw new Error('申请 main 沙箱但包内没有 SIGNATURE；请先运行 sign-tool.mjs 签名')
    }
  }

  const entries = {}
  for (const f of files) entries[f.rel] = readFileSync(f.full)

  const zip = zipSync(entries)
  const outFile = arg.out ?? join(ROOT, 'examples', `${id}.sshktool`)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, Buffer.from(zip))
  console.log(`已打包 ${relative(ROOT, outFile)}（${files.length} 个文件，源自 ${relative(ROOT, src)}）`)
  if (outFile && !resolve(outFile).startsWith(resolve(ROOT))) {
    // --out 指向仓库外时给个提示，避免产物散落
    console.log('ℹ️ 输出目录在仓库外，请确认产物位置')
  }
}

try {
  main()
} catch (err) {
  console.error('打包失败：', err.message)
  process.exit(1)
}
