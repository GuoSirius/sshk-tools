import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 让跨包 import（@sshk/*）在 vitest 运行时按源码解析（与 tsconfig paths 一致）。
// 动态扫描 packages/* 与 tools/*：新增工具包无需改测试配置。
const ROOT = fileURLToPath(new URL('./', import.meta.url))
const alias: { find: RegExp; replacement: string }[] = []
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
    ],
  },
})
