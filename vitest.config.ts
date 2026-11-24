import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 让跨包 import（@sshk/*）在 vitest 运行时按源码解析（与 tsconfig paths 一致）。
// 动态扫描 packages/* 与 tools/*：新增工具包无需改测试配置。
const ROOT = fileURLToPath(new URL('./', import.meta.url))
const alias: { find: RegExp; replacement: string }[] = [
  { find: /^@sshk\/upload-core\/types$/, replacement: join(ROOT, 'packages/upload-core/src/upload-types.ts') },
  // 包内聚子入口（B10 · P5-3/C-4）：ShareDialog/share-ticket 渲染子入口（与 electron.vite.config 同口径）
  { find: /^@sshk\/share-core\/ui$/, replacement: join(ROOT, 'packages/share-core/src/ui/index.ts') },
  // 包内聚子入口（plans/13 · B0）：表单设计器/递归渲染器组件子入口（与 electron.vite.config 同口径）
  { find: /^@sshk\/form-schema\/ui$/, replacement: join(ROOT, 'packages/form-schema/src/ui/index.ts') },
  // 包内聚子入口（D49/D56）：骨架生成单一事实源（与 electron.vite.config 同口径）
  { find: /^@sshk\/shared\/tool-skeleton$/, replacement: join(ROOT, 'packages/shared/src/tool-skeleton/index.ts') },
  // D56（2026-11-23）：app 内部跨目录别名（与 electron.vite.config 同口径）
  { find: /^@main\//, replacement: `${join(ROOT, 'apps/desktop/src/main')}/` },
  { find: /^@renderer\//, replacement: `${join(ROOT, 'apps/desktop/src/renderer')}/` },
  { find: /^@app\//, replacement: `${join(ROOT, 'apps/desktop/src')}/` },
  { find: /^@build\//, replacement: `${join(ROOT, 'apps/desktop/build')}/` },
]
for (const layer of ['packages', 'tools']) {
  const dir = join(ROOT, layer)
  if (!existsSync(dir)) continue
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(dir, entry.name, 'package.json')
    const sourceEntry = join(dir, entry.name, 'src/index.ts')
    if (!existsSync(manifestPath) || !existsSync(sourceEntry)) continue
    const name: unknown = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name
    if (typeof name !== 'string' || !name.startsWith('@sshk/')) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    alias.push({ find: new RegExp(`^${escaped}$`), replacement: sourceEntry })
  }
}

export default defineConfig({
  resolve: { alias },
  test: {
    // scripts/ 只剩 backup-smoke（专属 vitest.smoke.config.ts，发布前/夜间手动跑，不进 verify）
    include: [
      'packages/*/src/**/*.test.ts',
      'tools/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    // 注：vitest 5 对 css 文件导入（含 ?raw）一律 stub 为空串，与 externalize/inline 无关（实测项目内与
    // node_modules 均空）。normalize.css 的 ?raw 在 vitest 下由 core/css-bundle.ts 的
    // createRequire 回退链兜底，构建期（electron-vite/rollup）?raw 内联不受影响。
  },
})
