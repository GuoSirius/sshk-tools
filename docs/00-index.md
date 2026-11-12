# 文档索引与决策看板

- 状态：**M0 已推送；M1 应用壳/热更新/图标资源已落，待用户装依赖验证**
- 版本：v0.7
- 最后更新：2026-11-12 22:19（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`
- 远程：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
- 唯一入口：本文件。任何沟通文档都要在这里登记；找不到就说明还没归档。
- **时间规范：全文一律北京时间，不使用 UTC**（T10）。

---

## 一、文档清单

| 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|
| 初始需求（结构化） | `01-requirements/2026-11-12-初始需求.md` | 已归档沟通 | 需求 0~7 + 三张图证据 + 术语表 |
| 第二轮需求补充与决策 | `01-requirements/2026-11-12-第二轮需求补充与决策.md` | 已归档沟通 | 第二轮 0~19 + 拍板 + D10 重述 |
| 第三轮需求补充与决策 | `01-requirements/2026-11-12-第三轮需求补充与决策.md` | 已归档沟通 | D10 重定义、D4 收口、D13~D20、时间规范、产物目录迁移 |
| 第四轮决策与开工 | `01-requirements/2026-11-12-第四轮决策与开工.md` | 已定稿 | 仓库地址、latest+lockfile、D19/D21 定稿、M0 交付范围 |
| **技术选型与任务拆分 v0.4** | `02-architecture/2026-11-12-技术选型与任务拆分.md` | 讨论中（决策全定） | 选型对比、四层 UI、导入导出、目录迁移、T1~T10、M0~M7、决策清单、风险 |
| **模块规范（ESM 优先 / 兼容 CJS）** | `02-architecture/2026-11-12-模块规范-ESM优先兼容CJS.md` | 已定（D23） | 分层格式、条件导出模板、preload 产物必须 CJS、常见坑 |
| **实现顺序与 M6 先行方案** | `02-architecture/2026-11-12-实现顺序与M6先行方案.md` | 已定（D26） | 新顺序、依赖校验、M6 补齐空白功能、juice-email-cli 衔接 |
| **开发环境与热更新** | `02-architecture/2026-11-12-开发环境与热更新.md` | 已定（D27） | 方案对比、三端行为对照、命令、M7 依赖修正说明 |
| **数据契约 v0.2** | `04-api/2026-11-12-数据契约.md` | 讨论中 | 品牌树、黑白名单、北京时间、配置、zip + 加密密钥、IPC、组件、目录迁移 |
| **发布流程与本机提交钩子** | `05-release/2026-11-12-发布流程与本机提交钩子.md` | 讨论中 | 按 juice-email-cli、`.git/cph` 钩子、Git 铁律、lockfile、无签名发布、**Electron 配置与缺失项清单** |
| **打包配置** | `apps/desktop/electron-builder.yml` | 已接入 | NSIS 允许选择安装目录；图标已配置；签名位留注释 |
| **图标资源** | `apps/desktop/build/` + `docs/assets/` | 已生成 | icon.png/.ico/.svg、tray、logo.svg、logo-mark.png；生成脚本 `scripts/generate-icons.py` |
| 原始需求快照 | `../requirement.txt` | 只读 | 用户原始输入，不修改；冲突时以此为准 |
| UI / 交互稿 | `03-design/` | 待建 | M1 产出 |
| ADR 决策记录 | `01-requirements/decisions/` | 待建 | 按主题一文件，明细记本文件看板 |
| 归档 | `99-archive/` | 待建 | 过期文档只移不删 |

## 二、目录规范（需求 0）

```
docs/
├── 00-index.md          ← 本文件，唯一入口
├── 01-requirements/     ← 四轮需求、快照、图片证据、decisions/(按主题 ADR)
├── 02-architecture/     ← 架构、选型、任务拆分、模块规范、实现顺序、热更新
├── 03-design/           ← UI 稿、交互说明、公共组件说明
├── 04-api/              ← 数据契约（品牌树/配置/zip/IPC/组件/目录迁移）
├── 05-release/          ← 发布流程、签名开关、changelog、首次安装指引、缺失项
├── assets/              ← Logo 等文档图片资源
└── 99-archive/          ← 归档（只移不删）
```

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
| 共享包 | ✅ `packages/shared`（北京时间 `time.ts` + 常量/类型/IPC 契约 + 6 个单测） |
| 校验脚本 | ✅ `check-latest` / `check-boundaries` / `verify-structure` / **generate-icons.py** |
| CI | ✅ `.github/workflows/ci.yml`（`--frozen-lockfile` + `pnpm verify`） |
| 本机钩子 | ✅ `.git/cph/{pre-commit,commit-msg}` 实跑通过 |
| **M1 应用壳** | ✅ `apps/desktop/`：main / preload / renderer、四层布局、三态换肤、3 个工具注册、UnoCSS、`electron.vite.config.ts`（三端热更新）、`electron-builder.yml` |
| **图标资源** | ✅ 已生成并接入打包配置（纯标准库脚本，零依赖） |
| TS 6 切换 | ✅ `typescript: "6"` → 6.0.3，lockfile 已同步 |
| **待验证** | ⏳ 前端/Electron 依赖尚未安装；`pnpm install` 后跑 `pnpm verify` 与 `pnpm --filter @sshk/desktop dev`（**由用户执行**） |
| 功能页 | ❌ 三个工具的具体功能页按 M7→M6→M4→M5 顺序落地 |

## 四、决策看板（**全部已定**）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 首页布局 | C 混合；左侧菜单可折叠展开 |
| D2 / D3 | 模板引擎 / UI 库 | Nunjucks / Vue 3 + Element Plus |
| D4 | 构建/更新/changelog | 方案 A；按 juice-email-cli 复用（含本机 `.git/cph` 钩子） |
| D5 / D6 | 国产 OS / 签名 | x64 + arm64 / 无证书不签名，留开关 |
| D7 / D8 / D9 | 绑定 / 版本 / 数值列 | 槽位声明式 / 不可变+两种复制 / `Clicks` |
| D10 | 输入组合 | 图片/excel/csv/json 四种上传 + 邮件 HTML「选择已生成 / 上传外部」→ 生成 |
| D11 / D12 | 长图 / 落盘 | `@zumer/snapdom` / `@seald-io/nedb` |
| D13 / D14 | 工具命名 / 名单粒度 | `edm-studio` + `badge-studio`；版本 ID 为主 + 族批量，ID 用户无感 |
| D15 / D16 | 分享 / 大模型 | 局域网只读 HTTP 预览；两层 gateway + `model-console` |
| D17 / D18 | 导入冲突 / 密钥跨机 | 整包覆盖；`SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1` 走口令加密 100% 还原 |
| **D19** | 覆盖产物后悔药 | **直接覆盖，不留 `.prev`、不留历史副本** |
| D20 | 依赖版本 | 外部包一律 `"latest"`；**lockfile 必须提交 + CI `--frozen-lockfile`** |
| **D21** | 产物目录与迁移范围 | 可改 `app.outputDir`；**只搬 `outputs/` + `assets/`** |
| D22 | 时间 | 一律北京时间，不用 UTC；`shared/time.ts` + dayjs |
| **D23** | **模块系统** | **ESM 优先、兼容 CJS**；preload **产物**必须 `.cjs`（sandbox） |
| **D24** | **TypeScript 版本例外** | **6.x 最新版 `"6"`（6.0.3）**，其余包仍 `latest` |
| **D25** | **Electron 打包** | 允许选择安装目录（NSIS）；缺失项及时上报；**图标已补齐** |
| **D26** | **实现顺序 / M6 先行** | **M0→1→2→3→7→6→4→5** |
| **D27** | **开发热更新** | **electron-vite**：主进程改即重启、preload 改即重载、渲染 HMR；ESM main + CJS preload |

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

## 六、ADR 记录格式（按主题）

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
| 3 | M2 | 发布与更新（按 juice-email-cli、无签名）、changelog、首次安装指引 | 待开始 |
| 4 | M3 | 公共底座（ui-kit / repository / backup） | 待开始 |
| 5 | **M7** | `llm-gateway` + `model-console` + OS 能力（仅依赖 M1） | 待开始 |
| 6 | **M6** | **Badge Studio（最急）**：外部 HTML 上传 + 四种数据源 + badge + snapdom 海报 | 待开始 |
| 7 | M4 | EDM Studio · 品牌树、模板片段版本、三阶段产物 | 待开始 |
| 8 | M5 | EDM Studio · 邮件列表、批量、导出、局域网分享 | 待开始 |

## 八、复用监督清单（需求 15）

| 工具 | 状态 | 复用到的 packages | 新增公共组件 | 是否出现重复实现 |
|---|---|---|---|---|
| `edm-studio` | 未开始 | — | — | — |
| `badge-studio` | 未开始 | — | — | — |
| `model-console` | 未开始 | — | — | — |

> 判定：同一逻辑出现 ≥2 处即必须提取；`check-boundaries.mjs` + ESLint `no-restricted-imports` 卡住 `tools/*` 之间直接 import。
