import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
// Vue DevTools（用户 2026-11-18 需求）：dev 期内置调试面板（组件树/状态/路由/Pinia），
// Alt+Shift+D 或底栏齿轮唤起；该插件仅在 dev server 下注入，build 产物零影响
import VueDevTools from 'vite-plugin-vue-devtools'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Alias, Plugin } from 'vite'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import { collectBuiltinToolInfo, resolveBuiltinSelectionFromEnv } from './src/main/builtin-selection'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const pkg = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url))

// 构建期加载仓库根 .env（真实环境变量优先，dotenv 默认不覆盖）：
// SSHK_BUILD_* / SSHK_APP_* 等构建旋钮由此进入 process.env——
// 此前只在主进程 env-load.ts 加载，pnpm dist 打包期读不到导致裁剪/禁更全部失效（2026-11-17 用户实测）。
if (existsSync(join(ROOT, '.env'))) loadDotenv({ path: join(ROOT, '.env'), quiet: true })

/** 构建期注入 git 短 commit（关于页「运行环境」展示）；非仓库环境回退 dev */
function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() } catch { return 'dev' }
}
const APP_COMMIT_DEFINE = { __APP_COMMIT__: JSON.stringify(gitCommit()) }

/**
 * X5-A 构建裁剪（用户 2026-11-16 拍板）：
 * SSHK_BUILTIN_TOOLS=edm-studio,badge-studio → 只把这些工具打进安装包，
 * 依赖闭包自动补齐（c 被 a 依赖则 c 搭进去）；不设置 / all / * = 全量（默认零变化）。
 * 三路生效：① define 注入发现逻辑（清单/加载器/图标按名单过滤）；
 * ② stub 插件把未选工具的全部模块替换为空导出（真实代码不进 bundle）；
 * ③ 结果落盘 .build-selection.json，electron-builder.config.cjs 据此裁 extraResources。
 */
const BUILTIN = (() => {
  const sel = resolveBuiltinSelectionFromEnv(process.env.SSHK_BUILD_TOOLS, collectBuiltinToolInfo(ROOT))
  if (sel.mode === 'list') {
    console.log(
      `[sshk] 内建裁剪：${sel.ids?.join('、')}` +
      (sel.pulledIn.length ? `（依赖闭包拉入：${sel.pulledIn.join('、')}）` : '') +
      (sel.excluded.length ? `；排除：${sel.excluded.join('、')}` : ''),
    )
  }
  // 落盘给 electron-builder（mode 也写：覆盖上一轮 list 模式残留）
  writeFileSync(
    fileURLToPath(new URL('./.build-selection.json', import.meta.url)),
    JSON.stringify({ mode: sel.mode, ids: sel.ids, pulledIn: sel.pulledIn, excluded: sel.excluded }, null, 2),
  )
  return sel
})()
const BUILTIN_DEFINE = { __SSHK_BUILD_TOOLS__: JSON.stringify({ mode: BUILTIN.mode, ids: BUILTIN.ids, pulledIn: BUILTIN.pulledIn }) }

/**
 * 分发期固定旋钮：打包版没有 .env（env-load 静默跳过），运行时读不到构建时的
 * SSHK_AUTO_UPDATE——构建期读一次并注入产物，SSHK_AUTO_UPDATE=0 打包后立即生效。
 * 语义同 shared getEnvBool（'0'/'false' 显式关）：此处内联实现，配置文件不依赖运行时模块。
 */
const AUTO_UPDATE_DEFINE = {
  __SSHK_AUTO_UPDATE_DISABLED__: JSON.stringify(
    ['0', 'false'].includes(String(process.env.SSHK_APP_AUTO_UPDATE ?? '').trim().toLowerCase()),
  ),
}

/**
 * dev 判据唯一化（P0-1 · D55 终审）：`__SSHK_DEV__` 注入 main/preload/renderer 三端，
 * 全仓判 dev 只认它（shared/src/dev-flag.ts 的 SSHK_DEV 是唯一运行时消费形态）。
 * 终审 C-1 定值：dev 与 preview 都算 dev —— electron-vite dev 实际 mode='development'，
 * preview 走专链 `electron-vite preview --mode preview`（apps/desktop package.json）。
 */
function sshkDevDefine(mode: string) {
  return { __SSHK_DEV__: JSON.stringify(mode === 'development' || mode === 'dev' || mode === 'preview') }
}

/**
 * 构建期烤入 env（用户 2026-11-18 拍板；CR-20/CR-47/E4 完善批 · C-9 保持机制只修 bug）：
 * 键集合 = .env 声明的 SSHK_* ∪ 本机 process.env 的 SSHK_*（真实环境优先），
 * 整批注入 __SSHK_BAKED_ENV__ 字面量（主进程），打包版没有 .env 也能读到构建时取值。
 * 默认不允许本机环境变量覆盖，SSHK_APP_OVERRIDABLE 列出可覆盖的键（语义见 shared/baked-env.ts）。
 * 只注入主进程：渲染层没有本机 env 可言，且避免把敏感值打进渲染 bundle。
 * 专用前缀不烤入（CR-47/E5 对齐契约）：SSHK_BUILD_*（构建旋钮，进产物等于泄漏）、
 * SSHK_DEV_*（仅 dev 生效的调试键，烤入等于把 dev 行为带进安装版）。
 */
const BAKED_ENV_DENY_PREFIXES = ['SSHK_BUILD_', 'SSHK_DEV_']
const BAKED_ENV = (() => {
  const envFile = existsSync(join(ROOT, '.env')) ? parseDotenv(readFileSync(join(ROOT, '.env'))) : {}
  const keys = new Set([...Object.keys(envFile), ...Object.keys(process.env)])
  const out: Record<string, string> = {}
  for (const key of keys) {
    if (!key.startsWith('SSHK_')) continue
    if (BAKED_ENV_DENY_PREFIXES.some((p) => key.startsWith(p))) continue
    const value = process.env[key] ?? envFile[key]
    if (value !== undefined && value !== '') out[key] = String(value)
  }
  return out
})()
const BAKED_ENV_DEFINE = { __SSHK_BAKED_ENV__: JSON.stringify(BAKED_ENV) }

/** 未选工具的所有模块替换为空导出：eager 清单/图标/懒加载页面/主进程入口都不进 bundle */
function builtinStubPlugin(excluded: readonly string[]): Plugin {
  const set = new Set(excluded)
  if (!set.size) return { name: 'sshk-builtin-stub' }
  return {
    name: 'sshk-builtin-stub',
    enforce: 'pre',
    load(id) {
      const clean = (id.replace(/^\0/, '').split('?')[0] ?? '').replace(/\\/g, '/')
      const hit = /\/tools\/([^/]+)\//.exec(clean)?.[1]
      if (!hit || !set.has(hit)) return null
      // 各类插件都会对 stub 内容再做一次解析，必须按类型给出合法载荷：
      // .json → builtin:vite-json 自行 JSON.parse；.vue → SFC 解析要求至少一个 template/script
      if (clean.endsWith('.json')) return 'null'
      if (clean.endsWith('.vue')) return '<template><div /></template>'
      return 'export default null'
    },
  }
}

/**
 * 构建期动态发现 workspace 包：扫描 packages/* 与 tools/* 的 package.json。
 * 新增工具包放进 tools/ 后，别名与 externalize 白名单自动生效，宿主零改动。
 */
const WORKSPACE_PKGS: string[] = []
const sshkAlias: Alias[] = [
  // 包内聚子入口（B6 · P0-5）：upload-core 零依赖类型真相源（shared re-export 指向此处）
  { find: /^@sshk\/upload-core\/types$/, replacement: pkg('packages/upload-core/src/upload-types.ts') },
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
const BUNDLED_RUNTIME_DEPS = ['dayjs', 'fflate', 'iconv-lite', 'electron-updater']

/**
 * ssh2 的 optional 原生加速模块 cpu-features 在打包环境没有编译产物（allowBuilds:false），
 * 而 ssh2/lib/protocol/constants.js 用 try/catch 包裹 require('cpu-features')()，
 * 属可选探测。用构建期 shim 替换包名，让 rolldown 不再静态解析缺失的 .node 文件，
 * 运行时由 ssh2 自己回退纯 JS 探测（SFTP 能力不受影响）。
 */
const cpuFeaturesStub = fileURLToPath(new URL('./src/main/stubs/cpu-features.cjs', import.meta.url))

export default defineConfig(({ mode }) => {
  const DEV_DEFINE = sshkDevDefine(mode)
  return {
  main: {
    plugins: [builtinStubPlugin(BUILTIN.excluded), externalizeDepsPlugin({ exclude: [...WORKSPACE_PKGS, ...BUNDLED_RUNTIME_DEPS] })],
    resolve: { alias: [...sshkAlias, { find: /^cpu-features$/, replacement: cpuFeaturesStub }] },
    define: { ...DEV_DEFINE, ...APP_COMMIT_DEFINE, ...BUILTIN_DEFINE, ...AUTO_UPDATE_DEFINE, ...BAKED_ENV_DEFINE },
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
    define: { ...DEV_DEFINE },
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
    plugins: [builtinStubPlugin(BUILTIN.excluded), vue(), UnoCSS(), VueDevTools()],
    resolve: { alias: sshkAlias },
    define: { ...DEV_DEFINE, ...BUILTIN_DEFINE, ...AUTO_UPDATE_DEFINE },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  }
})
