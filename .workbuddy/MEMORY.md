# 项目长期记忆（sshk-tools）

## 依赖约定（用户硬规则）
- **所有 npm 包依赖尽量用 `latest`，不要钉具体版本号**。新增依赖也用 `latest`。
- 例外：workspace 内部包用 `workspace:*`，仅此一种锁版本形式。

## 里程碑状态
- **1.0.0 已发布**（tag v1.0.0，2026-11-14）：含自动更新 UX 重塑、GitHub 安装器命名区分、发布构建前清 dist；发布后修复若干运行时问题（runtime-sample 打包态加载、按钮样式等）。由用户手动 `pnpm release` 发布（非 AI 代发），AI 提交后 push。
- **下一步：edm-studio 部分开发**——用户强调代码风格、规范必须严格守（见下方铁律）。

## 踩坑清单（2026-11-13，牢记不再犯）
1. **manifest 契约**：`package.ipcAllowlist` = 包主动调用的**宿主 IPC 通道**白名单；工具**自身注册的通道**放 `plugin.channels`。放错位置 → 导入报「未声明的 IPC 通道」。
2. **CSP 与动态 import**：运行时包 Blob URL 模块加载要求 `script-src 'self' blob:`（apps/desktop/index.html）。「Failed to fetch dynamically imported module」优先查 CSP，不是模块本身坏了。
3. **computed 里禁止副作用**：加载/请求逻辑放 watch（immediate）+ 按 id 记 loading/failed 状态，失败不自动重试，否则反复触发形成弹错风暴。
4. **占位组件真值陷阱**：`toolComponent` 无 loader 时必须返回 `null`，不能返回 truthy 占位组件，否则短路后续分支（运行时渲染曾因此成死代码）。
5. **JS 注释里的 glob**：块注释中写 `tools/*/src` 这类含 `*/` 的模式会提前闭合注释，后半段变代码引发 TS2304。注释路径改写为不含 `*/` 的形式。
6. **悬浮按钮定位**：absolute 子元素在滚动容器内会随内容滚走，要放在外层 relative 包裹层（如 chat-main）。
7. **Element Plus 2.14 select DOM**：`.el-select__wrapper(.is-hovering/.is-focused)`，样式用 `:deep()` + box-shadow inset 描边。
8. **ref 迁移全量 grep**：reactive→ref 迁移后所有 `Object.assign(form,`/`(form)` 形态必须逐个核对（曾漏 3 处写进包装对象）。
9. **提交前核实落盘**：node 脚本批量改文件后必须 grep 关键改动真实生效（曾跑出空 diff 提交）。
10. **textarea 代码定位**：wrap=off（逻辑行=视觉行）+ getComputedStyle 实际行高算 scrollTop。
11. **Buffer.toString()**：decryptString 返回 Buffer|string 联合时 String(buffer)="[object Object]"，必须 .toString()。
12. **弃用 API = bug**：见到 deprecation warning 全仓清零，用最新替代 API。
13. **electron-vite dev 三端热更（无需手动重启）**：渲染改动 → Vite HMR；preload 改动 → 自动重载渲染；main 改动 → 自动重启 Electron 进程。多行内容补丁用 Write 脚本文件，不走 bash 内联引号。

## 工具页规范（新工具/edm 必守）
- 布局用 `ToolPageLayout` 三段式：head flex:none / body flex:1 唯一滚动 / foot flex:none。
- 操作列铁律：实体按钮 ≤3（常用优先）+「更多」下拉收低频；列宽 3 按钮 190、4 按钮 230。
- 样式统一走 theme.css / `.op-row` 全局类；暗亮双主题都要验证（用 rgba 灰 + el 变量，不硬编码色值）。
- 每完成一个逻辑小节单独 commit + push；husky 门禁跑不动时用 `.git/cph` 钩子（shebang `#!/bin/sh`），绝不 --no-verify。

## UI 视觉规范（按钮上色，2026-11-14 用户硬规则）
- **所有按钮 / 操作，能加色彩的尽量加语义色**，提升美观度：主操作 `type="primary"`、次操作 `info`、正向 `success`、警示 `warning`、危险 `danger`；纯文字按钮用 `type="primary" text` 等带色文字。
- 色彩必须走 Element Plus 语义 `type` + el/主题 CSS 变量，**禁止硬编码色值**（与「工具页规范」一致，暗亮双主题都要验证）。
- 适用范围：全项目（设置抽屉、工具页、对话框、操作列等所有交互控件），新增 UI 默认带色，存量 UI 顺手一并上色。

## 工具包开发 / 分发（2026-11-14 确立）
- **双形态、零差异开发**：内建工具放 `tools/<id>/`（assets/scripts/src + tool.manifest.json），宿主构建期自动发现；外部分发打 `*.sshktool`（zip）。开发态目录结构、能力声明完全一致，仅「分发形态」不同。
- **打包**：`node scripts/pack-tool.mjs <id>`（方案 A：manifest + dist + assets，排除 src/scripts/node_modules）。
- **签名（官方）**：`node scripts/sign-tool.mjs <id>`，私钥走 env `SSHK_OFFICIAL_SIGNING_KEY`（pkcs8 PEM）；公钥登记于 `packages/shared/src/trust.ts` 的 `OFFICIAL_PUBLIC_KEYS`（keyId = 公钥 sha256）；轮换 `SSHK_ROTATE_SIGNING_KEY=1` 现场生成新密钥。
- **安装防护**：`runtime:preview` 写盘前裁决——内建同名冲突(D-C)直接拒绝；降级(D-D)由用户确认；`installPackage` 不再静默覆盖。
- **渲染层契约**：外部包渲染层为「零 import ESM」，经 `window.SSHK` 取全量 Vue API（已扩展 h/ref/reactive/computed/watch/onMounted/onUnmounted/nextTick/provide/inject 等）。
- 全量设计见 `docs/02-architecture/2026-11-14-工具包开发打包分发工作流规划.md`。
