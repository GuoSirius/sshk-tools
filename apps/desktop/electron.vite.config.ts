import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { fileURLToPath } from 'node:url'
import type { Alias } from 'vite'

// 开发态：主进程改动 -> 自动重启；preload 改动 -> 自动重载渲染进程；
// 渲染进程改动 -> Vite HMR，三者都由 electron-vite dev 统一处理。
// workspace 包全部从源码打进产物（exports 指向 .ts 源码，Node 运行时无法直接执行，
// 且内部是无扩展名导入）——必须排除在 externalize 之外。
const WORKSPACE_PKGS = [
  '@sshk/shared',
  '@sshk/repository',
  '@sshk/backup',
  '@sshk/ui-kit',
  '@sshk/llm-gateway',
  '@sshk/badge-studio',
  '@sshk/edm-studio',
  '@sshk/model-console',
] as const

// 正则精确匹配，避免 "@sshk/edm-studio/main" 被 "@sshk/edm-studio" 前缀吞掉
const pkg = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url))

const sshkAlias: Alias[] = [
  { find: /^@sshk\/shared$/, replacement: pkg('packages/shared/src/index.ts') },
  { find: /^@sshk\/repository$/, replacement: pkg('packages/repository/src/index.ts') },
  { find: /^@sshk\/backup$/, replacement: pkg('packages/backup/src/index.ts') },
  { find: /^@sshk\/ui-kit$/, replacement: pkg('packages/ui-kit/src/index.ts') },
  { find: /^@sshk\/llm-gateway$/, replacement: pkg('packages/llm-gateway/src/index.ts') },
  { find: /^@sshk\/badge-studio$/, replacement: pkg('tools/badge-studio/src/index.ts') },
  { find: /^@sshk\/edm-studio$/, replacement: pkg('tools/edm-studio/src/index.ts') },
  { find: /^@sshk\/model-console$/, replacement: pkg('tools/model-console/src/index.ts') },
  // 工具包子路径入口（main / renderer）
  { find: /^@sshk\/badge-studio\/main$/, replacement: pkg('tools/badge-studio/src/main/index.ts') },
  { find: /^@sshk\/edm-studio\/main$/, replacement: pkg('tools/edm-studio/src/main/index.ts') },
  { find: /^@sshk\/model-console\/renderer$/, replacement: pkg('tools/model-console/src/renderer/ModelConsolePage.vue') },
  { find: /^@sshk\/badge-studio\/renderer$/, replacement: pkg('tools/badge-studio/src/renderer/BadgeStudioPage.vue') },
  { find: /^@sshk\/edm-studio\/renderer$/, replacement: pkg('tools/edm-studio/src/renderer/EdmStudioPage.vue') },
]

// 沙箱 preload：只能 require electron，任何裸包 require 都会 module not found。
// @sshk/shared 的 index 会带 dayjs（time.ts），preload 只需 IPC 通道常量——
// 把 shared 映射到纯常量文件，产物零外部依赖、单一真相源不变。
const preloadAlias: Alias[] = [
  { find: /^@sshk\/shared$/, replacement: pkg('packages/shared/src/ipc.ts') },
  ...sshkAlias.slice(1),
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...WORKSPACE_PKGS] })],
    resolve: { alias: sshkAlias },
    build: {
      rollupOptions: {
        // ESM 优先：主进程产物 .mjs
        output: { format: 'es', entryFileNames: 'index.mjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@sshk/shared'] })],
    resolve: { alias: preloadAlias },
    build: {
      rollupOptions: {
        // sandbox: true 下 preload 必须是 CommonJS，产物固定 .cjs
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    // electron-vite 6 / Vite 8 要求显式指定 root 与 input，否则会在 src/renderer 下找 index.html
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [vue(), UnoCSS()],
    resolve: { alias: sshkAlias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
})
