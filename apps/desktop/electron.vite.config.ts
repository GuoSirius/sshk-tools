import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Alias } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const pkg = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url))

/** 构建期注入 git 短 commit（关于页「运行环境」展示）；非仓库环境回退 dev */
function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() } catch { return 'dev' }
}
const APP_COMMIT_DEFINE = { __APP_COMMIT__: JSON.stringify(gitCommit()) }

/**
 * 构建期动态发现 workspace 包：扫描 packages/* 与 tools/* 的 package.json。
 * 新增工具包放进 tools/ 后，别名与 externalize 白名单自动生效，宿主零改动。
 */
const WORKSPACE_PKGS: string[] = []
const sshkAlias: Alias[] = []
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
    WORKSPACE_PKGS.push(name)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    sshkAlias.push({ find: new RegExp(`^${escaped}$`), replacement: sourceEntry })
  }
}

// 沙箱 preload：只能 require electron，任何裸包 require 都会 module not found。
// @sshk/shared 的 index 会带 dayjs（time.ts），preload 只需 IPC 通道常量 + IpcResult 判别
//（H1 解包）——映射到纯常量聚合文件，产物零外部依赖、单一真相源不变。
const preloadAlias: Alias[] = [
  { find: /^@sshk\/shared$/, replacement: pkg('packages/shared/src/preload-shared.ts') },
]

// 运行时依赖保持 dependencies（语义正确），但主进程要内联打进产物：
// 配合 electron-builder files 的 '!node_modules/**'，安装包零 node_modules，
// 构建期原生二进制（@oxc-parser 等）因此永远进不了包（mac universal 曾因此失败）。
const BUNDLED_RUNTIME_DEPS = ['dayjs', 'fflate', 'electron-updater']

/**
 * ssh2 的 optional 原生加速模块 cpu-features 在打包环境没有编译产物（allowBuilds:false），
 * 而 ssh2/lib/protocol/constants.js 用 try/catch 包裹 require('cpu-features')()，
 * 属可选探测。用构建期 shim 替换包名，让 rolldown 不再静态解析缺失的 .node 文件，
 * 运行时由 ssh2 自己回退纯 JS 探测（SFTP 能力不受影响）。
 */
const cpuFeaturesStub = fileURLToPath(new URL('./src/main/stubs/cpu-features.cjs', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...WORKSPACE_PKGS, ...BUNDLED_RUNTIME_DEPS] })],
    resolve: { alias: [...sshkAlias, { find: /^cpu-features$/, replacement: cpuFeaturesStub }] },
    define: APP_COMMIT_DEFINE,
    build: {
      rollupOptions: {
        // 显式声明主进程入口：index 是 Electron 主进程；utility-host-entry 是
        // utilityProcess 沙箱子进程的加载器（加载外部包 main）。两者都需独立产物。
        input: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'utility-host-entry': fileURLToPath(new URL('./src/main/utility-host-entry.ts', import.meta.url)),
        },
        // ESM 优先：主进程产物 .mjs。
        // 旧配置固定 'index.mjs'，第二入口 utility-host-entry 会覆盖它造成碰撞；
        // 改为函数：index 仍输出 index.mjs，其余入口按 [name].mjs 输出。
        output: {
          format: 'es',
          entryFileNames: (chunk) => (chunk.name === 'index' ? 'index.mjs' : `${chunk.name}.mjs`),
        },
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
    // 局域网可访问（手机 / 其他设备调试分享页）；仅 dev 生效
    server: { host: true },
    plugins: [vue(), UnoCSS()],
    resolve: { alias: sshkAlias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
})
