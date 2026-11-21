// TypeScript 统一约束在 6.x 最新版（typescript-eslint 8 尚不支持 TS 7，用户决策）。
// 若本机仍残留 TS 7（尚未执行 pnpm install 刷新依赖），动态跳过 tsParser，
// 避免 ESLint 启动失败；装到 TS 6 后自动启用对 .ts 的完整检查。
// 模块规范：ESM 优先，本配置与脚本均为 ESM；需 CJS 时用 .cjs 后缀。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function typescriptMajor() {
  try {
    return Number(require('typescript').version.split('.')[0])
  } catch {
    return 6
  }
}

const parserModule = typescriptMajor() < 7 ? require('@typescript-eslint/parser') : null
const tsParser = parserModule ? (parserModule.default ?? parserModule) : null

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '.tmp/**',
  '.git/**',
  '**/*.d.ts',
]

const languageOptions = { ecmaVersion: 2022, sourceType: 'module' }

const rules = {
  // 时间规范：一律北京时间，禁止 UTC 序列化
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.property.name='toISOString']",
      message: '禁止 toISOString()（输出 UTC），请使用 @sshk/shared 的 time.ts 北京时间工具',
    },
    // dev 判据唯一化（P0-1 · D55）：全仓判 dev 只认 @sshk/shared 的 SSHK_DEV
    // （__SSHK_DEV__ 由 electron.vite.config.ts 构建期注入三端），禁止 import.meta.env 内建标志
    {
      selector:
        "MemberExpression[object.object.type='MetaProperty'][object.property.name='env'][property.name=/^(DEV|PROD|MODE|BASE_URL|SSR)$/]",
      message: 'dev 判据唯一化（D55）：禁止 import.meta.env.DEV/PROD/MODE 等，一律使用 @sshk/shared 的 SSHK_DEV',
    },
    // D-2（P0-2）：开发者功能总开关禁止散拼，一律 isDevFeaturesEnabled() / catalog 下发的 devFeatures
    {
      selector: "LogicalExpression[operator='||'][right.name='developerMode']",
      message: '禁止散拼 isDev || developerMode（D-2），一律使用 @sshk/shared 的 isDevFeaturesEnabled / catalog 下发的 devFeatures',
    },
    {
      selector: "LogicalExpression[operator='||'][right.property.name='developerMode']",
      message: '禁止散拼 isDev || xxx.developerMode（D-2），一律使用 @sshk/shared 的 isDevFeaturesEnabled / catalog 下发的 devFeatures',
    },
  ],
  // 分层规范：tools/* 之间禁止直接 import（细粒度检查由 check-boundaries.mjs 负责）
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/tools/*/**', '**/tools/*'],
          message: '工具之间禁止直接 import，请经 packages/ 的公共能力按 ID 引用',
        },
      ],
    },
  ],
}

export default [
  { ignores },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions,
    rules,
  },
  ...(tsParser
    ? [{ files: ['**/*.ts'], languageOptions: { ...languageOptions, parser: tsParser }, rules }]
    : []),
  // H2 工具渲染层零裸调：window.api.<group>.<method> 一律走 createSafeHost / callHostApi；
  // window.api.ipc（工具自有通道直连，工具开发指南 §四文档化 API）豁免；
  // 事件订阅类（onProgress/onDelta）集中在封装点并加 eslint-disable 行注释。
  ...(tsParser
    ? [{
        files: ['tools/*/src/renderer/**/*.ts'],
        rules: {
          'no-restricted-syntax': [
            'error',
            {
              selector:
                "MemberExpression[object.object.name='window'][object.property.name='api'][property.name!='ipc']",
              message:
                '宿主能力一律经 createSafeHost（renderer/host.ts）或 callHostApi 调用（H2 零裸调）；事件订阅请留在封装点并加 eslint-disable 注释',
            },
          ],
        },
      }]
    : []),
]
