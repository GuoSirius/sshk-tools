# AGENTS.md · 仓库协作铁律

> **新设备 / 新会话开工第一步**：先完整读取 `docs/00-CONVENTIONS.md`（项目规范与铁律总纲，本文是其摘要），再读 `docs/00-index.md`（文档索引与决策看板）。所有目录/设计/文件/命名/使用/契约规范与铁律以总纲为准；待决策项见 `docs/06-codereview/2026-11-21-CodeReview敲板裁决与重构实施总计划.md` §三/§四（CodeReview 敲板裁决入口），未拍板不得擅自动手。

## 开发模式铁律（2026-11-14 用户拍板，最高优先级）

**凡以源码 dev 模式运行（`pnpm dev`；判据唯一真相源 = `packages/shared/src/dev-flag.ts` 的 `SSHK_DEV`，由构建期 `__SSHK_DEV__` 注入三端，含 dev/development/preview，D55）：
所有功能、表单项、配置项、工具入口一律全量展示、全量可编辑，不受任何配置变量控制。
`app.developerMode` 等功能开关在 dev 下不参与任何判断——开发模式里没有能关掉功能的变量。**

- `app.developerMode` 这类开关**只作用于打包/安装版**：控制安装后哪些功能展示、哪些可编辑。
- 新增任何功能门控时必须走总开关模式：`devFeatures = isDev(SSHK_DEV) || cfg.developerMode`，**其中 `isDev` 必须取统一判据 `SSHK_DEV`，禁止散写 `import.meta.env.DEV` 裸拼**（ESLint `eslint.config.js` 已卡）；禁止直接绑 `cfg.developerMode`、禁止在 dev 分支下再套条件。
- 主进程侧同理：开发辅助通道（如 `dev-tools.ts`）的可用性只由「是否源码仓库」决定（内联于 `dev-tools.ts` 的 `guard()`/`findRepoRoot()`，语义等价旧称 `isSourceRepo`），不读任何用户配置。

违反此铁律的典型事故：dev 运行时开发者功能被 `developerMode=false` 关掉，用户看不到「配置」按钮（2026-11-14，commit ac4bc1d 修复）。

## 其它约定

- **CHANGELOG.md 由 release 流程自动生成，AI 禁止手工写入/编辑**；需要交代破坏性变更或发布说明时写进 commit message、需求台账或设计文档，不碰 CHANGELOG（2026-11-17 用户明确纠正）。
- **所有危险操作一律二次确认**（撤销/删除/重新生成/覆盖/清空等，2026-11-17 用户拍板）——任何会立即失效、不可恢复或覆盖既有数据的高风险动作，执行前必须用 `ElMessageBox.confirm` 或等价确认弹框让用户明确点确认；不得点一下直接生效。
- **CodeReview 文档独立目录**（2026-11-21 用户拍板）：所有 CodeReview 报告、复核台账、交叉合并、敲板/处置计划一律落 `docs/06-codereview/`，命名 `YYYY-MM-DD-主题.md`；后续每轮 review 都在此目录新建，不散落 02-architecture。
- 需求/优化/决策一律登记 `docs/02-architecture/工具插件化需求台账.md`（含跨会话补记）。
- 门禁：`pnpm verify` 全绿才准提交（13 道检查 + vitest）；提交用 conventional commits，推送 main。
