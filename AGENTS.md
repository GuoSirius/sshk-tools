# AGENTS.md · 仓库协作铁律

## 开发模式铁律（2026-11-14 用户拍板，最高优先级）

**凡以源码 dev 模式运行（`pnpm dev`，即 `import.meta.env.DEV === true`）：
所有功能、表单项、配置项、工具入口一律全量展示、全量可编辑，不受任何配置变量控制。
`app.developerMode` 等功能开关在 dev 下不参与任何判断——开发模式里没有能关掉功能的变量。**

- `app.developerMode` 这类开关**只作用于打包/安装版**：控制安装后哪些功能展示、哪些可编辑。
- 新增任何功能门控时必须走总开关模式：`devFeatures = isDev || cfg.developerMode`（渲染层已有先例：`AppSettingsDrawer.vue`），禁止直接绑 `cfg.developerMode`、禁止在 dev 分支下再套条件。
- 主进程侧同理：开发辅助通道（如 `dev-tools.ts`）的可用性只由「是否源码仓库」决定，不读任何用户配置。

违反此铁律的典型事故：dev 运行时开发者功能被 `developerMode=false` 关掉，用户看不到「配置」按钮（2026-11-14，commit ac4bc1d 修复）。

## 其它约定

- 需求/优化/决策一律登记 `docs/02-architecture/工具插件化需求台账.md`（含跨会话补记）。
- 门禁：`pnpm verify` 全绿才准提交（13 道检查 + vitest）；提交用 conventional commits，推送 main。
