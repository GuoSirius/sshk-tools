import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 让跨包 import（@sshk/*）在 vitest 运行时按源码解析（与 tsconfig paths 一致）
const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sshk/shared': pkg('shared'),
      '@sshk/repository': pkg('repository'),
      '@sshk/backup': pkg('backup'),
      '@sshk/ui-kit': pkg('ui-kit'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
  },
})
