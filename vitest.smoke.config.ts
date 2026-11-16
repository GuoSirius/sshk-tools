import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * backup:smoke 专用配置（plans/03 H5）：
 * 只跑 scripts/backup-smoke.test.ts，不进 pnpm verify（时长考虑，发布前/夜间手动跑）。
 * alias 逻辑与 vitest.config.ts 一致（@sshk/* 按源码解析）。
 */
const ROOT = fileURLToPath(new URL('./', import.meta.url))
const alias: { find: RegExp; replacement: string }[] = []
for (const layer of ['packages', 'tools']) {
  const dir = join(ROOT, layer)
  if (!existsSync(dir)) continue
  for (const entry of readdirSync(dir)) {
    const manifestPath = join(dir, entry, 'package.json')
    const sourceEntry = join(dir, entry, 'src/index.ts')
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
    include: ['scripts/backup-smoke.test.ts'],
  },
})
