import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { fileURLToPath } from 'node:url'

// 开发态：主进程改动 -> 自动重启；preload 改动 -> 自动重载渲染进程；
// 渲染进程改动 -> Vite HMR，三者都由 electron-vite dev 统一处理。
const sharedAlias = {
  '@sshk/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        // ESM 优先：主进程产物 .mjs
        output: { format: 'es', entryFileNames: 'index.mjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
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
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
})
