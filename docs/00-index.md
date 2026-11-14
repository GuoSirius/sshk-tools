# 文档索引与决策看板

- 状态：**M0~M7 全部落地；应用设置中心 / 工具插件化 / 工具包自包含 / Badge 图片识别 / Model Console 模型预设已落地；132 单测全绿、`pnpm verify` 全门禁通过、三端构建通过；IDE 需按文档 §7.3 重载；待 PaddleOCR 绑定确认与 tag 发布。文档已规范化重整：需求 4 合 1、台账去日期前缀、依赖选型反转与 UI 视觉铁律入板（D49/D50）**
- 版本：v1.2
- 最后更新：2026-11-14 20:30（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`
- 远程：`https://github.com/GuoSirius/sshk-tools.git`（分支 `main`）
- 唯一入口：本文件。任何沟通文档都要在这里登记；找不到就说明还没归档。
- **时间规范：全文一律北京时间，不使用 UTC**（T10）。

---

## 一、文档清单

| 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|
| **需求沟通记录（多轮合并归档）** | `01-requirements/需求沟通记录.md` | 已合并归档（原 4 份逐轮文档已删） | 需求 0~7 + 术语表 + D10 输入组合 + 逐轮决策浓缩 + 图证登记 + 开放问题；按状态分组 |
| **技术选型与任务拆分 v0.4** | `02-architecture/2026-11-12-技术选型与任务拆分.md` | 讨论中（决策全定） | 选型对比、四层 UI、导入导出、目录迁移、T1~T10、M0~M7、决策清单、风险 |
| **模块规范（ESM 优先 / 兼容 CJS）** | `02-architecture/2026-11-12-模块规范-ESM优先兼容CJS.md` | 已定（D23） | 分层格式、条件导出模板、preload 产物必须 CJS、常见坑 |
| **实现顺序与 M6 先行方案** | `02-architecture/2026-11-12-实现顺序与M6先行方案.md` | 已定（D26） | 新顺序、依赖校验、M6 补齐空白功能、juice-email-cli 衔接 |
| **开发环境与热更新** | `02-architecture/2026-11-12-开发环境与热更新.md` | 已定（D27） | 方案对比、三端行为对照、命令、M7 依赖修正说明 |
| **工具插件化与需求台账（长期维护）** | `02-architecture/工具插件化需求台账.md` | **持续演进（D37~D48 + 51.x / 52.x 批次）** | 穿插需求台账、工具包契约、宿主能力、Badge 图片识别 / PaddleOCR、IDE 红波浪线、运行时插件路线图、2026-11-14 依赖选型反转与 UI 视觉铁律 |
| **数据契约 v0.2** | `04-api/2026-11-12-数据契约.md` | 讨论中 | 品牌树、黑白名单、北京时间、配置、zip + 加密密钥、IPC、组件、目录迁移 |
| **发布流程与本机提交钩子** | `05-release/2026-11-12-发布流程与本机提交钩子.md` | 讨论中 | 按 juice-email-cli、`.git/cph` 钩子、Git 铁律、lockfile、无签名发布、**Electron 配置与缺失项清单** |
| **首次安装指引** | `05-release/2026-11-12-首次安装指引.md` | 已落 | Windows SmartScreen / macOS Gatekeeper / deb·rpm·AppImage 无签名安装说明 |
| **发布工作流** | `.github/workflows/release.yml` | 已落 | tag 触发三平台矩阵（win-x64 / mac-universal / linux-x64），`--publish never` + GH Release notes |
| **打包配置** | `apps/desktop/electron-builder.yml` | 已接入 | NSIS 允许选择安装目录；图标已配置；签名位留注释 |
| **图标资源** | `apps/desktop/build/` | 已生成并**已提交** | icon.png/.ico/.svg、tray、logo.svg、logo-mark.png 全部统一在该目录（即 electron-builder 的 `buildResources`）；生成脚本 `scripts/generate-icons.py`。`docs/assets/` 已废弃删除 |
| 原始需求快照 | `../requirement.txt` | 只读 | 用户原始输入，不修改；冲突时以此为准 |
| UI / 交互稿 | `03-design/` | 待建 | M1 产出 |
| ADR 决策记录 | 本文件 §四 + `02-architecture/工具插件化需求台账.md` | 已收口 | 早期预留的空目录 `01-requirements/decisions/` 从未落地任何 ADR（Git 也不跟踪空目录），已删除；D1~D50 统一记在本看板，插件化相关细节记在架构文档。后续确需按主题单开 ADR 时再建目录，格式见 §六 |
| 归档 | `99-archive/` | 待建 | 过期文档只移不删 |

## 二、目录规范（需求 0）

```
docs/
├── 00-index.md          ← 本文件，唯一入口
├── 01-requirements/     ← 四轮需求、快照、图片证据（decisions/ 空占位已移除，ADR 统一记 00-index §四）
├── 02-architecture/     ← 架构、选型、任务拆分、模块规范、实现顺序、热更新
├── 03-design/           ← UI 稿、交互说明、公共组件说明
├── 04-api/              ← 数据契约（品牌树/配置/zip/IPC/组件/目录迁移）
├── 05-release/          ← 发布流程、签名开关、changelog、首次安装指引、缺失项
└── 99-archive/          ← 归档（只移不删）
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
| 本机钩子 | ✅ `.git/cph/{pre-commit,commit-msg}` 实跑通过 |
| **M1 应用壳** | ✅ `apps/desktop/`：main / preload / renderer、四层布局、三态换肤、3 个工具注册、UnoCSS、`electron.vite.config.ts`（三端热更新）、`electron-builder.yml` |
| **图标资源** | ✅ 已生成并接入打包配置（纯标准库脚本，零依赖） |
| TS 6 切换 | ✅ `typescript: "6"` → 6.0.3，lockfile 已同步 |
| **M2 发布与更新** | ✅ `release.yml`（tag 触发三平台）、`05-release/首次安装指引.md`、autoUpdater IPC + 检查更新按钮 |
| **构建脚本白名单** | ✅ `allowBuilds: electron / esbuild / electron-winstaller`（pnpm 12 规范写法，修复 `ERR_PNPM_IGNORED_BUILDS`） |
| **本机验证** | ✅ 依赖已安装；`pnpm verify`（13 门禁 / 132 测试）、`pnpm dev`、`pnpm local` Windows 打包均实测通过 |
| 功能页 | ✅ M7 / M6 / M4 / M5 三个工具功能页全部落地 |
| **工具目录与设置中心** | ✅ 主进程单一裁决（启用 / 密钥权限 / 依赖 / 分发白名单 / 元数据覆盖）；顶部设置抽屉管理应用级配置，工具左侧只管工具自有配置；三张独立工具图标 + 无效回退 |

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
| **D42** | **配置布局三选一 + 浏览器式刷新** | `configLayout: single / tabs / menu`，内置工具统一 `single`（一页卡片，去掉割裂的左侧二级菜单）；F5 / Ctrl(Cmd)+R 刷新，Ctrl+F5 / Ctrl(Cmd)+Shift+R 忽略缓存，「更多」下拉提供入口 |
| **D43** | **多分类 / 标签** | `category: string \| string[]` + `tags[]` → 裁决层 `categories[]`；卡片 / 侧栏 / 搜索 / 设置覆盖全链路支持多个分类 |
| **D44** | **Badge 图片数据源** | 图片 → 云端视觉模型或本机 OCR → `parseVisionResult()` → 标准 `StatRow[]` → 回填可校对 CSV；`llm-gateway` 支持 `image_url` 多模态；**视觉模型 API Key 只进 safeStorage，绝不写仓库** |
| **D45** | **PaddleOCR 作为可插拔识别源** | 与云端模型共用「图片识别 provider → 标准结构」抽象；宿主 `runLocalOcr`（无 shell、超时、输出上限）+ 工具包 `scripts/paddleocr_adapter.py` 参考适配器；实际绑定待用户确认本机命令与截图版式 |
| **D46** | **密钥标识校验纯函数化** | `app:tool:<id>:<name>` 标识抽出 `secret-ids.ts` 并放宽为大小写/下划线/连字符；修掉驼峰 `visionApiKey` 被判非法导致 Badge 加载即报错，补 3 个回归单测 |
| **D47** | **模型预设与真实模型列表下拉** | 常用 OpenAI 兼容端点（含 Agnes AI `/v1`）由 `model-console` manifest 自带，用户只填 Key；模型名 `el-select allow-create` + 「拉取模型列表」真实请求 `/models`；保存前可用临时 key 探测且不落盘；预设不含任何密钥 |
| **D48** | **IDE 项目归属收口** | 三套 tsconfig 全 0 错误即证明代码无误；根 `tsconfig.json` 刻意排除 apps，让 `apps/desktop/tsconfig.json` 独占 `.vue`；显式 `types: ["node","vite/client"]`；新增 `electron` paths；去掉反向作用的 Volar takeover 设置；`cspell.json` 消除拼写波浪线；换电脑后须按架构文档 §7.3 重载窗口 / 切工作区 TS 版本 / 重启 TS Server |
| **D49** | **依赖选型反转（强化）** | **推翻旧「优先不新增依赖」倾向**：设计方案时**优先使用成熟第三方 / npm 包，不造轮子**；图标、字体、日期、工具库等常见需求先查成熟包。`@element-plus/icons-vue` 与 **Font Awesome**（`@fortawesome/fontawesome-free`）已批准直接用；仅零依赖校验脚本 / icon 生成脚本等无合适包时自研（与 D30 同源，措辞强化） |
| **D50** | **UI 视觉铁律** | **后续所有界面开发，能用图标处尽量用图标**（按钮 / 状态 / 操作列等）；界面须**美观大方、吸引用户、增强视觉体验**，不将就纯文字或裸箭头（`↓`/`▾` 等一律换图标库）。触发：自动更新按钮曾用 Unicode `↓` 被纠正 |

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
| **用户执行（安装包）** | 本轮大量改动后重新 `pnpm local` 生成 Windows 安装包做安装测试 |
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
| `model-console` | 已落 | shared / repository / ui-kit / llm-gateway | `tool.manifest.json` | 无 |

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

门禁：`pnpm verify` = 7 个结构检查 + typecheck(.ts/.vue) + lint + **98 tests / 18 files** 全绿。
