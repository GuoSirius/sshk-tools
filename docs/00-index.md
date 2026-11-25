# 文档索引与决策看板

- 状态：**应用功能已全量落地（M0~M7 + P0~P9 整改批次）：应用管理架构 D53（三基础模块并入应用、纯工具仅 edm/badge/template）、PaddleOCR 已移除、三轮 CodeReview 全部整改闭环。当前为「验证收尾阶段」——细节验证与健壮性，不再追新功能。全量遗留项见 `02-architecture/遗留事项与收尾总账.md`。**
- 版本：v2.0（2026-11-23 文档清理：删除全部历史 CodeReview 报告与归档过程稿，决策结论固化为 §四看板）
- 最后更新：2026-11-23（北京时间；组织结构优化落地：P0 硬编码/依赖声明、P1 store.ts 收敛与 shared 拆包、P2 main 域归拢、P3 命名规范回写；466 测试全绿）。P9-1 云链路实测与 P9-2 .sshktool 演练待真实账号/样例包。
- 仓库根：`D:/workspace/code/sshk-tools`
- 远程：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
- 唯一入口：本文件。任何沟通文档都要在这里登记；找不到就说明还没归档。
- **时间规范：全文一律北京时间，不使用 UTC**（T10）。

---

## 一、文档清单

| 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|
| **★★ 规范与铁律总纲（新设备首读）** | `00-CONVENTIONS.md` | **权威汇总 · 唯一入口** | 目录/设计/文件/命名/使用/契约规范 + 全部铁律；AGENTS.md 是其摘要。新会话先读本文件再读 00-index |
| **需求沟通记录** | `01-requirements/需求沟通记录.md` | 已合并归档 | 需求 0~7 + 术语表 + D10 输入组合 + 逐轮决策浓缩 + 开放问题 |
| **技术选型与任务拆分 v0.4** | `02-architecture/2026-11-12-技术选型与任务拆分.md` | 历史设计稿（**门禁强依赖，勿删**） | 选型对比、四层 UI、T1~T10、M0~M7；决策以 §四看板为准，实现以代码为准 |
| **工具插件化需求台账（长期维护）** | `02-architecture/工具插件化需求台账.md` | 持续演进 | 穿插需求台账、工具包契约、宿主能力、插件化路线图、UI 视觉铁律 |
| **★ 遗留事项与收尾总账** | `02-architecture/遗留事项与收尾总账.md` | **收尾阶段唯一入口** | 按 6 方向归集全部未完成/待验证/待确认项，逐条标状态+来源 |
| **工具开发指南** | `02-architecture/工具开发指南.md` | 已落 | 从零建工具：目录结构、manifest 字段、入口契约、门禁、常见报错 |
| **安全与密钥体系** | `02-architecture/安全与密钥体系.md` | 单一权威 | 五套口令/密钥对照表、进程边界红线、密钥流转、env 清单、外部包信任链、日志脱敏 |
| **EDM 内容管理统一规划 v6（权威）** | `02-architecture/EDM系统内容页改造与内容管理统一规划_v6.md` | R12–R24 已落地 | 统一组合引擎、邮件管理、双顶层内容管理；**EDM 唯一权威** |
| Nunjucks 数据继承 + 邮件管理重构方案 | `02-architecture/2026-11-25-Nunjucks数据与继承及邮件管理重构方案.md` | **已落地（2026-11-25 A→E 五批次全部提交）** | 11 条需求 + 14 条修订的实现方案/开口清单；v0.6（方案 A + `template.*` 命名空间隔离 + 三场景确认语义分化 + Q3/Q4 拍板 + §九 实施记录）；逐批提交 `ec5d0ec`/`92faf82`/`ef91152`/`71653b4` + 文档收口；台账 #193~#197 已落地 |
| EDM 待收尾与验证清单 | `02-architecture/EDM待收尾与验证清单.md` | 验证执行清单 | V1–V13 + A–E 逐条验证动作；汇总入口见遗留总账 |
| **EDM 旧资产迁移计划（已落地）** | `plans/14-EDM旧资产迁移.md` | 批次 0~7 全部完成 | CSS 单链路、公共样式层、双品牌 default 资产、邮件兼容整改；各批 commit 见文档 §九 |
| **文件管理操作行为清单** | `02-architecture/文件管理操作行为清单.md` | 行为基线 | 文件管理各操作的行为契约与验收口径 |
| 列表页/留白规范（薄壳重定向） | `02-architecture/列表页筛选与操作栏规范.md`、`页面留白与间距规范.md` | 薄壳防断链 | 正文已并入 `plans/01-UI与页面规范.md` §二/§三 |
| **数据契约 v0.2** | `04-api/2026-11-12-数据契约.md` | 历史基线（**门禁强依赖，勿删**） | 品牌树、黑白名单、北京时间、配置、zip + 密钥、IPC；实际以代码为准 |
| **发布流程与本机提交钩子** | `05-release/2026-11-12-发布流程与本机提交钩子.md` | 已落 | 发布流、Git 铁律、lockfile、无签名发布、Electron 配置 |
| **首次安装指引** | `05-release/2026-11-12-首次安装指引.md` | 已落 | Windows/macOS/Linux 无签名安装说明 |
| **代码签名证书获取与配置** | `05-release/代码签名证书获取与配置.md` | 已落 | 证书申请与配置流程 |
| **官方签名密钥跨设备开发** | `05-release/官方签名密钥跨设备开发.md` | 已落 | 换设备开发的密钥迁移（`scripts/sign-tool.mjs` 引用） |
| **依赖升级 SOP** | `05-release/依赖升级SOP.md` | 已落 | 触发条件/升级步骤/verify+audit/breaking 处理 |
| **开发计划总览** | `plans/00-规划总览.md` | 规划索引 | 收尾轮 77 条反馈的分类计划索引与排期 |
| **UI 与页面规范（唯一清单）** | `plans/01-UI与页面规范.md` | 已定稿 | 表单/列表页/留白/弹框/按钮图标/公共组件接线/空态 + 逐页验收 |
| `plans/02` ~ `plans/07` | 工具创建配置统一 / 健壮性加固 / 诊断可观测 / 扩展能力 / 开发体验 / 文档治理 | 规划 | 六份分类专项规划 |
| `plans/08` ~ `plans/13` | 文件系统 / 常驻分享 / 传输队列 / 内容管理 / 分享服务工具化 / 表单设计 | 设计（已落地） | 六大能力域的详细设计稿 |
| 验证会话数据 | `docs/verify-sessions/`（4 个 JSON：11-17/18/19/21） | 数据目录 | dev 运行时落盘的验证步骤结果快照，非沟通文档 |
| 原始需求快照 | `../requirement.txt` | 只读 | 用户原始输入，不修改；冲突时以此为准 |

> 说明：`技术选型与任务拆分` / `数据契约` 被 `scripts/verify-structure.mjs` 门禁强依赖（路径硬编码），**保留原位勿删**。
> 历史 CodeReview 报告、归档过程稿、已落地规划的一次性过程文档已于 2026-11-23 清理删除；其决策结论固化在 §四看板，实现以代码为准。今后归档按 `99-archive/` 只移不删执行（本次为一次性特例清理）。

## 二、目录规范（需求 0）

```
docs/
├── 00-CONVENTIONS.md    ← 规范与铁律总纲（新设备首读）
├── 00-index.md          ← 本文件，唯一入口
├── 01-requirements/     ← 需求快照（ADR 统一记 00-index §四）
├── 02-architecture/     ← 现行架构规范、长期台账、工具开发/安全/EDM 权威文档
├── 04-api/              ← 数据契约（门禁强依赖）
├── 05-release/          ← 发布流程、签名、首次安装指引、依赖升级 SOP
├── plans/               ← 分类计划（00 总览 + 01 UI + 02~07 专项 + 08~12 能力域设计）
└── verify-sessions/     ← dev 运行时验证步骤结果快照（数据，非沟通文档）
```

> **2026-11-23 文档清理**：历史 CodeReview 报告（`06-codereview/`）、归档过程稿（`99-archive/`）、已落地规划的一次性过程文档已删除；决策结论全部固化在 §四看板（D1~D55）。今后新增归档走 `99-archive/`（只移不删），本次为一次性清理特例。

> `assets/` 已从 docs 下移除：项目自有图标/logo 统一在 `apps/desktop/build/`（electron-builder `buildResources`）；
> 不设仓库根 `public/`（见 D28）。

| 规则 | 内容 |
|---|---|
| 唯一区域 | 除根 README，所有沟通文档只在 `docs/` |
| 命名 | 一次性 `YYYY-MM-DD-主题.md`；长期维护 `NN-主题.md` |
| 元信息 | 每篇头部写 `状态 / 版本 / 最后更新 / 关联需求` |
| 状态机 | `草稿 → 讨论中 → 已定稿 → 已归档` |
| 定稿后 | 不原地大改，改结论按主题新开 ADR |
| 图片 | 沟通证据原图不进仓库；**项目自有图标/logo 进仓库**（由生成脚本产出） |
| **时间** | 文档内所有日期时间一律北京时间 |
| 临时产物 | `.tmp/<用途>/`，`.gitignore` 登记，用完即删 |

完整工程目录见选型稿 §1.1。

## 三、当前仓库实际状态

| 项 | 状态 |
|---|---|
| Git | ✅ 两次提交推送 `ab4a739` / `b40186a` 到 `main` |
| 根配置 | ✅ `package.json` / `pnpm-workspace.yaml` / tsconfig / eslint / commitlint / `.npmrc` / .gitignore 等 |
| 共享包 | ✅ `packages/shared`（北京时间 `time.ts` + 常量/类型/IPC 契约 + 工具注册表/裁决 + 单测） |
| 校验脚本 | ✅ `check-latest` / `check-boundaries` / `verify-structure` / **generate-icons.py** |
| CI | ✅ `.github/workflows/ci.yml`（`--frozen-lockfile` + `pnpm verify`） |
| 本机钩子 | ✅ husky（`.husky/pre-commit` = `pnpm verify` + desktop build）；原 `.git/cph` 方案已废弃删除（A-Q1） |
| **M1 应用壳** | ✅ `apps/desktop/`：main / preload / renderer、四层布局、三态换肤、3 个工具注册、UnoCSS、`electron.vite.config.ts`（三端热更新）、`electron-builder.config.cjs` |
| **图标资源** | ✅ 已生成并接入打包配置（纯标准库脚本，零依赖） |
| TS 6 切换 | ✅ `typescript: "6"` → 6.0.3，lockfile 已同步 |
| **M2 发布与更新** | ✅ `release.yml`（tag 触发三平台）、`05-release/首次安装指引.md`、autoUpdater IPC + 检查更新按钮 |
| **构建脚本白名单** | ✅ `allowBuilds: electron / esbuild / electron-winstaller`（pnpm 12 规范写法，修复 `ERR_PNPM_IGNORED_BUILDS`） |
| **本机验证** | ✅ 依赖已安装；`pnpm verify`（13 门禁，测试数随迭代增长，以最近输出为准）、`pnpm dev`、`pnpm dist` Windows 打包均实测通过 |
| 功能页 | ✅ M7 / M6 / M4 / M5 三个工具功能页全部落地 |
| **工具目录与设置中心** | ✅ 主进程单一裁决（启用 / 密钥权限 / 依赖 / 分发白名单 / 元数据覆盖）；顶部设置抽屉管理应用级配置，工具左侧只管工具自有配置；三张独立工具图标 + 无效回退 |

## 四、决策看板（**全部已定**）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 首页布局 | C 混合；左侧菜单可折叠展开 |
| D2 / D3 | 模板引擎 / UI 库 | Nunjucks / Vue 3 + Element Plus |
| D4 | 构建/更新/changelog | 方案 A；按 juice-email-cli 复用（本机钩子现行为 husky，`.git/cph` 已废弃删除） |
| D5 / D6 | 国产 OS / 签名 | x64 + arm64 / 无证书不签名，留开关 |
| D7 / D8 / D9 | 绑定 / 版本 / 数值列 | 槽位声明式 / 不可变+两种复制 / `Clicks` |
| D10 | 输入组合 | 图片/excel/csv/json 四种上传 + 邮件 HTML「选择已生成 / 上传外部」→ 生成 |
| D11 / D12 | 长图 / 落盘 | `@zumer/snapdom` / `@seald-io/nedb` |
| D13 / D14 | 工具命名 / 名单粒度 | `edm-studio` + `badge-studio`；版本 ID 为主 + 族批量，ID 用户无感 |
| D15 / D16 | 分享 / 大模型 | 局域网只读 HTTP 预览；两层 gateway + `model-console` |
| D17 / D18 | 导入冲突 / 密钥跨机 | 整包覆盖；填「迁移口令」即加密携带 100% 还原（D18 2026-11-17 起无 env 开关） |
| **D19** | 覆盖产物后悔药 | **直接覆盖，不留 `.prev`、不留历史副本** |
| D20 | 依赖版本 | 外部包一律 `"latest"`；**lockfile 必须提交 + CI `--frozen-lockfile`** |
| **D21** | 产物目录与迁移范围 | 可改 `app.outputDir`；**只搬 `outputs/` + `assets/`** |
| D22 | 时间 | 一律北京时间，不用 UTC；`shared/time.ts` + dayjs |
| **D23** | **模块系统** | **ESM 优先、兼容 CJS**；preload **产物**必须 `.cjs`（sandbox） |
| **D24** | **TypeScript 版本例外** | **6.x 最新版 `"6"`（6.0.3）**，其余包仍 `latest` |
| **D25** | **Electron 打包** | 允许选择安装目录（NSIS）；缺失项及时上报；**图标已补齐** |
| **D26** | **实现顺序 / M6 先行** | **M0→1→2→3→7→6→4→5** |
| **D27** | **开发热更新** | **electron-vite**：主进程改即重启、preload 改即重载、渲染 HMR；ESM main + CJS preload |
| **D28** | **共享静态资源位置** | **不建仓库根 `public/`**：图标/logo 归 `apps/desktop/build/`（buildResources，打包必需）；渲染层静态资源归各 Vite 应用自己的 `public/`；跨工具数据类资产归 `assets/` 数据目录（D21），不进代码仓库 |
| **D29** | **品牌管理独立页面** | 品牌列表 + 增删改独立页面，纳入 M4（品牌树本就含 Brand 实体）与 M4 一起执行 |
| **D31** | **图标库** | 需要图标的界面优先用 FontAwesome（`@fortawesome/fontawesome-free` CSS 版或 `@fortawesome/vue-fontawesome` 组件版），与 Element Plus 图标并存不冲突 |
| **D30** | **造轮子禁令** | 能用成熟 npm 包就不再手写：`ulid`（替代手写 ULID）、`nanoid`、`es-toolkit` 等按需引入；自研仅限零依赖校验脚本与 icon 生成（无合适包） |
| **D32** | **配置分层** | `app.*`（应用/系统级）→ 顶部「设置」；`tools.<id>.*`（工具自有）→ 工具左侧「工具配置」；密钥 → `secrets.bin`（safeStorage）。工具菜单绝不夹带应用级配置 |
| **D33** | **工具目录单一裁决** | 注册表真相源上移 `packages/shared/src/tool-catalog.ts`；主进程 `resolveToolCatalog` 统一裁决启用 / 权限 / 硬依赖链 / 软依赖预警 / 分发白名单 / 元数据覆盖，渲染层只消费结果，无法自行放开受限工具 |
| **D34** | **访问密钥与权限管控** | 明文只进 safeStorage，settings 仅存 sha256 摘要；工具可设「需访问密钥」（grant `tools.restricted`），未配置时不出现在桌面；grants 结构预留后续登录 / 远端校验 |
| **D35** | **工具图标与元数据** | 卡片名称 / 描述 / 分类 / 图标 = 注册表默认 + `app.toolOverrides.<id>` 覆盖；内置 edm / badge / model 三张独立 SVG；未配置、非法协议、无效 key 或加载失败一律回退系统默认四色图标 |
| **D36** | **应用级菜单扩展性** | 顶部栏只留高频项 + 「更多」下拉 + 「设置」；设置抽屉采用左侧分组导航（常规 / 工具与权限 / 系统与数据 / 关于），后期新增菜单只加分组，不挤占顶部栏 |
| **D37** | **依赖方向反转** | **应用不强依赖工具，工具可强依赖应用**：宿主只认 `tool.manifest.json` 契约；宿主能力经 `ToolHostCapabilities` 注入插件（config / repository / IPC / LLM / safeStorage；本机 OCR 已随 CF-5/P7-1 移除） |
| **D38** | **工具零依赖与禁用隔离** | 清单默认 `dependsOn: []`；单个插件加载失败 / 禁用只影响自己，guarded IPC 每次调用实时裁决；硬依赖链可配置传播，软 `configDeps` 只预警 |
| **D39** | **工具包自包含（推翻 D35 的宿主图标）** | 名称 / 描述 / 多分类 / 图标 / 菜单 / 配置项 / 默认配置 / 依赖 / 权限 / 插件入口**全部归工具包自己的 `tool.manifest.json` 与 `assets/icon.svg`**；宿主 `apps/desktop/src/renderer/assets/tools/` 已删除 |
| **D40** | **构建期自动发现，零改动接入** | `import.meta.glob` 扫 `tools/*` 的清单 / 图标 / main / renderer；`electron.vite.config.ts` 与 `vitest.config.ts` 动态扫包生成 alias；新工具包放进 `tools/` 即构建可用 |
| **D41** | **插件入口强契约** | `src/main/index.ts` 必须 `export default` 注册函数（或具名 `register`）；禁止「随便挑一个函数」，避免误挑 `parseDatasource` 导致 IPC 静默未注册 |
| **D42** | **配置形态两选一 + 浏览器式刷新** | `configLayout: single / menu`：形态 1 `single` = 单个「工具配置」菜单进去左右布局（现有工具全用此形态）；形态 2 `menu` = 「工具配置」展开二级菜单，每个二级菜单一个真实页面、页内复用左右布局，`configPages` 声明每页含多个分组（template-tool 为示例）。历史值 `tabs` 归一为 `single`。F5 / Ctrl(Cmd)+R 刷新，Ctrl+F5 / Ctrl(Cmd)+Shift+R 忽略缓存，「更多」下拉提供入口 |
| **D43** | **多分类 / 标签** | `category: string \| string[]` + `tags[]` → 裁决层 `categories[]`；卡片 / 侧栏 / 搜索 / 设置覆盖全链路支持多个分类 |
| **D44** | **Badge 图片数据源** | 图片 → 云端视觉模型 → `parseVisionResult()` → 标准 `StatRow[]` → 回填可校对 CSV（本机 OCR 已随 CF-5/P7-1 移除）；`llm-gateway` 支持 `image_url` 多模态；**视觉模型 API Key 只进 safeStorage，绝不写仓库** |
| **D45** | ~~PaddleOCR 作为可插拔识别源~~ | **⛔ 已推翻 2026-11-21（CF-5）→ P7-1 彻底移除**：本机 OCR 能力、`runLocalOcr` 宿主通道、`paddleocr_adapter.py` 适配器全部删除；Badge 图片识别仅保留云端视觉模型 + 人工粘贴校对。原文保留作历史追溯 |
| **D46** | **密钥标识校验纯函数化** | `app:tool:<id>:<name>` 标识抽出 `secret-ids.ts` 并放宽为大小写/下划线/连字符；修掉驼峰 `visionApiKey` 被判非法导致 Badge 加载即报错，补 3 个回归单测 |
| **D47** | **模型预设与真实模型列表下拉** | 常用 OpenAI 兼容端点（含 Agnes AI `/v1`）由 `model-console` manifest 自带，用户只填 Key；模型名 `el-select allow-create` + 「拉取模型列表」真实请求 `/models`；保存前可用临时 key 探测且不落盘；预设不含任何密钥 |
| **D48** | **IDE 项目归属收口** | 三套 tsconfig 全 0 错误即证明代码无误；根 `tsconfig.json` 刻意排除 apps，让 `apps/desktop/tsconfig.json` 独占 `.vue`；显式 `types: ["node","vite/client"]`；新增 `electron` paths；去掉反向作用的 Volar takeover 设置；`cspell.json` 消除拼写波浪线；换电脑后须按架构文档 §7.3 重载窗口 / 切工作区 TS 版本 / 重启 TS Server |
| **D49** | **创建工具向导 + 开发指南 + 清单表单化** | 骨架生成单一事实源 @sshk/shared/tool-skeleton（预览=落盘）；dev:toolCreate 主进程落盘（目录冲突拒绝）；双入口仅 dev 可见（更多下拉 + 设置抽屉）；清单编辑器 configGroups/configDeps/defaults/channels/dependsOn 全表单化 + JSON 预览 tab；指南 docs/02-architecture/工具开发指南.md |
| **D51** | **依赖选型反转（强化）** | **推翻旧「优先不新增依赖」倾向**：设计方案时**优先使用成熟第三方 / npm 包，不造轮子**；图标、字体、日期、工具库等常见需求先查成熟包。`@element-plus/icons-vue` 与 **Font Awesome**（`@fortawesome/fontawesome-free`）已批准直接用；仅零依赖校验脚本 / icon 生成脚本等无合适包时自研（与 D30 同源，措辞强化） |
| **D50** | **UI 视觉铁律** | **后续所有界面开发，能用图标处尽量用图标**（按钮 / 状态 / 操作列等）；界面须**美观大方、吸引用户、增强视觉体验**，不将就纯文字或裸箭头（`↓`/`▾` 等一律换图标库）。触发：自动更新按钮曾用 Unicode `↓` 被纠正 |
| **D52** | **dev/build 二态（删除 developerMode 开关）** | 敲板 2026-11-21：删除 `app.developerMode` 配置与全部用户可配置功能开关，门控唯一判据 `__SSHK_DEV__`（构建期 define 注入 main/preload/renderer 三端）；「dev 恒全量展示」铁律本体保留；安装版无开发者入口（DevTools 口令通道保留）。**推翻 2026-11-14「开发模式铁律」中的 developerMode 机制部分**（AGENTS/总纲随 P0-2 批次修订）；B25/D-3、D-2、Q-12、CR-46 随之作废 **【⛔ 已推翻 2026-11-21 终审 → D55：developerMode 保留不删；原敲板计划已清理，结论以本条 + D55 为准】** |
| **D53** | **应用/工具边界重划 + 应用管理架构** | 敲板 2026-11-21（重构新想法 1~8）：file-manager / model-console / share-manager 三个基础能力工具并入「应用管理」页面（左侧可折叠菜单 + 右侧内容；一级 = 应用设置 / 文件管理 / 模型管理 / 分享管理），成为应用本体；纯工具仅 edm-studio / badge-studio / template-tool；**工具 → 应用单向依赖，应用本体绝不依赖工具**。吸收 Q-03（FsRuntime 改判应用内 `main/modules/file/`）/Q-04/Q-22/S1/S2；**推翻 D36 设置抽屉形态**（应用设置变页面）；D39 自包含收窄为纯工具；最终菜单结构=文件/模型/分享/应用设置（沉底），模块 id `model-manager`，实现以代码为准（原敲板计划已清理） |
| **D54** | ~~CodeReview 文档独立目录~~ | **已随 2026-11-23 文档清理作废**：历史 CodeReview 报告全部删除、结论固化于本看板；今后如需 review 报告，按主题新建 `docs/YYYY-MM-DD-主题.md`，不再单设 `06-codereview/` 目录 |
| **D55** | **developerMode 保留 + dev 判据唯一化 + preview 归 dev（终审改判，推翻 D52）** | 用户 2026-11-21 终审：**保留** `app.developerMode` 与 `devFeatures = isDev \|\| cfg.developerMode` 机制（2026-11-14 铁律原文不变）；dev 判据唯一化照旧执行（`__SSHK_DEV__` define 注入三端 + `isSourceRepo` 分离），定值 `mode==='dev' \|\| mode==='preview'`（preview 归 dev）；恢复执行 D-2 写法收敛（shared 纯函数 + 统一下发）/ D-3 注释分节 / Q-12 图标字段 devFeatures 可改 / CR-46 订阅修复；env 烤入机制保持只修 bug（C-9）；应用管理菜单结构原样下移一级（C-6）、模块 id `model-manager`（C-11）、顶栏方案一（C-7）（原敲板计划已清理，结论以本条为准） |
| **D57** | **「表单设计」应用内置模块立项** | 用户 2026-11-23 敲板口径（方案 `plans/13`，实现待通知）：模块形态=应用内置模块（照 D53 模式改 AppAdminPage，非 tools/ 工具包），一级菜单 表单管理/控件管理（默认进表单管理）；数据源=NeDB 双集合 `forms`/`formControls` 进 BACKUP_COLLECTIONS；schema 真相源抽包 `@sshk/form-schema`（edm-studio 与新模块双消费，纯入口零 .vue + ui 子入口）；复合控件 design-time 引用 + runtime 展开（上限 3 层，结构防环）；EDM 保持 meta.yaml fields 自存，下拉选表单=**派生拷贝**物化为普通 FieldDef、不回写新模块 |
| **D58** | **FilePicker/UploadTarget 位置记忆收口（终审改判：保留 stateKey 分桶）** | 用户 2026-11-23 敲板后又终审改判（台账 #180）：**保留按 stateKey 分桶存取**（`sshk:file-picker:<stateKey>`，原「全局统一一份」口径作废，e496059 已完整回滚、全局键零残留）；连带清除遗留上传配置——badge-studio config-upload 死配置删、edm-studio config-upload（仅 validation）删、accept/maxSize 收敛全局上传校验、shared optionsSource 收窄 `'llm:providers'`；保留 Profiles 页/getUploadSecret/FILE_CONFIG_GROUPS/presets.ts |

> **覆盖说明**：D33 中「注册表真相源上移 `packages/shared/src/tool-catalog.ts`」与 D35 中「宿主内置 edm / badge / model 三张 SVG」已被 **D39 / D40 推翻**：
> shared 现为**纯契约 / 裁决层**（零具体工具数据），真相源下沉到各工具包 manifest；`DEFAULT_SETTINGS.tools` 也已清空。

### M7 依赖修正（用户 22:19 质疑）

早期任务表把 M7 依赖写成 `M2, M4` —— **是笔误**。`llm-gateway` / `model-console` / OS 能力与 EDM 业务无关，已改为**仅依赖 M1**（应用壳提供 IPC、配置、进程边界），并在选型稿 §5 与热更新文档 §6 同步。

### 待办（非决策）

| 项 | 说明 |
|---|---|
| **用户执行** | `pnpm install`（装 electron/vue/element-plus/unocss/electron-vite，已配国内镜像）→ `pnpm verify` → `pnpm --filter @sshk/desktop dev` |
| **用户提供** | juice-email-cli 输出路径（M6 先行）、现有 HTML 是否带 UTM / 有无 badge 属性；确认 appId/productName |
| **可选提供** | 代码签名证书、Apple ID、国产 OS 实机（不阻塞开发） |
| 旧工具存量数据 | 是否要 M4 附一次性迁移脚本 |
| M1 补校验 | preload `.cjs` 产物检查、条件导出双格式冒烟 |
| **用户执行（IDE）** | 按 `02-architecture/工具插件化需求台账.md` §7.3 七步操作：确认打开仓库根 → 装 Vue - Official → Reload Window → Use Workspace TS Version → Restart TS Server → Go to Project Configuration 验证 |
| **用户填写（视觉模型）** | Badge Studio「图片识别」面板填入 API Key（只落本机 safeStorage，不进仓库）→ 上传截图实测 |
| **用户执行（安装包）** | 本轮大量改动后重新 `pnpm dist` 生成 Windows 安装包做安装测试 |
| **后期排期（#8）** | 已发布应用中导入 / 安装 / 卸载外部工具包：需先定插件包格式、签名校验、版本兼容、运行时沙箱边界 |

## 五、变更记录

| 版本 | 日期 | 关键里程碑（详细历史已随 2026-11-23 文档清理删除） |
|---|---|---|
| v0.1~v0.4 | 11-12 | 首轮方案定版 D1~D21、仓库确定、M0 开工 |
| v0.5~v0.8 | 11-12/13 | ESM 优先 + TS6 + Electron 打包 + electron-vite 热更新 + M1 应用壳 + 发布更新 |
| v0.9~v1.1 | 11-13 | D29~D48：品牌管理/配置分层/工具包自包含/插件化/密钥标识/IDE 收口 |
| v1.2~v1.3 | 11-16 | 收尾阶段启动、遗留总账与分类计划落档、EDM v5/v6 主从 |
| v1.4~v1.10 | 11-20/21 | 三轮 CodeReview + 敲板裁决 + 菜单规整三轮 + 应用管理架构 D53 定稿（D52 被 D55 推翻：developerMode 保留） |
| v1.11~v1.12 | 11-22 | P0~P9 整改全量落地（38 commits）+ 应用管理 UI 四项调整，466 测试全绿 |
| v1.13~v1.14 | 11-22 | 第三轮全仓审查 40 条复核 + 无异议项三次修复落地 |
| **v2.0** | **11-23** | **组织结构优化**：P0 硬编码/phantom 依赖修复、P1 store.ts 收敛与 shared 拆包、P2 main 域归拢、P3 命名规范回写、文档清理（删 21 个历史/过程文档，决策固化为 §四看板） |
| **v2.1** | **11-24** | **EDM 旧资产迁移全量落地**：批次 0~7（CSS 四入口单链路、公共样式分层、双品牌 default 资产与标准模板、母版 22 模式族、邮件兼容整改），台账 #187，554 tests 全绿 |

## 六、ADR 记录格式（按主题）

> **编号规则（M2，2026-11-16）**：新决策编号一律顺延当前最大号；被推翻的决策编号不回收（保历史可追溯），引用旧编号的历史记录不改写，需加「已推翻」标注指向新结论。

```
# ADR-0001 <主题标题>
- 状态：已定 / 已废弃
- 日期：YYYY-MM-DD（北京时间）
- 关联需求：需求 N / D 编号
- 决策 / 备选方案 / 理由 / 代价 / 影响范围
```

## 七、实现顺序（D26，覆盖原编号顺序）

| 位次 | 阶段 | 内容 | 状态 |
|---|---|---|---|
| 1 | M0 | 骨架、latest + lockfile、北京时间、提交钩子、分层检查、CI | ✅ 已推送 |
| 2 | M1 | 应用壳 + 四层 UI + 三态换肤 + 3 个工具注册 + **electron-vite 热更新** + electron-builder 接入 + 图标 | **骨架已落，待装依赖验证** |
| 3 | M2 | 发布与更新（按 juice-email-cli、无签名）、changelog、首次安装指引 | **已落**：release.yml + 指引 + autoUpdater IPC；待 tag 实测 |
| 4 | M3 | 公共底座（ui-kit / repository / backup） | **已落**：repository（NeDB + 配置 + 产物路径 + ulid，22 测试）、backup（zip + manifest checksum + AES-GCM 密钥迁移，9 测试）、ui-kit（ToolPageLayout / EmptyState / ConfirmDialog / TimeText / useSelection） |
| 5 | **M7** | `llm-gateway` + `model-console` + OS 能力（仅依赖 M1） | **已落**：gateway（fetch/SSE，3 测试）、model-console 页、os/llm/secrets IPC（safeStorage） |
| 6 | **M6** | **Badge Studio（最急）**：外部 HTML 上传 + 四种数据源 + badge + snapdom 海报 | **已落**：URL 归一/数据源/badge 注入 16 测试、主进程 badge IPC、上传+粘贴+最近使用、批量补属性、覆盖式海报产物 |
| 7 | M4 | EDM Studio · 品牌树、模板片段版本、三阶段产物 | **已落**：品牌管理页（D29）、模板/片段版本（不可变 D8、黑白名单 D14）、nunjucks+juice+minify 三阶段（4 测试） |
| 8 | M5 | EDM Studio · 邮件列表、批量、导出、局域网分享 | **已落**：邮件 CRUD+生成+复制代码、覆盖式产物、局域网分享（token+TTL） |

## 八、复用监督清单（需求 15）

| 工具 | 状态 | 复用到的 packages | 新增公共组件 | 是否出现重复实现 |
|---|---|---|---|---|
| `edm-studio` | 已落 | shared / repository / ui-kit / llm-gateway（经宿主能力） | `tool.manifest.json`、`src/main/index.ts` 默认注册入口 | 无 |
| `badge-studio` | 已落 + 图片识别 | shared / repository / ui-kit + 宿主 `chat` / safeStorage | `core/vision.ts` | 无：云端视觉模型走 `parseVisionResult()`（本机 OCR 已移除） |
| `model-console` | 已落 → P4-8 起并入应用本体（模型管理模块，模块 id `model-manager`） | shared / repository / ui-kit / llm-gateway | `tool.manifest.json`（随三工具退役） | 无 |

> 判定：同一逻辑出现 ≥2 处即必须提取；`check-boundaries.mjs` + ESLint `no-restricted-imports` 卡住 `tools/*` 之间直接 import。

## 九、2026-11-13 进度快照（与本文件 §七里程碑衔接）

| 批次 | 提交 | 状态 |
|---|---|---|
| 应用级 Provider 共享 + 默认播种 + IDE 无关类型 | `4eed54c` | ✅ 已推送 |
| 侧栏就地平滑展开 + 弹框统一 + 401 回退 | `df3ef2e` | ✅ 已推送 |
| #8 契约定稿（trust.ts / ToolPackageContract / 门禁） | `1faf90b` | ✅ 已推送 |
| Badge Provider 复用 + 可编辑表格 + OCR 配置化 | `109d9b4` | ✅ 已推送 |
| arm64 恢复 + TOOL_ID 收敛 + vue-tsc + release.mjs + #35 阶段一 | `540726d`…本次 | ✅ 见台账 §十二 |
| #39 release 流程 | `scripts/release.mjs` | ✅ 已落，待首次真实发布演练 |
| #35 阶段二（utilityProcess / 安装入口 / 验签） | — | ⏳ 排期 |

门禁：`pnpm verify` = 13 项检查 + typecheck(.ts/.vue) + lint + build + 单测全绿。**测试数量随迭代增长，历史快照 98→132→217→224 tests 均为过往值，当前数以最近 `pnpm verify` 输出为准（勿在文档手写固定数字）。**
