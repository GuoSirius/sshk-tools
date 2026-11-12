# 文档索引与决策看板

- 状态：**所有决策已拍板，M0 工程骨架落地中**
- 版本：v0.4
- 最后更新：2026-11-12 21:26（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`
- 远程：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
- 唯一入口：本文件。任何沟通文档都要在这里登记；找不到就说明还没归档。
- **时间规范：全文一律北京时间，不使用 UTC**（第三轮需求 4 / T10）。

---

## 一、文档清单

| 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|
| 初始需求（结构化） | `01-requirements/2026-11-12-初始需求.md` | 已归档沟通 | 需求 0~7 + 三张图证据 + 术语表 |
| 第二轮需求补充与决策 | `01-requirements/2026-11-12-第二轮需求补充与决策.md` | 已归档沟通 | 第二轮 0~19 + 拍板 + D10 重述 |
| 第三轮需求补充与决策 | `01-requirements/2026-11-12-第三轮需求补充与决策.md` | 已归档沟通 | D10 重定义、D4 收口、D13~D20、时间规范、产物目录迁移 |
| **第四轮决策与开工** | `01-requirements/2026-11-12-第四轮决策与开工.md` | **已定稿** | 仓库地址、latest+lockfile、D19/D21 定稿、M0 交付范围 |
| **技术选型与任务拆分 v0.4** | `02-architecture/2026-11-12-技术选型与任务拆分.md` | 讨论中（决策全定） | 选型对比、四层 UI、导入导出、目录迁移、T1~T10、M0~M7、决策清单、风险 |
| **数据契约 v0.2** | `04-api/2026-11-12-数据契约.md` | 讨论中 | 品牌树、黑白名单、北京时间、配置、zip + 加密密钥、IPC、组件、目录迁移 |
| **发布流程与本机提交钩子** | `05-release/2026-11-12-发布流程与本机提交钩子.md` | 讨论中 | 按 juice-email-cli、`.git/cph` 钩子、Git 铁律、lockfile、无签名发布 |
| 原始需求快照 | `../requirement.txt` | 只读 | 用户原始输入，不修改；冲突时以此为准 |
| UI / 交互稿 | `03-design/` | 待建 | M1 产出 |
| ADR 决策记录 | `01-requirements/decisions/` | 待建 | 按主题一文件，明细记本文件看板 |
| 归档 | `99-archive/` | 待建 | 过期文档只移不删 |

## 二、目录规范（需求 0）

```
docs/
├── 00-index.md          ← 本文件，唯一入口
├── 01-requirements/     ← 四轮需求、快照、图片证据、decisions/(按主题 ADR)
├── 02-architecture/     ← 架构、选型、任务拆分
├── 03-design/           ← UI 稿、交互说明、公共组件说明
├── 04-api/              ← 数据契约（品牌树/配置/zip/IPC/组件/目录迁移）
├── 05-release/          ← 发布流程、签名开关、changelog、首次安装指引
└── 99-archive/          ← 归档（只移不删）
```

| 规则 | 内容 |
|---|---|
| 唯一区域 | 除根 README，所有沟通文档只在 `docs/` |
| 命名 | 一次性 `YYYY-MM-DD-主题.md`；长期维护 `NN-主题.md` |
| 元信息 | 每篇头部写 `状态 / 版本 / 最后更新 / 关联需求` |
| 状态机 | `草稿 → 讨论中 → 已定稿 → 已归档` |
| 定稿后 | 不原地大改，改结论按主题新开 ADR |
| ADR | **按主题**一文件，不搞一决策一文件 |
| 图片 | 原图不进仓库，登记绝对路径 + 含义 + 结论 |
| **时间** | 文档内所有日期时间一律北京时间 |
| 临时产物 | `.tmp/<用途>/`，`.gitignore` 登记，用完即删 |

完整工程目录（apps / packages / 3 个 tools）见选型稿 §1.1；**按里程碑逐步落地，M0 只落 `packages/shared` 与根配置**。

## 三、当前仓库实际状态（M0）

| 项 | 状态 |
|---|---|
| Git | ✅ `git init -b main` + remote `origin` 已配置；首次提交推送中 |
| 根配置 | ✅ `package.json`(latest) / `pnpm-workspace.yaml` / tsconfig / eslint / commitlint / .gitignore / .editorconfig / .gitattributes |
| 共享包 | ✅ `packages/shared`（`time.ts` 北京时间 + 常量/类型/IPC 契约 + 单测） |
| 校验脚本 | ✅ `scripts/check-latest.mjs` / `check-boundaries.mjs` / `verify-structure.mjs`（零依赖，已跑通） |
| CI | ✅ `.github/workflows/ci.yml`（`--frozen-lockfile` + `pnpm verify`） |
| 本机钩子 | ✅ `.git/cph/{pre-commit,commit-msg}` 已落，**未启用**（依赖就绪后启用） |
| 业务代码 | ❌ 未开始，`apps/desktop` / 其余 packages / tools 按 M1/M3 落地 |
| `pnpm-lock.yaml` | ⏳ **待用户执行 `pnpm install` 生成并提交**（AI 不代跑安装） |
| 依赖门禁 | ⏳ typecheck / lint / test 待依赖装好后由用户执行验证 |

## 四、决策看板（**全部已定**）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 首页布局 | C 混合；左侧菜单可折叠展开 |
| D2 / D3 | 模板引擎 / UI 库 | Nunjucks / Vue 3 + Element Plus |
| D4 | 构建/更新/changelog | 方案 A；**按 juice-email-cli 的 changelog 流程与规范复用（含本机 `.git/cph` 钩子）** |
| D5 / D6 | 国产 OS / 签名 | x64 + arm64 / 无证书不签名，留开关 |
| D7 / D8 / D9 | 绑定 / 版本 / 数值列 | 槽位声明式 / 不可变+两种复制 / `Clicks` |
| D10 | 输入组合（重定义） | 图片/excel/csv/json 四种上传 + 邮件 HTML「选择已生成 / 上传外部」二选一 → 生成 |
| D11 / D12 | 长图 / 落盘 | `@zumer/snapdom` / `@seald-io/nedb` |
| D13 | 工具命名 | `edm-studio` + `badge-studio` |
| D14 | 名单粒度 | 模板版本 ID 为主 + 模板族批量；**ID 用户无感，三级选择器/搜索/双向反查** |
| D15 | 分享链接 | 内置只读 HTTP 预览，确保公司局域网内可访问 |
| D16 | 大模型 | 两层：`llm-gateway` + `model-console`（第三个工具） |
| D17 | 导入冲突 | 默认整包覆盖，合并为高级选项 |
| D18 | 密钥跨机 | `SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1` → 口令派生 + AES-GCM 加密的 100% 还原；否则不进包 |
| **D19** | 覆盖产物后悔药 | **已定（第四轮）：直接覆盖，不留 `.prev`、不留历史副本**；后悔药只有手动导出 zip 快照 |
| D20 | 依赖版本 | 直接写 `"latest"`（如 `"dayjs": "latest"`）；**lockfile 必须提交 + CI `--frozen-lockfile`** |
| **D21** | 产物目录与迁移范围 | 应用内可改 `app.outputDir`；**只搬 `outputs/` + `assets/`**，settings/secrets/NeDB db 留 userData；成功后按清单清理旧数据 |
| D22 | 时间 | 一律北京时间，不用 UTC；`shared/time.ts` + dayjs |

### 待办（非决策）

| 项 | 说明 |
|---|---|
| 用户执行 | `pnpm install` → 生成 `pnpm-lock.yaml` → 提交；再跑 `pnpm verify` / `pnpm typecheck` |
| 旧工具存量数据 | 是否要 M4 附一次性迁移脚本 |
| M0 复验 | 依赖装好后 CI 首次绿灯、本机钩子启用 |

## 五、变更记录

| 版本 | 日期（北京时间） | 变化 | 冲突处理 |
|---|---|---|---|
| v0.1 | 2026-11-12 16:40 | 首轮方案：选型对比、M0~M6、D1~D12 | — |
| v0.2 | 2026-11-12 20:40 | 拍板 D1~D12；四层 UI、双层配置、zip、品牌树、拆两工具、覆盖式产物、跨页选择、复用规范、snapdom/NeDB | 推翻 v0.1 三处 |
| v0.3 | 2026-11-12 21:08 | D10 重定义；D4 收口；D13~D18/D20；T10 时间规范、目录迁移、ID 可见性、加密密钥；工具定 3 个 | 推翻 v0.2 四处 |
| **v0.4** | 2026-11-12 21:26 | **D19/D21 定稿、仓库地址确定、M0 开工**；新增第四轮文档、发布流程文档、CI、根配置、`packages/shared`、三个校验脚本 | 无新冲突；D19 选 A |

> v0.1~v0.3 均未进入「已定稿」，故原地升级，不另开文件，避免同主题多份文档造成混乱。

## 六、ADR 记录格式（按主题）

```
# ADR-0001 <主题标题>
- 状态：已定 / 已废弃
- 日期：YYYY-MM-DD（北京时间）
- 关联需求：需求 N / D 编号
- 决策 / 备选方案 / 理由 / 代价 / 影响范围
```

## 七、里程碑索引（v0.4）

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 骨架、`latest` + lockfile、北京时间 `time.ts`、本机提交钩子、分层静态检查、CI 门禁 | **骨架已落，待用户装依赖复验** |
| M1 | 应用壳 + 四层 UI + 三态换肤 + 双层配置 + 3 个工具注册 + 产物目录自定义与迁移 | 待开始 |
| M2 | 发布与更新（按 juice-email-cli、无签名）、changelog、首次安装指引 | 待开始 |
| M3 | 公共底座（ui-kit / repository / backup 加密密钥迁移） | 待开始 |
| M4 | EDM Studio · 品牌树、模板片段版本、黑白名单选择器、三阶段产物 | 待开始 |
| M5 | EDM Studio · 邮件列表、批量、导出、局域网分享 | 待开始 |
| M6 | Badge Studio · 四种数据源 + HTML 选择/上传、badge 注入、snapdom 海报 | 待开始 |
| M7 | `llm-gateway` + `model-console`、右键/托盘、复用清单回填 | 待开始 |

## 八、复用监督清单（需求 15，每完成一个工具回填）

| 工具 | 状态 | 复用到的 packages | 新增公共组件 | 是否出现重复实现 |
|---|---|---|---|---|
| `edm-studio` | 未开始 | — | — | — |
| `badge-studio` | 未开始 | — | — | — |
| `model-console` | 未开始 | — | — | — |

> 判定：同一逻辑出现 ≥2 处即必须提取；`check-boundaries.mjs` + ESLint `no-restricted-imports` 卡住 `tools/*` 之间直接 import。
