# 项目长期记忆（sshk-tools）

## 记忆文件约定（2026-11-15 用户拍板）
- **项目记忆唯一位置 = `.workbuddy/MEMORY.md`**（本文件）；**不再**使用 `.workbuddy/memory/` 目录（其下 MEMORY.md 副本已合并删除，历史日志保留待清理）。

## 依赖约定（用户硬规则）
- **所有 npm 包依赖尽量用 `latest`，不要钉具体版本号**。新增依赖也用 `latest`。
- 例外：workspace 内部包用 `workspace:*`，仅此一种锁版本形式。
- **第三方有的优先用第三方包，不要自己造轮子**（2026-11-14 重申）：图标、字体、日期、工具库等先查成熟包；已点名 `@element-plus/icons-vue`、Font Awesome 可用。内部 CI 校验脚本（零依赖）属「无合适包」例外。

## 迁移兼容克制原则（2026-11-23 用户拍板）
- **新增代码默认不做迁移兼容**：不写旧键/旧字段/旧通道读取兜底，不为历史数据加转换分支。确需兼容**先提示用户、由用户决定**，禁自作主张。
- 若用户同意加：兼容逻辑**独立小块、贴近入口、显式注释标注可删除点**，禁止散落进业务深层，方便随时干净移除。
- 与既有已落地迁移链（改名 first-wins、P4-8c 配置键迁移）不冲突：那些保留不动，本条只管新增决策。

## 里程碑状态
- **1.0.0 已发布**（tag v1.0.0，2026-11-14）：含自动更新 UX 重塑、GitHub 安装器命名区分、发布构建前清 dist；发布后修复若干运行时问题（runtime-sample 打包态加载、按钮样式等）。由用户手动 `pnpm release` 发布（非 AI 代发），AI 提交后 push。
- **edm-studio 系统内容页效果版已交付**（2026-11-15，commits 1026dfc/6dde4d0）：实体树 EDM→品牌→类目→族→版本 + 六处 css 目录、v5 分层右键、元数据表单↔数据、版本 tab（元数据/示例数据/预览/源码/样式）、内联 style.css、IPC 门控（!isPackaged||developerMode）；规划文档 v5（R12–R18），用户边看效果边提需求迭代中。**插件宿主 PluginDeps 已注入 config**（内置工具门控用，写死在 apps/desktop/src/main/plugins.ts）。

## dev/build 一致性铁律（2026-11-14，最高优先级）
- dev 与 build 的**权限/沙箱/可见性/功能裁决完全一致**；dev 只允许多「开发辅助入口」（清单编辑、构建、打包按钮等）。
- **tools/ 源码一律内建化对待**：dev 不存在「加载外置包」概念；同 id 与安装区副本冲突**始终取 tools/ 源码**（全局统一规则，安装记录不删不消费）。
- 权限列表 dev 全量展示 + 真实状态 tag；桌面严格受真实可见性控制（两端一致）。
- **开发模式铁律**：dev 运行（`pnpm dev`）= 所有功能/表单项/配置全量展示、全量可编辑，不受任何变量控制；`app.developerMode` 等开关仅在打包/安装版生效。新功能门控一律走 `devFeatures = isDev || cfg.developerMode`（先例：AppSettingsDrawer.vue），禁止 dev 下再套条件。详细见仓库根 `AGENTS.md`。

## 踩坑清单（2026-11-13 起持续累积，牢记不再犯；M5 分级重组 2026-11-16）

> 四组分级：`[运行]` 运行期行为 / `[构建]` 构建期与门禁 / `[依赖]` 依赖版本 / `[环境]` IDE 与提交流程。新坑按组追加。

### 运行期

1. `[运行]` **manifest 契约**：`package.ipcAllowlist` = 包主动调用的**宿主 IPC 通道**白名单；工具**自身注册的通道**放 `plugin.channels`。放错位置 → 导入报「未声明的 IPC 通道」。
2. `[运行]` **CSP 分指令**：动态 import 要 `script-src 'self' blob:`（apps/desktop/index.html）——「Failed to fetch dynamically imported module」优先查 CSP；img 显示正常 ≠ fetch 可用，snapdom 截图 fetch 外链图被拦 → 还需 `connect-src https:`（2026-11-16 补）。
3. `[运行]` **computed 里禁止副作用**：加载/请求逻辑放 watch（immediate）+ 按 id 记 loading/failed 状态，失败不自动重试，否则反复触发形成弹错风暴。
4. `[运行]` **占位组件真值陷阱**：`toolComponent` 无 loader 时必须返回 `null`，不能返回 truthy 占位组件，否则短路后续分支（运行时渲染曾因此成死代码）。
5. `[运行]` **悬浮按钮定位**：absolute 子元素在滚动容器内会随内容滚走，要放在外层 relative 包裹层（如 chat-main）。
6. `[运行]` **Element Plus 2.14 select DOM**：`.el-select__wrapper(.is-hovering/.is-focused)`，样式用 `:deep()` + box-shadow inset 描边。
7. `[运行]` **Buffer.toString()**：decryptString 返回 Buffer|string 联合时 String(buffer)="[object Object]"，必须 .toString()；Electron async API 解析为 `{result, shouldReEncrypt}` 对象同理。
8. `[运行]` **snapdom 截图三坑（同族链）**：① 外链图未加载完 → 灰占位（waitForAssets 兜底）；② fetch 被 CSP/CORS 拦 → 数据内联（main 侧下载转 dataURL）；③ body 无显式背景 → PNG 透明底呈灰（computed 透明才铺白 + backgroundColor 选项，2026-11-16）。

### 构建期

9. `[构建]` **JS 注释里的 glob**：块注释中写 `tools/*/src` 这类含 `*/` 的模式会提前闭合注释，后半段变代码引发 TS2304。注释路径改写为不含 `*/` 的形式。
10. `[构建]` **textarea 代码定位**：wrap=off（逻辑行=视觉行）+ getComputedStyle 实际行高算 scrollTop。
11. `[构建]` **electron-vite dev 三端热更（无需手动重启）**：渲染改动 → Vite HMR；preload 改动 → 自动重载渲染；main 改动 → 自动重启 Electron 进程。多行内容补丁用 Write 脚本文件，不走 bash 内联引号。
12. `[构建]` **时间规范门禁**：渲染层/main 禁止 `toISOString()`（verify check:structure 拦截），一律用 `@sshk/shared` time.ts 的 `now()`/`format()`（北京时间）。
13. `[构建]` **弹框门禁**：所有 `el-dialog` 必须 `close-on-press-escape="false"` + `:close-on-click-modal="false"`（check:dialogs 拦截），防误触丢表单。

### 依赖

14. `[依赖]` **弃用 API = bug**：见到 deprecation warning 全仓清零，用最新替代 API。
15. `[依赖]` **Vue2/Vue3 依赖版本陷阱（同一坑，多个库都有）**：这些库的 npm `latest` 指向 **Vue2** 线，Vue3 项目必须钉对应大版本：
    - `@wangeditor/editor-for-vue` 的 `latest`（1.0.2）peerDeps `vue: ^2.6.14` → 改用 `@wangeditor/editor`（core 5.x）自行封装（见 `tools/edm-studio/src/renderer/RichTextEditor.vue`）。
    - `vuedraggable` 的 `latest`（2.24.3）是 **Vue2** 版 → Vue3 必须钉 `^4`。
    - 规则：遇到「Vue2/Vue3 双线」库绝不能无脑写 `latest`，先确认本项目 Vue 大版本再钉对应主版本号。升级流程见 `docs/05-release/依赖升级SOP.md`（A-T4）。

### IDE 与提交流程

16. `[环境]` **volar 坑**：导入的 reactive 对象在模板被错误 ref 解包 → 跨模块共享可变对象一律用 `ref`；模板 `ref="xxx"` 字符串不算绑定被读取（TS6133），用 `:ref` 函数绑定。
17. `[环境]` **提交输出勿接 head/tail 管道**：commit 输出被 head 截断会 SIGPIPE 打断提交（exit0 但 commit 没成）——输出重定向到文件或不截断。husky 门禁内 verify 会跑 install，docs 批次提交后检查 lockfile 残留并单独补提交。
18. `[环境]` **backup.test.ts Windows 抖动**：全量还原用例对 NeDB 临时文件 rename EPERM 敏感（并发构建时偶发 5s 超时），单跑即过；vitest worker 启动超时同属环境抖动，重试即过。
19. `[环境]` **TS6 noUncheckedIndexedAccess**：Record/数组联合键索引一律判 undefined（含模板表达式），读取处加 `?? 兜底` 或 helper 函数。
20. `[环境]` **提交前核实落盘**：node 脚本批量改文件后必须 grep 关键改动真实生效（曾跑出空 diff 提交）；reactive→ref 迁移后所有 `Object.assign(form,`/`(form)` 形态逐个核对（曾漏 3 处）。

## 工具页规范（新工具/edm 必守）
- 布局用 `ToolPageLayout` 三段式：head flex:none / body flex:1 唯一滚动 / foot flex:none。
- 操作列铁律：实体按钮 ≤3（常用优先）+「更多」下拉收低频；列宽 3 按钮 190、4 按钮 230。
- **渲染层目录约定**：内建工具 renderer = `<Id>Page.vue` 壳（toolId prop 注入 + menu 分发）+ `pages/` 每菜单一页 + `state.ts` 模块单例；toolId 单一来源 = manifest.id，config key 一律 `configKey(key)` 动态拼装；跨页状态必须活 state.ts 单例（不引入 Pinia——外部包 Blob URL 零 import 契约冲突所致）。
- 样式统一走 theme.css / `.op-row` 全局类；暗亮双主题都要验证（用 rgba 灰 + el 变量，不硬编码色值）。
- 每完成一个逻辑小节单独 commit + push；husky 门禁跑不动时用 `.git/cph` 钩子（shebang `#!/bin/sh`），绝不 --no-verify。

## UI 视觉规范（按钮上色，2026-11-14 用户硬规则）
- **所有按钮 / 操作，能加色彩的尽量加语义色**，提升美观度：主操作 `type="primary"`、次操作 `info`、正向 `success`、警示 `warning`、危险 `danger`；纯文字按钮用 `type="primary" text` 等带色文字。
- 色彩必须走 Element Plus 语义 `type` + el/主题 CSS 变量，**禁止硬编码色值**（与「工具页规范」一致，暗亮双主题都要验证）。
- **能用图标处尽量用图标**（`@element-plus/icons-vue` 与 Font Awesome 已批准），不将就纯文字/裸箭头。
- **控件与说明文字必须有间距**（2026-11-15 用户反馈，全项目铁律）：开关/输入框后接 hint 说明文字一律 `margin-left: 8~12px`，禁止紧贴；新增 UI 自查此项。
- 适用范围：全项目（设置抽屉、工具页、对话框、操作列等所有交互控件），新增 UI 默认带色，存量 UI 顺手一并上色。

## 工具包开发 / 分发（2026-11-14 确立）
- **双形态、零差异开发**：内建工具放 `tools/<id>/`（assets/scripts/src + tool.manifest.json），宿主构建期自动发现；外部分发打 `*.sshktool`（zip）。开发态目录结构、能力声明完全一致，仅「分发形态」不同。
- **打包**：`node scripts/pack-tool.mjs <id>`（方案 A：manifest + dist + assets，排除 src/scripts/node_modules）。
- **签名（官方）**：`node scripts/sign-tool.mjs <id>`，私钥走 env `SSHK_OFFICIAL_SIGNING_KEY`（pkcs8 PEM）；公钥登记于 `packages/shared/src/trust.ts` 的 `OFFICIAL_PUBLIC_KEYS`（keyId = 公钥 sha256）；轮换 `SSHK_ROTATE_SIGNING_KEY=1` 现场生成新密钥。
- **安装防护**：`runtime:preview` 写盘前裁决——内建同名冲突(D-C)直接拒绝；降级(D-D)由用户确认；`installPackage` 不再静默覆盖。
- **渲染层契约**：外部包渲染层为「零 import ESM」，经 `window.SSHK` 取全量 Vue API（已扩展 h/ref/reactive/computed/watch/onMounted/onUnmounted/nextTick/provide/inject 等）。
- 全量设计见 `docs/02-architecture/2026-11-14-工具包开发打包分发工作流规划.md`。

## 项目要点速查
- 门禁：`pnpm verify`（13 道 + vitest 131 用例）；提交 conventional + 推 main；husky 钩子本机跑不通，用 `git -c core.hooksPath=.git/cph commit`。
- 签名：公钥唯一真相源 `packages/shared/src/official-keys.json`；私钥三来源（轮换 env > 显式 env > `~/.sshk/official-signing-key.pem`）。
- 外部包运行时 = Blob URL 动态 import → 源码必须零 import ESM；构建 `build-external.mjs`，无 bundler。
- 工具展示覆盖（改名等）存 settings `app.toolOverrides`，跨升级保留。
- pnpm 配置（overrides 等）统一落 `pnpm-workspace.yaml`，不放 package.json。

## 应用级共享能力（R26 上传 / R27 编辑器，2026-11-15 落地）
- **分层**：`packages/upload-core` 是 main 进程能力包；`packages/code-editor` / `packages/rich-text` 是渲染层组件包，二者互不 import。富文本图片上传是唯一交汇点，收敛为 `RichTextUploadHook = (file: File) => Promise<string>` 回调，由工具侧注入（EDM `renderer/upload.ts`）。
- **密钥红线**：全局配置 `app.upload.*` 存 settings.json（不含密钥），profile 密钥按 `app:tool:upload-config:<id>` 存 secrets.bin（safeStorage）；`upload:secret:state` 只回布尔，绝不回明文。
- **校验语义**：`mergeValidation` = 扩展名取交集 / 大小取更小值；**工具未设限的字段必须是 `undefined`**，传空数组或 0 会变成「放宽」。纯函数在 `packages/shared/src/upload-config.ts`。
- **configGroup 路径字段**：`check:contract` 要求含 dir/path/目录/路径/file/文件 的字段用 `dir`/`file` 类型；远端服务器位置不是本机目录 → 字段名改 `remoteFolder`（string），main 侧兼容 `remotePath`/`remoteFolder` 两键。
- **构建期坑（rolldown）**：`ssh2` 的 optional 依赖 `cpu-features` 会静态 require 缺失的 `.node` 文件，导致 `apps/desktop build` 失败。已在 `electron.vite.config.ts` 把 `cpu-features` alias 到 `apps/desktop/src/main/stubs/cpu-features.cjs`（抛错函数），靠 ssh2 的 try/catch 回退纯 JS。新增 Node 侧依赖声明在 packages 层即可（会被内联进 main bundle），不要加到 `apps/desktop/package.json` 变成 external。
- **新 workspace 包**：cph 门禁的 `pnpm -C apps/desktop build` 会触发 `verifyDepsBeforeRun` 自动建 `<包>/node_modules` 链接并同步 `pnpm-lock.yaml`；因此 `vue-tsc` 要放在 build 之后重跑，否则新包报「找不到模块」。这不是 AI 主动 install，符合用户规则 #1。
- **vue-tsc 坑**：深层 `v-for` 嵌 `v-model` 会丢作用域（`Cannot find name 'item'`）/ 把 `reactive` 误判成 ref（`.value` 不存在）。解法：容器统一用 `ref`，把深层表单抽成子组件。
- **R28 CSS**：用户否定「就近自动全收」为主机制。现为源码显式 `<link>` + 逻辑 URI（`@shared`/`@root`/`@system`/`@custom`/`./css`），禁 `..`，head 提前去重注入；无 link 时回退就近链兼容存量。实现在 `tools/edm-studio/src/core/css-refs.ts`。

