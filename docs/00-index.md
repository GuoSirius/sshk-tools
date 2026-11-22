# 文档索引与决策看板

- 状态：**M0~M7 + P0~P8 CodeReview 整改批次全部落地（应用管理架构 D53：三基础模块并入应用、纯工具仅 edm/badge/template；PaddleOCR 已移除）；当前进入「验证收尾阶段」（P9：全量回归/销账，云链路实测与 .sshktool 演练待用户输入）——重点转向细节验证与健壮性，不再追新功能。测试数量随迭代增长（历史快照见下方变更记录，当前数以最近 `pnpm verify` 输出为准）。全量遗留项见 `02-architecture/遗留事项与收尾总账.md`，历史优化候选见 `99-archive/2026-11-16-优化建议与开发计划（已被plans接管）.md`（已被 `plans/` 分类计划接管）。**
- 版本：v1.12
- 最后更新：2026-11-22（北京时间；**P0~P9 整改批次全部执行完毕（台账 #156）：判据唯一化/错误契约/正确性/建库/main 拆分/应用管理架构 D53 落地/包内聚/纯工具收尾/PaddleOCR 移除/文档治理；P9-1 云链路实测与 P9-2 .sshktool 演练待真实账号/样例包**）
- 仓库根：`D:/workspace/code/sshk-tools`
- 远程：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
- 唯一入口：本文件。任何沟通文档都要在这里登记；找不到就说明还没归档。
- **时间规范：全文一律北京时间，不使用 UTC**（T10）。

---

## 一、文档清单

| 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|
| **★★ 规范与铁律总纲（新设备首读）** | `00-CONVENTIONS.md` | **权威汇总 · 唯一入口** | 目录/设计/文件/命名/使用/契约规范 + 全部铁律的统一汇总；AGENTS.md 是其摘要。新会话/新设备先读本文件再读 00-index |
| **★★ CodeReview 敲板裁决与重构实施总计划（决策入口）** | `06-codereview/2026-11-21-CodeReview敲板裁决与重构实施总计划.md` | **P0~P8 执行完毕（2026-11-22 · 台账 #156）；P9-1/P9-2 待用户输入** | 报告A 18 项 + 报告B 40 项 + 台账 C1/C4/Q-01~23 + **重构新想法 1~8** 全量裁决落点（§二三张总表）；冲突点 CF-1~6 + 待确认 C-1~11 **已全部终审**（§十三：CF-1 改判 developerMode 保留→D52 推翻立 D55 / preview 归 dev / 保持归档 / C-6 菜单结构原样下移 / C-8 不保留入口 / C-9 烤入只修 bug / C-11 model-manager / 顶栏方案一）；新架构 D53 定稿（应用管理 = 应用设置 + 文件/模型/分享三模块并入，纯工具仅 edm/badge/template）+ 顶栏/应用管理 UI 示意 + 配置提取清单 + useSelection 跨页多选答复 + F2 核查（主体已完成）+ **P0~P9 分批实施计划** |
| **★★ CodeReview 二次复核与处置台账** | `06-codereview/2026-11-20-CodeReview二次复核与处置台账.md` | **复核完成（v1.1 三次核对） · Q-01~21 已于 2026-11-21 敲板（见总计划）** | 两份 CodeReview 报告逐项回源码二次复核 + 对台账本身的三次核对（勘误 §八 Z1~Z7）：误报/属实/漏报判定 + 两报告冲突清单 + 工具⇄应用升降级专项 + 待决策 Q-01~Q-21 + 直接改批次（`4e879fb`/`3a0acf5`/`f830be6`+docs）|
| **★★ CodeReview 交叉合并与处置总计划** | `06-codereview/2026-11-21-CodeReview交叉合并与处置总计划.md` | **交叉比对完成 · Q-22/Q-23 已敲板（见总计划）** | 两报告 9 域去重合并总表（81 项）+ 报告B独有条目逐条回源码补验（R2/O5/X4/T6/O8 全属实）+ 元缺陷证实（A 编号空洞/B L 系空洞/台账漏收 P4、P10）+ 撤销清单 + 统一处置计划（无争议 N1~N5 待令执行 / 拍板 D1~D5）+ **新增决策 Q-22**（share-hub 生命周期）/**Q-23**（shared 拆包）|
| **需求沟通记录（多轮合并归档）** | `01-requirements/需求沟通记录.md` | 已合并归档（原 4 份逐轮文档已删） | 需求 0~7 + 术语表 + D10 输入组合 + 逐轮决策浓缩 + 图证登记 + 开放问题；按状态分组 |
| **技术选型与任务拆分 v0.4** | `02-architecture/2026-11-12-技术选型与任务拆分.md` | 历史设计稿（**门禁强依赖，勿删**） | 选型对比、四层 UI、导入导出、目录迁移、T1~T10、M0~M7、决策清单、风险；决策以 §四看板为准，实现以代码为准 |
| **工具插件化与需求台账（长期维护）** | `02-architecture/工具插件化需求台账.md` | **持续演进（D37~D50 + 51.x / 52.x / 53~56 批次）** | 穿插需求台账、工具包契约、宿主能力、Badge 图片识别 / PaddleOCR、IDE 红波浪线、运行时插件路线图、依赖选型反转与 UI 视觉铁律、N14~N18 设置/工具开发体验 |
| **★ 遗留事项与收尾总账** | `02-architecture/遗留事项与收尾总账.md` | **收尾阶段唯一入口（v1.1：77 条反馈已逐条回写）** | 按用户 6 方向归集全部未完成/待验证/待确认项，逐条标状态+来源；收尾推进以本账为准 |
| **★ 开发计划总览** | `plans/00-规划总览.md` | **规划待用户确认** | 收尾轮 77 条反馈的规划索引：疑问解答速查、7 份分类计划、B1-B5 批次排期建议 |
| **★ 全仓 Code Review 与重构建议（2026-11-20）** | `06-codereview/2026-11-20-全仓CodeReview与重构建议.md` | **已敲板（2026-11-21，总计划 §2.1）** | 19 项指令全面审查：8H/16M/12L + dev 判据双源 / FsRuntime 越界 / 三能力配置入口 / 时间与类型真相源等核心发现；TOP 必修 H1~H8 + 批次排期 + 待拍板 P1~P10 |
| **★ 独立全仓深度 Code Review 报告（2026-11-20·二轮）** | `06-codereview/2026-11-20-独立全仓深度CodeReview报告.md` | **已敲板（2026-11-21，总计划 §2.2）** | **独立审查（未参照 #147）**：19 维度覆盖矩阵 + TOP 必修 CR-01~08（传输冲突失效 / 密钥竞态 / dev 判据双源 / fs.ts 越界 / AppError 铁律 / 三处文档口径相反）+ 三能力分层专题 + 三态矩阵 + 大文件 Top15 + 6 工具组织对比 + 文档规整 + 待拍板 P1~P10 + 6 批次重构建议；全部 🔴 结论已回源码验证 |
| **UI 与页面规范（唯一清单）** | `plans/01-UI与页面规范.md` | 已定稿（2026-11-21 P8-1 三合一） | 表单/列表页/留白间距/弹框分轨/按钮语义图标/公共组件接线（useTablePage 等）/三类空态 + 逐页验收清单；原 `plans/01-界面与表单规范.md` 已并入归档，两份 architecture 规范改薄壳重定向 |
| 工具创建与配置统一 | `plans/02-工具创建与配置统一.md` | 规划待确认 | 向导/清单编辑器共用一套 Section 表单组件；「配置 vs 编辑」源/覆盖两层治理 |
| 健壮性加固 | `plans/03-健壮性加固.md` | 规划待确认 | H1 IPC 失败契约 / H2 零裸调 / H4 computed / H5 备份冒烟 / H6 compact / audit 六步法 |
| 诊断与可观测 | `plans/04-诊断与可观测.md` | 规划待确认 | 日志落盘（地基）/ 一键诊断报告 / 工具健康面板 / 验证引导页 / 流式核查 |
| 扩展能力 | `plans/05-扩展能力.md` | 规划待确认 | 云 Provider 补齐 / 共享能力注册表 / 用量日志 / AI 文案助手 / 快照 / share 重构 / X5 构建裁剪候选 |
| 开发体验与工作流 | `plans/06-开发体验与工作流.md` | 规划待确认 | dev 新工具自动感知 / 全链路演练收敛 / 指南对齐 / OCR 抹除 / 分享验证 |
| 文档治理与安全 | `plans/07-文档治理与安全.md` | 规划待确认 | M2-M5 / 删历史钩子写法 / 安全与密钥体系 / 升级 SOP / 文档归类规则 |
| 工具开发指南 | `02-architecture/工具开发指南.md` | 已落（N16） | 从零建工具：目录结构、manifest 字段、入口契约、门禁、常见报错 |
| 上传能力规划（R26） | `02-architecture/上传能力规划.md` | 已落地（T1–T8 + 复核 12 项 + N1–N13） | 应用级共享上传：多 profile、Provider 架构、upload-config 工具、真实链路待验（V7 等） |
| 代码编辑与富文本共享能力规划（R27） | `02-architecture/代码编辑与富文本共享能力规划.md` | 已落地（E-T1–E-T5） | packages/code-editor + rich-text、语言注册、Monaco/wangEditor 坑清单、全屏二次根治 §七、图片库迁出 §八 |
| **文件选择弹框通用化与图片库迁移（file-picker）** | `02-architecture/文件选择弹框通用化与图片库迁移.md` | 已落地（`f015755`，2026-11-17） | @sshk/file-picker 全参数化弹框、参数契约与 kind 线程、旧图片库迁移映射、EP cascader 两个坑（leaf 钉死/挂载竞态）、FormGrid combo 修复 |
| R26-R27 协同开工方案 | `02-architecture/R26-R27协同开工方案.md` | 已完成（B0–B8 全落地） | 协同契约、依赖清单、批次顺序、实测坑（cpu-features shim 等） |
| CSS 引用与共享样式规划（R28） | `02-architecture/CSS引用与共享样式规划.md` | 已落地（`561dab8`） | §一–§四 初稿已被否定保留作历史；§五 最终方案=显式 link + 逻辑 URI |
| **EDM 目录结构与模板片段维护规划** | `02-architecture/EDM目录结构与模板片段维护规划.md` | R1–R11 已落地 | EDM 系统/自定义双轨目录、`css` 就近规则、元数据与黑白名单、Monaco 编辑器选型 |
| **EDM 内容管理统一规划 v6（权威）** | `02-architecture/EDM系统内容页改造与内容管理统一规划_v6.md` | R12–R24 已落地 | 统一组合引擎、邮件管理、双顶层内容管理；**EDM 唯一权威**，v5 仅作字段级规格历史基线 |
| EDM 规划 v5（历史基线） | `99-archive/EDM系统内容页改造与内容管理统一规划.md` | 已归档（非权威） | 保留 R12–R18 字段级规格追溯；状态以 v6 + 总账为准 |
| EDM 待收尾与验证清单 | `02-architecture/EDM待收尾与验证清单.md` | 验证执行清单 | V1–V13 + A–E 逐条验证动作；汇总入口见遗留总账 |
| **安全与密钥体系** | `02-architecture/安全与密钥体系.md` | 已落（A-T2 单一权威） | 五套口令/密钥对照表、进程边界红线、密钥流转、env 清单、外部包信任链、日志脱敏红线；各处安全说明改为引用本文 |
| **数据契约 v0.2** | `04-api/2026-11-12-数据契约.md` | 历史基线（**门禁强依赖，勿删**） | 品牌树、黑白名单、北京时间、配置、zip + 加密密钥、IPC、组件、目录迁移；实际以代码为准 |
| **发布流程与本机提交钩子** | `05-release/2026-11-12-发布流程与本机提交钩子.md` | 已落（§二 husky 结论已更新） | 按 juice-email-cli 发布流、Git 铁律、lockfile、无签名发布、Electron 配置与缺失项清单；`.git/cph` 为历史方案已废弃 |
| **首次安装指引** | `05-release/2026-11-12-首次安装指引.md` | 已落 | Windows SmartScreen / macOS Gatekeeper / deb·rpm·AppImage 无签名安装说明 |
| **依赖升级 SOP** | `05-release/依赖升级SOP.md` | 已落（A-T4） | 触发条件/升级步骤/verify+audit 必跑/breaking 处理/lockfile 单独提交/台账登记 |
| **发布工作流** | `.github/workflows/release.yml` | 已落 | tag 触发三平台矩阵（win-x64 / mac-universal / linux-x64），`--publish never` + GH Release notes |
| **打包配置** | `apps/desktop/electron-builder.config.cjs` | 已接入 | NSIS 允许选择安装目录；图标已配置；签名位留注释 |
| **图标资源** | `apps/desktop/build/` | 已生成并**已提交** | icon.png/.ico/.svg、tray、logo.svg、logo-mark.png 全部统一在该目录（即 electron-builder 的 `buildResources`）；生成脚本 `scripts/generate-icons.py`。`docs/assets/` 已废弃删除 |
| 原始需求快照 | `../requirement.txt` | 只读 | 用户原始输入，不修改；冲突时以此为准 |
| UI / 交互稿 | `03-design/` | 待建 | M1 产出 |
| ADR 决策记录 | 本文件 §四 + `02-architecture/工具插件化需求台账.md` | 已收口 | 早期预留的空目录 `01-requirements/decisions/` 从未落地任何 ADR（Git 也不跟踪空目录），已删除；D1~D50 统一记在本看板，插件化相关细节记在架构文档。后续确需按主题单开 ADR 时再建目录，格式见 §六 |
| 归档 | `99-archive/` | **已启用（2026-11-16）** | 只移不删。已归档：实现顺序与 M6 先行方案（D26）、开发环境与热更新（D27）、模块规范 ESM/CJS（D23）、优化建议与开发计划（2026-11-16，已被 `plans/` 七份分类计划接管） |

> 归档说明：D23 / D26 / D27 三份决策文档的结论已全部固化到 §四看板 + 台账，原件移入 `99-archive/` 保留可追溯；
> `技术选型与任务拆分` / `数据契约` 因被 `scripts/verify-structure.mjs` 门禁强依赖（路径硬编码），**保留原位勿删**。

## 二、目录规范（需求 0）

```
docs/
├── 00-index.md          ← 本文件，唯一入口
├── 01-requirements/     ← 四轮需求、快照、图片证据（decisions/ 空占位已移除，ADR 统一记 00-index §四）
├── 02-architecture/     ← 架构、选型、任务拆分、各专项规划（R 系列与 EDM）
├── 03-design/           ← UI 稿、交互说明、公共组件说明
├── 04-api/              ← 数据契约（品牌树/配置/zip/IPC/组件/目录迁移）
├── 05-release/          ← 发布流程、签名开关、changelog、首次安装指引、缺失项
├── 06-codereview/       ← CodeReview 报告/复核台账/交叉合并/敲板处置计划（2026-11-21 起，唯一存放地）
├── plans/               ← 开发计划（2026-11-16 起，按功能分类：00 总览 + 01~07 专项）
└── 99-archive/          ← 归档（只移不删；已含 D23/D26/D27 决策原件与被 plans/ 接管的建议池）
```

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
| **D37** | **依赖方向反转** | **应用不强依赖工具，工具可强依赖应用**：宿主只认 `tool.manifest.json` 契约；宿主能力经 `ToolHostCapabilities` 注入插件（config / repository / IPC / LLM / safeStorage / 本机 OCR） |
| **D38** | **工具零依赖与禁用隔离** | 清单默认 `dependsOn: []`；单个插件加载失败 / 禁用只影响自己，guarded IPC 每次调用实时裁决；硬依赖链可配置传播，软 `configDeps` 只预警 |
| **D39** | **工具包自包含（推翻 D35 的宿主图标）** | 名称 / 描述 / 多分类 / 图标 / 菜单 / 配置项 / 默认配置 / 依赖 / 权限 / 插件入口**全部归工具包自己的 `tool.manifest.json` 与 `assets/icon.svg`**；宿主 `apps/desktop/src/renderer/assets/tools/` 已删除 |
| **D40** | **构建期自动发现，零改动接入** | `import.meta.glob` 扫 `tools/*` 的清单 / 图标 / main / renderer；`electron.vite.config.ts` 与 `vitest.config.ts` 动态扫包生成 alias；新工具包放进 `tools/` 即构建可用 |
| **D41** | **插件入口强契约** | `src/main/index.ts` 必须 `export default` 注册函数（或具名 `register`）；禁止「随便挑一个函数」，避免误挑 `parseDatasource` 导致 IPC 静默未注册 |
| **D42** | **配置形态两选一 + 浏览器式刷新** | `configLayout: single / menu`：形态 1 `single` = 单个「工具配置」菜单进去左右布局（现有工具全用此形态）；形态 2 `menu` = 「工具配置」展开二级菜单，每个二级菜单一个真实页面、页内复用左右布局，`configPages` 声明每页含多个分组（template-tool 为示例）。历史值 `tabs` 归一为 `single`。F5 / Ctrl(Cmd)+R 刷新，Ctrl+F5 / Ctrl(Cmd)+Shift+R 忽略缓存，「更多」下拉提供入口 |
| **D43** | **多分类 / 标签** | `category: string \| string[]` + `tags[]` → 裁决层 `categories[]`；卡片 / 侧栏 / 搜索 / 设置覆盖全链路支持多个分类 |
| **D44** | **Badge 图片数据源** | 图片 → 云端视觉模型或本机 OCR → `parseVisionResult()` → 标准 `StatRow[]` → 回填可校对 CSV；`llm-gateway` 支持 `image_url` 多模态；**视觉模型 API Key 只进 safeStorage，绝不写仓库** |
| **D45** | **PaddleOCR 作为可插拔识别源** | 与云端模型共用「图片识别 provider → 标准结构」抽象；宿主 `runLocalOcr`（无 shell、超时、输出上限）+ 工具包 `scripts/paddleocr_adapter.py` 参考适配器；实际绑定待用户确认本机命令与截图版式 |
| **D46** | **密钥标识校验纯函数化** | `app:tool:<id>:<name>` 标识抽出 `secret-ids.ts` 并放宽为大小写/下划线/连字符；修掉驼峰 `visionApiKey` 被判非法导致 Badge 加载即报错，补 3 个回归单测 |
| **D47** | **模型预设与真实模型列表下拉** | 常用 OpenAI 兼容端点（含 Agnes AI `/v1`）由 `model-console` manifest 自带，用户只填 Key；模型名 `el-select allow-create` + 「拉取模型列表」真实请求 `/models`；保存前可用临时 key 探测且不落盘；预设不含任何密钥 |
| **D48** | **IDE 项目归属收口** | 三套 tsconfig 全 0 错误即证明代码无误；根 `tsconfig.json` 刻意排除 apps，让 `apps/desktop/tsconfig.json` 独占 `.vue`；显式 `types: ["node","vite/client"]`；新增 `electron` paths；去掉反向作用的 Volar takeover 设置；`cspell.json` 消除拼写波浪线；换电脑后须按架构文档 §7.3 重载窗口 / 切工作区 TS 版本 / 重启 TS Server |
| **D49** | **创建工具向导 + 开发指南 + 清单表单化** | 骨架生成单一事实源 @sshk/shared/tool-skeleton（预览=落盘）；dev:toolCreate 主进程落盘（目录冲突拒绝）；双入口仅 dev 可见（更多下拉 + 设置抽屉）；清单编辑器 configGroups/configDeps/defaults/channels/dependsOn 全表单化 + JSON 预览 tab；指南 docs/02-architecture/工具开发指南.md |
| **D51** | **依赖选型反转（强化）** | **推翻旧「优先不新增依赖」倾向**：设计方案时**优先使用成熟第三方 / npm 包，不造轮子**；图标、字体、日期、工具库等常见需求先查成熟包。`@element-plus/icons-vue` 与 **Font Awesome**（`@fortawesome/fontawesome-free`）已批准直接用；仅零依赖校验脚本 / icon 生成脚本等无合适包时自研（与 D30 同源，措辞强化） |
| **D50** | **UI 视觉铁律** | **后续所有界面开发，能用图标处尽量用图标**（按钮 / 状态 / 操作列等）；界面须**美观大方、吸引用户、增强视觉体验**，不将就纯文字或裸箭头（`↓`/`▾` 等一律换图标库）。触发：自动更新按钮曾用 Unicode `↓` 被纠正 |
| **D52** | **dev/build 二态（删除 developerMode 开关）** | 敲板 2026-11-21：删除 `app.developerMode` 配置与全部用户可配置功能开关，门控唯一判据 `__SSHK_DEV__`（构建期 define 注入 main/preload/renderer 三端）；「dev 恒全量展示」铁律本体保留；安装版无开发者入口（DevTools 口令通道保留）。**推翻 2026-11-14「开发模式铁律」中的 developerMode 机制部分**（AGENTS/总纲随总计划 P0-2 批次修订）；B25/D-3、D-2、Q-12、CR-46 随之作废。后果清单与终审项见总计划 CF-1 **【⛔ 已推翻 2026-11-21 终审 → D55：developerMode 保留不删】** |
| **D53** | **应用/工具边界重划 + 应用管理架构** | 敲板 2026-11-21（重构新想法 1~8）：file-manager / model-console / share-manager 三个基础能力工具并入「应用管理」页面（左侧可折叠菜单 + 右侧内容；一级 = 应用设置 / 文件管理 / 模型管理 / 分享管理），成为应用本体；纯工具仅 edm-studio / badge-studio / template-tool；**工具 → 应用单向依赖，应用本体绝不依赖工具**。吸收 Q-03（FsRuntime 改判应用内 `main/modules/file/`）/Q-04/Q-22/S1/S2；**推翻 D36 设置抽屉形态**（应用设置变页面）；D39 自包含收窄为纯工具；菜单表/目录树/配置提取清单/useTablePage+跨页多选方案/P0~P9 批次见总计划 §五~§九 |
| **D54** | **CodeReview 文档独立目录** | `docs/06-codereview/` 为全部 CodeReview 报告/台账/处置计划唯一存放地（2026-11-21 起，AGENTS/总纲已立规）；四份既有文档已 git mv 迁入；后续每轮 review 在此新建 `YYYY-MM-DD-主题.md` |
| **D55** | **developerMode 保留 + dev 判据唯一化 + preview 归 dev（终审改判，推翻 D52）** | 用户 2026-11-21 终审：**保留** `app.developerMode` 与 `devFeatures = isDev \|\| cfg.developerMode` 机制（2026-11-14 铁律原文不变）；dev 判据唯一化照旧执行（`__SSHK_DEV__` define 注入三端 + `isSourceRepo` 分离），定值 `mode==='dev' \|\| mode==='preview'`（preview 归 dev）；恢复执行 D-2 写法收敛（shared 纯函数 + 统一下发）/ D-3 注释分节 / Q-12 图标字段 devFeatures 可改 / CR-46 订阅修复；env 烤入机制保持只修 bug（C-9）；应用管理菜单结构原样下移一级（C-6）、模块 id `model-manager`（C-11）、顶栏方案一（C-7）。详见总计划 §十三 |

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
| **用户确认（PaddleOCR）** | 本机 Python 解释器绝对路径、PaddleOCR 版本 / 调用方式、点击统计截图版式（链接与数字是否同行、有无千分位 / 合计列），用于校准 `rows_from_lines()` |
| **用户填写（视觉模型）** | Badge Studio「图片识别」面板填入 API Key（只落本机 safeStorage，不进仓库）→ 上传截图实测 |
| **用户执行（安装包）** | 本轮大量改动后重新 `pnpm dist` 生成 Windows 安装包做安装测试 |
| **后期排期（#8）** | 已发布应用中导入 / 安装 / 卸载外部工具包：需先定插件包格式、签名校验、版本兼容、运行时沙箱边界 |

## 五、变更记录

| 版本 | 日期（北京时间） | 变化 | 冲突处理 |
|---|---|---|---|
| v0.1 | 16:40 | 首轮方案：选型对比、M0~M6、D1~D12 | — |
| v0.2 | 20:40 | 拍板 D1~D12；四层 UI、双层配置、zip、品牌树、拆两工具、覆盖式产物、跨页选择、复用规范 | 推翻 v0.1 三处 |
| v0.3 | 21:08 | D10 重定义；D4 收口；D13~D18/D20；T10 时间规范、目录迁移、ID 可见性、加密密钥 | 推翻 v0.2 四处 |
| v0.4 | 21:26 | D19/D21 定稿、仓库确定、**M0 开工**；`ab4a739` | D19 选 A |
| v0.5 | 21:52 | **D23 ESM 优先兼容 CJS**、**D24 TypeScript 6.x** | 降 TS 大版本 |
| v0.6 | 22:02 | **D25 Electron 打包 + 允许选安装目录**、**D26 顺序改为 M0→1→2→3→7→6→4→5**；`b40186a` | 覆盖原里程碑顺序 |
| **v0.7** | 22:19 | **D27 electron-vite 三端热更新**、**M7 依赖修正为仅 M1**、**图标资源生成并接入**、M1 应用壳骨架落地 | 修正 M7 依赖笔误 |
| **v0.8** | 15:12 | **D28 不设根 public/**；修复 `.gitignore` 误屏蔽 `apps/desktop/build/`；M2 落地（release.yml、首次安装指引、electron-updater IPC + 检查更新按钮）；pnpm 构建脚本白名单收敛为 `allowBuilds` | 删除 docs/assets |
| **v0.9** | 11-13 00:12 | D29~D36：品牌管理、配置分层、目录裁决、访问密钥、图标覆盖、设置中心、侧栏 hover 浮层与递归菜单 | 配置真相源上移（后被 v1.0 推翻） |
| **v1.0** | 11-13 09:45 | **D37~D45**：工具包自包含 + 构建期自动发现、插件化零依赖隔离、插件入口强契约、配置布局三选一、F5 刷新、多分类标签、Badge 图片识别 / PaddleOCR、IDE 红波浪线修复；76 测试全绿、三端构建通过 | **推翻 D33/D35**：真相源下沉工具包 manifest、宿主内置图标删除、`DEFAULT_SETTINGS.tools` 清空；删除空 ADR 占位目录；`.vscode/` 纳入提交 |
| **v1.1** | 11-13 10:10 | **D46~D48**：密钥标识 bug 修复 + 回归单测、Model Console 常用模型预设 + 真实 `/models` 下拉、IDE 三套 tsconfig 收口与操作步骤；80 测试全绿 | 去掉 `vue.server.hybridMode: false`（反向作用）；根 tsconfig 排除 apps，避免 Volar 选错项目 |
| **v1.3** | 11-16 | **进入收尾打磨阶段**：全量梳理 docs 并落档「遗留事项与收尾总账」「优化建议与开发计划」；3 份决策已固化文档移入 99-archive；EDM v5/v6 明确主从（v6 权威）；修订发布流程 husky 过时结论与多处测试数字失真 | 文档治理，零代码改动；技术选型/数据契约/00-index 是门禁强依赖，未动路径 |
| **v1.4** | 11-20 | 二轮**独立全仓深度 Code Review** 落档（台账 #148，明确未参照 #147）：19 维度覆盖 + CR-01~60 分级问题 + 6 专题（三能力分层/三态/大文件/文档/页面规范/组织命名）+ 待拍板 P1~P10 + 6 批次重构建议；00-index 同步修断链、去写死测试数字、版本日期 | 只读审查 + 文档落档，零源码改动 |
| **v1.5** | 11-20 | 两份 CodeReview 报告**逐项二次复核**：回源码核验全部条目，判定误报（CR-21/51/53/54、E1、R5/R6、CR-04/40/60 夸大）+ 漏报（危险操作 8 处缺禁遮罩、tools main 66 处裸 throw、check-dialogs 门禁盲区）+ 两报告冲突清单 + 工具⇄应用升降级专项；直接改 2 批（`4e879fb`/`3a0acf5`）；新增 `00-CONVENTIONS.md` 规范总纲 + 二次复核台账；两份审查文档同步复核结果 | /bug 修复 + 规范落档；待决策 Q-01~Q-21 集中台账 §六 |
| **v1.6** | 11-21 | **CodeReview 全量敲板落档**：新增《敲板裁决与重构实施总计划》（`06-codereview/`，决策入口）；报告A 18 项 + 报告B 40 项 + 台账 C1/C4/Q-01~21 + 重构新想法 1~8 逐项裁决（总计划 §二）；冲突点 CF-1~6 + 待确认 C-1~11 待终审；新架构定稿 **D52/D53/D54**；四份 CodeReview 文档 git mv 迁 `docs/06-codereview/`；AGENTS/CONVENTIONS 同步决策入口与目录规范；台账 #151 | Q-19 useSelection 删除→推广落地；Q-03 FsRuntime 下沉→应用内 modules/file；D-2/D-3/Q-12 作废；交叉合并 N1~N5 无争议清单并入总计划批次 |
| **v1.7** | 11-21 | **CodeReview 敲板终审落定**（台账 #152，总计划 v1.1 §十三）：CF-1 改判 developerMode **保留**（**D52 已推翻 → D55**；D-2/D-3/Q-12/CR-46 恢复执行，2026-11-14 铁律原文不变）；preview 归 dev（`__SSHK_DEV__` 含 preview）；99-archive 保持归档；**C-6 菜单定稿 = 应用设置 tab 与三工具菜单结构原样下移一级**（唯一新增页 = 应用设置>文件与传输；C-8 文件管理侧不保留入口）；C-9 env 烤入保持机制只修 bug；**C-11 模块 id model-console → model-manager**；顶栏方案一确认；具备开工条件待令执行 P0~P9 | P0-2 由「删除批」改「保留+收敛批」；P0-6 由「契约三案」改「完善批」；P4-3~6 菜单结构按 C-6；P4-5/P4-8 module id 更名 |
| **v1.8** | 11-21 | **菜单规整二轮**（台账 #153，总计划 v1.2 §十四/§5.5a）：①更名 常规→常规设置、模型 Provider→模型配置；②**传输/分片参数并入 文件管理>工具设置「传输与分片」**（用户授权，应用设置零新增页，「文件与传输」取消）；③**应用设置分享页整页并入 分享管理>工具设置>服务配置**（实测同键双入口重合：状态卡+基础设置 4 字段双渲染；可回退，「分享服务」改名随之取消）；④模型管理>工具配置 3 字段并入 模型配置页「网关偏好」（建议可回退）；⑤应用设置二级 6→4 页；合并/细拆规划表落 §5.5a | P4-3 改 4 页批；P4-4 工具设置双分组；P4-5 模型配置含网关偏好；P4-6 ServicePage 扩容收编 ShareTab；P4-7 零传输设置入口 |
| **v1.9** | 11-21 | **菜单规整三轮**（台账 #154，总计划 v1.3 §十四）：①关于 → **关于应用** 更名；②**模型管理>工具配置恢复独立页**（二轮曾建议并入模型配置页，经用户复核质疑后改判：与文件管理「通道配置（资产）↔ 工具设置（偏好）」跨模块分页模式一致，Provider 资产管理与网关偏好心智不同）；模型管理终版 = 模型配置/对话调试/用量统计/工具配置 4 页（下移+更名基线完全照搬）；分享页合并仍可回退 | P4-3 关于应用更名；P4-5 恢复工具配置页（模块描述+SettingsPage 引擎）；§5.5a 合并行改「独立（三轮改判）」 |
| **v1.10** | 11-21 | **全页面统一重构指令登记**（台账 #155，总计划 v1.4 §九 执行总原则）：趁此次重构，**所有页面（新建+存量）全部重构到位**——尽量提前（公共组件库 P2 最先建）、优先复用公共组件（useTablePage/ListPageShell/TableOpsColumn/EmptyState/FormHint/FormGrid/SecretField/useAction/弹框分轨/统一分页留白 token），禁止散写 .hint span/手写空态/手写分页 CSS；**P4 迁移即重构**（每迁一页直接落公共组件+规范清单重写，禁原样搬运）；P6 收窄为纯工具页收尾+大文件拆分；逐页验收清单=总纲 §2+列表页/留白规范 | P4-3~6 加迁即重构条款；P6-1/P6-2 改纯工具收尾口径 |
| **v1.11** | 11-22 | **P0~P9 整改批次全量执行落库**（台账 #156，38 commits）：P0 判据唯一化 __SSHK_DEV__/developerMode 收敛/时间统一/AppError 222 处/类型真相源/烤入完善/门禁三件套(knip 入 verify)/plain 收敛；P1 conflict 信号+状态机测试/SecretsStore/更新三闸/健壮性四项/分享硬鉴权/双轨清/死代码页删；P2 建库六件+样板页；P3 main 层拆分（index 1161→188、fs 2064→modules/file 六文件、ipc/ 十二域）；P4 应用管理架构 D53 落地（顶栏胶囊/AppAdminPage/设置四页页化/三模块迁即重构/ServicePage 扩容/传输面板全局化/三工具退役/model-manager 定稿/键迁移 app.modules.*）；P5 包内聚（tool-skeleton→scripts、verify-steps→apps shared、ShareDialog→share-core/ui、export-core 新包）；P6 纯工具收尾（六大文件拆解：FilePicker 1549→592/ContentManage 1486→360/badge state 1090→桶/edm ipc 778→入口/share-core 851→域模块/App.vue 431→237）；P7 PaddleOCR 全套删除（D45 推翻）；P8 文档治理（UI 规范三合一/指南新边界/旧称清理 34 处/verify-steps 常量化）。验证 465 tests 全绿；P9-1/P9-2 待真实账号/样例包 | 台账 #157~#160 相关决策随批内 commit 记录；README 同步 D53 架构 |
| **v1.12** | 11-22 | **应用管理 UI 四项调整 + dev 启动踩空修复**（台账 #157）：①传输面板按需显示（visible 默认隐藏+仅应用管理容器渲染+进入时有队列自动亮收起摘要条，✕ 后不被反复顶起）；②一级菜单序=文件/模型/分享/应用设置（沉底）+分组默认全折叠+激活页祖先链自动展开+落点规整（/app 裸路径或指定无效→首个有效菜单页，router.replace 规整 URL，指定有效原样直达）；③折叠钮移左菜单底部固定位（收起为窄轨仍可展开）；④删应用管理页头行块（返回桌面与顶栏「桌面」重复）；④b 菜单全量显式图标（复用改版前三工具 manifest 与旧设置抽屉图标、撞形处重设计，台账 #158）；④c 设置类表单统一两列（移除 5 个误标 full 的短控件，长控件独占整行规则不变，台账 #159）；④d 侧栏收起态窄轨显图标 + hover 就地展开（与工具侧栏共用 useSidebarNav 单一实现，台账 #160）；④e 分享服务端口治理（IPC 启停统一走宿主决策链回写 autoPort 根治端口 +1 漂移/内核 restart 显式端口优先/端口被占回落随机+告警不再启动失败/UI 如实显示 0=自动）+ 保存钮居右（台账 #161）；④f APP_MENUS 菜单 hidden 隐藏机制（子级全隐藏父级连带隐藏，默认落点跳过隐藏项取首个有效可见页，台账 #162）。另修 #156 批两处 dev 启动回归：useUpdateBanner 模块顶层单例 / fsHost 顶层直连句柄踩空 window.api → 惰性化 | IPC 通道与配置键零变化 |

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
| `badge-studio` | 已落 + 图片识别 | shared / repository / ui-kit + 宿主 `chat` / `runLocalOcr` / safeStorage | `core/vision.ts`、`scripts/paddleocr_adapter.py` | 无：云端与本机 OCR 共用 `parseVisionResult()` |
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
