// typescript-eslint 8 尚不支持 TypeScript 7（"latest" 解析到 TS 7.0.2）。
// 因此 ESLint 只检查 JS/MJS/CJS；TS 由 tsc --noEmit + 自定义脚本把关（时间规范、分层依赖）。
// 待 typescript-eslint 支持 TS >=7.1 后，再启用 @typescript-eslint/parser 检查 .ts。
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '.tmp/**',
      '.git/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
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
    },
  },
]
