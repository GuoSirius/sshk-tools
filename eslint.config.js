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
]
