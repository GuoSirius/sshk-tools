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
    include: [
      'packages/*/src/**/*.test.ts',
      'tools/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // P5-1（C-5）：tool-skeleton 迁 scripts/ 后测试随迁；backup-smoke 专属 smoke 配置仍排除在 verify 外
      'scripts/**/*.test.ts',
    ],
    exclude: ['scripts/backup-smoke.test.ts'],
  },
})
