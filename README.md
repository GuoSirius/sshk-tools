# sshk-tools

![sshk-tools](apps/desktop/build/logo.svg)

公司内部本地工具集合的桌面客户端（**应用**），供各部门开发、定制并使用日常工具。具备操作系统调用与大模型调用能力，支持本地模型 / 云模型 / 自部署模型服务。

**工具**（`tools/` 下的独立工具包，D13/D16 已定）：

| 工具 | 职责 |
|---|---|
| `edm-studio` | 制作邮件 EDM：品牌 / 模板 / 片段 / 版本、数据填充、三阶段 HTML 生成 |
| `badge-studio` | 上传点击数据 + 选择/上传邮件 HTML → badge 注入 → 生成海报长图 |
| `model-console` | 模型 provider 配置、连接测试、对话调试、用量日志 |

> **当前阶段：M0 工程骨架（已落地，待刷新依赖）**
> 仓库：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
> M0 只落根配置 + `packages/shared` + 校验脚本 + CI；`apps/desktop` 与其余 packages/tools 按 M1/M3 逐步落地，避免空壳。
> **实现顺序（D26）**：`M0 → M1 → M2 → M3 → M7 → M6 → M4 → M5`，M6（badge + 海报）最急，先用现有 `juice-email-cli` 产物跑通；详见 [`docs/02-architecture/2026-11-12-实现顺序与M6先行方案.md`](docs/02-architecture/2026-11-12-实现顺序与M6先行方案.md)。

## 快速开始（安装由你执行，AI 不代跑）

```bash
pnpm install    # 安装依赖（含 Electron 二进制，已配国内镜像）
pnpm dev        # 开发态：主进程 / preload / 渲染三端热更新（自动开 DevTools）
pnpm build      # 产出 out/ 供 electron-builder 打包
pnpm local      # ★ 本地构建测试：NSIS 安装包（x64）→ apps/desktop/dist/*.exe
pnpm local:dir  # 快速模式：只出免安装目录 win-unpacked（不发安装包）
pnpm verify     # 结构/分层/preload/弹框/契约/latest + typecheck(.ts/.vue) + lint + test
pnpm release    # ★ 发布流程：前置检验 → 选版本 → 预览确认 → 构建成功后 tag/推送
```

> `pnpm local` 专为本机 Windows 构建测试设计：自动补 Electron 二进制、内置国内镜像
> （electron + electron-builder-binaries）、只打 x64、可选 `-- --run` 构建完直接启动安装包。
> 等价长命令：`pnpm --filter @sshk/desktop dev|build`。

`pnpm-lock.yaml` **必须提交**，CI 用 `pnpm install --frozen-lockfile`。TypeScript 已按 D24 约束到 6.x，lockfile 已同步到 **6.0.3** 并随仓库提交；`pnpm verify` 在 TS 6.0.3 下全绿（typecheck / lint / 6 tests / 3 个脚本）。

## 文档入口

| 我想… | 去哪 |
|---|---|
| 文档总览、目录规范、**决策看板** | [`docs/00-index.md`](docs/00-index.md) |
| 第一轮原始需求与图片证据 | [`docs/01-requirements/2026-11-12-初始需求.md`](docs/01-requirements/2026-11-12-初始需求.md) |
| 第二轮需求与拍板结论 | [`docs/01-requirements/2026-11-12-第二轮需求补充与决策.md`](docs/01-requirements/2026-11-12-第二轮需求补充与决策.md) |
| 第三轮需求与拍板结论 | [`docs/01-requirements/2026-11-12-第三轮需求补充与决策.md`](docs/01-requirements/2026-11-12-第三轮需求补充与决策.md) |
| 第四轮决策与开工 | [`docs/01-requirements/2026-11-12-第四轮决策与开工.md`](docs/01-requirements/2026-11-12-第四轮决策与开工.md) |
| 技术选型对比、UI 分层、导入导出、目录迁移、任务拆分 | [`docs/02-architecture/2026-11-12-技术选型与任务拆分.md`](docs/02-architecture/2026-11-12-技术选型与任务拆分.md) |
| **模块规范（ESM 优先 / 兼容 CJS）** | [`docs/02-architecture/2026-11-12-模块规范-ESM优先兼容CJS.md`](docs/02-architecture/2026-11-12-模块规范-ESM优先兼容CJS.md) |
| 数据契约（品牌树 / 配置 / zip / IPC / 组件 / 目录迁移） | [`docs/04-api/2026-11-12-数据契约.md`](docs/04-api/2026-11-12-数据契约.md) |
| 发布流程与本机提交钩子 | [`docs/05-release/2026-11-12-发布流程与本机提交钩子.md`](docs/05-release/2026-11-12-发布流程与本机提交钩子.md) |
| 需求原文快照 | `requirement.txt`（只读保留，不修改） |

## 术语（需求 0）

**应用** = 整个安装运行的 Electron 客户端；**工具** = `tools/` 下的独立工具包。
**应用级**（主题、导入导出、应用配置、产物目录、更新）常驻顶部、任意页面可见可用；**工具级**（邮件按钮、badge 属性名配置）只属于某个工具。

## 已定技术栈

Electron + Vue 3 + **Element Plus** + UnoCSS + TypeScript + pnpm workspace
· 模板引擎 **Nunjucks**（槽位声明式绑定）
· 数据落盘 **`@seald-io/nedb`**（纯 JS，免跨架构编译）
· 海报截图 **`@zumer/snapdom`**（资源预处理 + 长图分段）
· 发布 **electron-builder + electron-updater + GitHub Actions**，changelog 流程**按 juice-email-cli**（当前无签名证书）
· 依赖：外部包一律 **`"latest"`**（如 `"dayjs": "latest"`）；**唯一受控例外 `typescript: "6"`**（6.x 最新版 6.0.3，`typescript-eslint` 8 不支持 TS 7）；**`pnpm-lock.yaml` 必须提交** + CI `--frozen-lockfile`

## 全局规范

1. **ESM 优先、兼容 CJS**：所有包 `"type": "module"`；条件导出同时给 `import`/`require`；**Electron preload 因 `sandbox: true` 必须用 `.cjs`**；CJS 依赖用 `createRequire`。详见模块规范文档。
2. **时间一律北京时间（Asia/Shanghai, UTC+8），不使用 UTC**；统一 `packages/shared/time.ts`（dayjs），禁 `toISOString()`。
3. **应用配置可自定义产物目录** `app.outputDir`；改目录只迁移 `outputs/` + `assets/`，成功后按清单清理旧数据，**绝不递归删用户目录本身**。
4. 所有 HTML / 海报产物**直接覆盖、不留历史副本**（D19）；后悔药只有手动导出 zip 快照。
5. 导入导出 zip 包内**全相对路径**；模型密钥默认不进包，设置 `SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1` 后走口令加密的 100% 还原。
6. `docs/` 是**唯一**沟通文档区；一次性记录 `YYYY-MM-DD-主题.md`，长期维护用 `NN-` 前缀；头部写 `状态/版本/最后更新/关联需求`。
7. 定稿后不原地大改，改结论按主题新开 ADR；过期文档移入 `99-archive/`，**不删除**。
8. **能共用的必须提取到 `packages/`，禁止重复实现**（需求 15，监督清单在 `00-index.md` 第八节）。
9. 临时产物统一 `.tmp/<用途>/`，用完即删。
10. Git 小步提交 + 推送；本机 husky 跑不起来，用 `.git/cph` 的 `#!/bin/sh` 钩子：`git -c core.hooksPath=.git/cph commit -m "..."`，**绝不用 `--no-verify`**。

## 注意

`.workbuddy/` 存放项目级配置、技能与记忆，**请勿删除**。
