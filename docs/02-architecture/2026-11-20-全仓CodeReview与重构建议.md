# 全仓 Code Review 与重构建议（2026-11-20）

- 状态：**待用户逐项确认**（本报告只审查、只给方案，未改任何代码）
- 版本：v1.0
- 最后更新：2026-11-20（北京时间）
- 关联需求：用户 2026-11-20「彻底全面 code review」19 项指令；关联决策 D37/D39/D50/D51/D32；铁律「dev 模式全量展示」
- 审查方式：静态审查（结构扫描 + 关键文件精读 + 全仓 grep 交叉核验），未改动任何代码
- 结论处置原则：用户已明确**不考虑兼容性**，允许彻底重构性修复，禁止打补丁

---

## 〇、结论摘要

- **高危（必须修）**：8 项 —— 见 §十九 TOP 清单 H1~H8
- **中危（应修）**：16 项 —— M1~M16
- **低危/建议**：12 项 —— L1~L12
- 三个最大结构性问题：
  1. **dev 判断双源不一致**：主进程 `!app.isPackaged` vs 渲染层 `import.meta.env.DEV`，`pnpm start`（electron-vite preview）下两端行为分裂（§八）；
  2. **文件能力边界错位**：`apps/desktop/src/main/fs.ts`（2047 行 FsRuntime）是 file-manager 工具的完整后端，却住宿主 main，破坏工具自包含（D39）（§四/§十四）；
  3. **三大基础能力「配置入口藏在可禁用的工具里」**：模型 Provider、上传通道、分享服务的配置 UI 全在工具页面，工具一旦禁用/未启用，应用级配置不可达（§十一）。

---

## 一、环境变量：声明未用 / 使用未声明（用户项 1）

门禁 `scripts/check-env.mjs` 存在且本轮通过（源码 24 键 vs 模板 26 声明 + @external 豁免 6 + 框架白名单 6），基础面健康。逐条核验发现 1 处使用未声明：

| # | 级别 | 问题 | 证据 | 方案 |
|---|---|---|---|---|
| E1 | **中** | `SSHK_TOOLS_ALLOW_SECRET_MIGRATION` 在 5 处源码使用，但 `.env.example` 未声明 | 使用点：`apps/desktop/src/main/index.ts`、`packages/backup/src/{manifest,export,crypto}.ts`、`packages/shared/src/constants.ts`；`.env.example` grep 零命中 | A（推荐）：`.env.example` 补登记（含 `@external` 理由「备份迁移口令开关，D17」），使 check-env 把它纳入契约；B：维持现状并写明豁免理由（不推荐——失去契约可见性） |

其余核验结论（均正常，记录备查）：
- `import.meta.env.DEV` 仅渲染层 5 处（App/SettingsPage/VerifyGuidePage/GeneralTab/ToolsTab），无滥用；
- `process.env.*` 直读仅 2 处（XDG_CACHE_HOME / LOCALAPPDATA，属框架级回退，正常）；
- `SSHK_*` 全部经 `getEnv/getEnvStr/getEnvBool/getEnvHas` 统一入口（baked-env 构建期烤入机制），无散落 `process.env` 直读；
- `.env` 实际值 ⊆ `.env.example` 声明，无僵尸声明；
- 声明未用：无（26 项声明全部有消费点或 @external 理由）。

---

## 二、代码声明未用 / 使用未声明（用户项 2）

| # | 级别 | 问题 | 证据 | 方案 |
|---|---|---|---|---|
| U1 | **中** | `ui-kit` 导出的 `useSelection` composable **全仓零使用**（仅 ui-kit 自身定义与导出） | grep `useSelection`：仅 `packages/ui-kit/src/index.ts` + `composables/useSelection.ts` | A（推荐）：删除导出与文件（未发布，无兼容负担）；B：若近期有表格多选计划则保留并在 plans/01 登记「待推广」。零引用的「预留抽象」违背 YAGNI，当前状态是死代码 |
| U2 | 低 | `ui-kit` 导出 `createSafeHost`/`SafeHostChannelMap`/`logFront` 等使用面极窄（待逐一核实），存在「导出面 > 实际消费面」倾向 | `packages/ui-kit/src/index.ts` 导出清单 vs 各处引用 | 对 ui-kit 做一次「导出审计」：把零引用导出移入 `@internal` 或删除，保持包接口最小化 |
| U3 | 低 | 全仓 TODO/FIXME/HACK 扫描为零——既说明无烂尾标记，也说明「未完成项」只活在文档里 | grep 无命中 | 维持现状；建议未完成项继续走台账登记（已有惯例） |

> 深度说明：本轮为静态抽查级扫描，未运行 ts-prune / knip 级全量死代码分析。建议后续在 `pnpm verify` 增加一道 knip 检查（见 §五 O3）。

---

## 三、重复代码 / 可提取 / 已抽取实现的复核（用户项 3）

### 3.1 新发现的重复与漂移

| # | 级别 | 重复点 | 证据 | 方案 |
|---|---|---|---|---|
| R1 | **高** | **时间格式化绕过 shared/time.ts**：badge-studio `state.ts:208,486`、model-console `ProvidersPage.vue:192,194` 用 `new Date().toLocaleString('sv-SE')`（瑞典语 locale hack）；template-tool `state.ts:25` 用 `toLocaleTimeString()`。违反 T10 铁律「时间一律北京时间，统一 shared/time.ts，禁 toISOString()」的立法意图 | grep `toLocaleString/toLocaleTimeString` | 提取 `ui-kit` 或 `shared/time.ts` 补充 `formatNow()` / `formatTime(ts)` 快捷函数，5 处全部替换；在 `check-boundaries` 或 lint 加禁 `toLocaleString('sv-SE')` 规则防回潮 |
| R2 | **高** | **UploadProfile 类型双真相源**：`packages/shared/src/upload-manager.ts` 与 `packages/upload-core/src/types.ts` 各自定义 `UploadTargetType`、`UploadProfile`、remote profile 结构，字段一旦漂移即静默不一致 | 两文件 grep 对比 | 单一真相源放 `shared`（渲染层可安全引用），`upload-core` 从 shared re-export 类型；或反向（core 定义、shared 仅 re-export Node 侧不依赖的子集）。推荐前者（与 upload-manager.ts 头注释「渲染层不能拖 Node 依赖」的设计一致） |
| R3 | 中 | **脱壳算法两份**：`apps/desktop/src/renderer/plain.ts`（toPlainArg）与 `apps/desktop/src/preload/plain.ts`（toPlain）算法相近、语义有别（函数/回调保留与否） | 两文件对照，注释已自述差异 | 可接受（语义确实不同），但建议抽公共 `plain-core.ts`（参数化 `keepFunctions`），两处薄封装——消除约 40 行近似代码 |
| R4 | 中 | **表格页模式重复**：列表 + 搜索 + el-pagination + 操作列 + 批量删除（ElMessageBox）+ 导出，在 edm 5 页、share-manager 4 页、file-manager ContentsPage、badge PostersPage 共 11+ 处各自实现 | grep el-pagination 10 文件、ElMessageBox 25 文件 | 提取 `ui-kit` 增 `useTablePage()`（分页状态 + 加载 + 错误提示 + 刷新）与 `TableOpsColumn` 组件（操作列 ≤3 按钮 + 更多下拉，plans/01 已有规范但无组件落地） |
| R5 | 中 | **hint 样式双轨**：宿主用 `ui-kit/FormHint` 组件；各工具页用 `.hint` span + scoped CSS（台账 #30 还为此打过全局间距补丁） | grep FormHint：工具 0 使用 | 工具页统一改用 FormHint（见 §十七 C1） |
| R6 | 低 | `isUploadCloudVendor` 判断逻辑在 shared/upload-vendors 与 upload-core validation 各有一份近似实现 | 两文件对照 | 并入 R2 的类型归一时一并收敛 |

### 3.2 已抽取实现的复核（合理性与一致性）

| 抽取物 | 复核结论 |
|---|---|
| **IPC 失败契约**（`main/ipc-wrap.ts` handleOk + `shared/ipc-result.ts` + preload 统一解包 + `classifyExpected` 业务错误归类） | ✅ 设计优秀：永不 reject、错误分类、日志分级齐全，四端（main/preload/shared/工具）语义一致。唯一建议：`classifyExpected` 的正则归类集中了云 SDK 知识，宜挪到 upload-core 侧注册（宿主不认识具体 SDK），改为「provider 注册错误分类器」模式 |
| **preload 白名单桥接**（`preload/index.ts`） | ✅ 分组命名空间清晰、注释完备。建议：`env.d.ts` 336 行手写 window.api 类型与 preload 结构双维护，易漂移（见 §十六 D6） |
| **api-plain.ts + plain.ts 双层脱壳** | ✅ 必要（contextBridge 序列化时机注释解释正确），保留；命名易混见 §九 N3 |
| **share-core 内核 + main/share-hub.ts 宿主封装** | ✅ 分层正确（内核纯 Node、宿主收敛生命周期/toolId 鉴权/迁移）。但 ShareDialog 放 ui-kit 是错位（见 §三 3.3） |
| **ui-kit** | ⚠️ 部分错位：`ShareDialog.vue`（625 行）是分享业务组件，放「纯通用 UI 库」破坏 ui-kit 定位 → 移至 `share-core`（渲染侧）或宿主组件（见 §十一 S3）；`useSelection` 死代码（U1） |
| **shared 包** | ⚠️ 「契约 + 裁决 + 领域数据」混装：`types/fs/tool-catalog/tool-skeleton/upload-vendors/upload-manager/verify-steps/trust/baked-env` 27 个文件，其中 upload-* 是领域层非契约层 → 建议拆 `@sshk/upload-shared`（或并入 upload-core 的 node-safe 子入口）见 §六 A2 |
| **baked-env 机制** | ✅ 构建期烤入 + 运行时覆盖白名单设计好，与 check-env 联动成闭环 |

### 3.3 归属错位清单

| # | 组件 | 现位置 | 建议位置 | 理由 |
|---|---|---|---|---|
| X1 | `ShareDialog.vue`(625行) | ui-kit | share-core 渲染子入口 或 `apps/desktop` 宿主组件 | ui-kit 应零业务；ShareDialog 深度绑定分享凭证/路由语义 |
| X2 | `share-ticket.ts` | ui-kit | 同 X1 | 与 ShareDialog 同源迁移 |
| X3 | `FsRuntime`（fs.ts 2047 行） | 宿主 main | file-manager 工具 `src/main/` 或新包 `@sshk/fs-core` | 见 §十四 B1（最大边界问题） |
| X4 | `tool-skeleton.ts`（骨架生成 350 行） | shared | 独立 devDependency 包或 scripts 侧 | 它是「开发期工具」不是运行时契约；打进 shared 意味着所有工具运行时携带骨架代码 |

---

## 四、工具代码上移应用层 / 应用层下放工具层（用户项 4）

| # | 级别 | 方向 | 内容 | 方案 |
|---|---|---|---|---|
| T1 | **高** | 工具→应用 | 上传通道配置 UI（`file-manager/ProfilesPage.vue` 603 行 + CloudProfileForm/RemoteProfileForm）：通道 profile 本已是应用级（`app.upload.*` + `app:upload:<pid>` 密钥命名空间），但唯一配置入口在可禁用的工具里 | 升为设置中心「上传通道」分组（方案细节见 §十一 U-A） |
| T2 | **高** | 工具→应用 | 模型 Provider 配置 UI（`model-console/ProvidersPage.vue` 413 行）：badge-studio 视觉识别等其它工具依赖模型配置，配置入口却在 model-console | 升为设置中心「模型服务」分组（§十一 M-A） |
| T3 | **高** | 应用→工具 | `main/fs.ts` FsRuntime（2047 行：传输队列/分片/续传/媒体播放/chmod/压缩/收藏）是 file-manager 的业务后端，住宿主 main 违反 D39 工具自包含 | A（推荐）：下沉 `tools/file-manager/src/main/fs-runtime/`（可再拆模块，经宿主能力拿 config/密钥）；B：抽 `packages/fs-core`（若未来第二个工具也要文件能力则选 B）。注意 manifest.main 目前为空串，需为 file-manager 启用 main 入口（契约已支持，D41） |
| T4 | 中 | 应用→工具 | `main/presets.ts`（模型预设）+ `seedDefaultProviders()`（index.ts:287）：预设是 model-console manifest 自带的设计（D47），但播种逻辑住宿主 | 随 T2 一起：预设数据归应用级配置或 model-console manifest，播种收敛到一个宿主侧「应用级播种器」（与 provider 配置位置对齐） |
| T5 | 中 | 应用→共享 | `main/local-res.ts` + `local-res-rules.ts`：本地资源流式服务（206 渐进下载）目前只服务音视频播放（file-manager 场景） | 若仅 file-manager 使用 → 随 T3 下沉；若 share/local-res 有第二消费者 → 抽 `packages/local-res`。需 grep 确认消费者后定 |
| T6 | 低 | 工具→共享 | 各工具的 CSV/xlsx 解析（badge xlsx）、文件名清洗、批量包装（fflate zipSync 在 edm/file-manager/badge 三处直接用） | 提取 `ui-kit`/新 `packages/export-core`：`exportZip(entries)`、`exportSingleFile()` 统一命名/编码/确认弹框参数 |

---

## 五、代码缺陷、优化点、待增强（用户项 5）

| # | 级别 | 缺陷/优化 | 证据 | 方案 |
|---|---|---|---|---|
| O1 | **高** | **pnpm start（preview）模式行为分裂**：main 以 `!app.isPackaged` 判 dev（会自动开 DevTools、跳过更新检查、走 dev 更新桩），渲染层以 `import.meta.env.DEV` 判（隐藏 dev 功能）。preview 下「主进程当 dev、渲染层当生产」 | `main/index.ts:61` vs 5 处 renderer `import.meta.env.DEV` | 统一 dev 判据为构建期常量 `__SSHK_DEV__`（electron.vite.config.ts define 注入 main/preload/renderer 三端，值 = mode==='dev'），main 与 renderer 全部替换；详见 §八 |
| O2 | **中** | `registerIpc()`（index.ts:334-960）约 600 行巨型函数，窗口/托盘/目录/迁移/更新/LLM 流式/配置/目录裁决全部内联 | 文件 outline | 拆 §六 A1 |
| O3 | 中 | 门禁体系缺「死代码/未用导出」检查（U1 这类问题门禁抓不到） | check 脚本清单 13 道 | 加 knip（或 ts-prune）进 `pnpm verify`；与 check-env 并列 |
| O4 | 中 | `classifyExpected` 把云 SDK 错误知识硬编码在宿主 ipc-wrap（正则匹配中文/英文关键词） | `ipc-wrap.ts:21-37` | 改注册制：upload-core 等 provider 包注册 `errorClassifier`，宿主只跑注册表 |
| O5 | 中 | `env.d.ts` 手写 window.api 全量类型（336 行）与 preload 实现双维护 | `renderer/env.d.ts` | 由 preload 的 api 对象 `typeof` 推导 + `IPC_CHANNELS` 泛型映射，消手写漂移 |
| O6 | 低 | `main/services.ts`（435 行）职责命名过泛（"services" 什么都能装） | 文件名 | 按实际内容拆分并改名（需精读后定，列入重构执行时第一刀） |
| O7 | 低 | generate-icons.py 手写零依赖（D30 已批例外）| scripts/ | 维持 |
| O8 | 中 | **工具禁用后宿主常驻服务照跑**：share-hub 是宿主级常驻 HTTP 服务，share-manager 只是管理台；禁用 share-manager 后服务无 UI 可管（是否预期未拍板） | share-hub.ts autoStart 设计 | 见 §十一 S2 方案 A/B |
| O9 | 低 | badge-studio main 侧 `hash.ts`/`adapter.ts` 与 core/ 职责有交叉 | 目录对照 | 重构时按「core=纯函数、main=宿主 IPC 适配」重整边界 |
| O10 | 低 | PaddleOCR 本机绑定待确认（台账 #13）⏳；上传真实链路 V7 待验（遗留总账） | 台账 | 维持待用户输入状态 |

---

## 六、应用层分层与组织结构（用户项 6）

### A1. main/index.ts 拆分方案（1131 行 → 6 个模块）

现状函数清单（grep 实测）：createWindow/createTray/catalog 裁决（readProvider/allManifests/pickOverrides/buildCatalog/isToolActive）/播种迁移（seedDefaultProviders/migrateLegacyVisionConfig/migrateLegacyUserData）/compactDatabase/registerIpc(600行)/更新（pushUpdate/wireAutoUpdater/setupAutoUpdate）。

建议目标结构：

```
apps/desktop/src/main/
├── index.ts              # 只留：app 生命周期编排 + whenReady 装配（~150 行）
├── window.ts             # createWindow + 窗口事件 + reload 协议
├── tray.ts               # 托盘
├── catalog.ts            # buildCatalog/pickOverrides/isToolActive/工具目录裁决 IPC
├── ipc/                  # registerIpc 拆为一目录
│   ├── config.ts  ├── dev.ts  ├── update.ts  ├── llm.ts
│   ├── share.ts  ├── upload.ts  ├── fs.ts(过渡,见T3)  └── tools.ts
├── migrations.ts         # migrateLegacyUserData/VisionConfig/seed
├── updater.ts            # pushUpdate/wireAutoUpdater/setupAutoUpdate
└── compact.ts            # compactDatabase
```

### A2. 渲染层结构（现状无 pages/ 目录）

```
apps/desktop/src/renderer/          # 现状：App.vue/SettingsPage.vue 平铺根、VerifyGuidePage 在 components/
建议：
├── App.vue                         # 壳
├── pages/
│   ├── SettingsPage.vue            # 从根移入
│   └── VerifyGuidePage.vue         # 从 components/ 移入（它是整页，不是组件）
├── components/                     # 只放真组件（SidebarMenu/ToolIcon/SecretPromptDialog/...）
├── components/settings/            # 设置抽屉 tabs（保持现有拆分模式，良好）
├── components/tool-form/           # 清单编辑（保持）
└── composables/
```

> 佐证：tools 侧全部遵循 `renderer/XxxPage.vue`（工具主页面）+ `pages/`（子页）结构，宿主是唯一不遵循 pages 约定的渲染层。

### A3. shared 包内聚（结合 §三 3.2）

建议 shared 保留「纯契约 + 裁决 + 机制（time/ipc-result/baked-env/trust/pkg-validate）」，领域数据（upload-manager/upload-vendors/official-keys/verify-steps）外迁为领域包，使 shared 回归 D33「纯契约/裁决层」的自我描述。

---

## 七、健壮性 / 可靠性 / 可读性 / 可维护性（用户项 7）

| # | 级别 | 项 | 结论 |
|---|---|---|---|
| Q1 | ✅ | IPC 边界 | handleOk 永不 reject + preload 统一解包 + AppError 归类，健壮性好（§3.2） |
| Q2 | ✅ | 入参脱壳 | 双层脱壳设计正确（contextBridge 时机注释准确） |
| Q3 | ✅ | 密钥 | safeStorage + sha256 摘要 + 命名空间校验（secret-ids.ts 有回归测试），符合安全与密钥体系 |
| Q4 | ✅ | 数据库 | compactDatabase 有 daily/startup/quit 三时机（index.ts:321） |
| Q5 | ⚠️ | 时间/locale | 5 处绕过 shared/time（R1，高危档） |
| Q6 | ⚠️ | 可维护性 | 4 个 1000+ 行文件（§十五 F1~F7）是主要维护阻力 |
| Q7 | ⚠️ | 双真相源 | UploadProfile 类型（R2） |
| Q8 | ⚠️ | 工具禁用语义 | 三大能力配置不可达（O8/§十一） |
| Q9 | ✅ | 测试 | 224+ tests / 41 files（收尾基线），门禁 13 道；建议补 knip（O3）与「时间规范 lint 规则」 |
| Q10 | ✅ | 注释质量 | 抽查的 ipc-wrap/share-hub/api-plain/baked-env 头注释与实现一致且质量高 |

---

## 八、dev / build / developerMode 判断逻辑专项（用户项 8）★

### 8.1 铁律符合性（逐点核验）

| 位置 | 判断式 | 符合铁律？ |
|---|---|---|
| `renderer/components/settings/ToolsTab.vue:116` | `devFeatures = isDev \|\| appConfig.developerMode` | ✅ 标准先例 |
| `renderer/App.vue:260` | `canShowVerifyGuide = isDev \|\| developerModeOn` | ✅ 同模式（手写展开，见 8.3） |
| `renderer/App.vue:417,465` | `v-if="isDev"` 创建工具/新工具提示 | ✅ dev 恒显 |
| `renderer/SettingsPage.vue:59` | `fields.filter(f => !f.devOnly \|\| isDev)` | ✅ dev 恒显 |
| `renderer/components/settings/GeneralTab.vue:26` | `if (!wanted \|\| isDev) { 直接生效 }` | ✅ dev 不需提权 |
| `main/index.ts:349-350` | 写入 `app.developerMode=true`：`!isDev && !已开 && !isDevOpAuthorized` 则拒 | ✅ 打包版提权、dev 直过 |
| `main/index.ts:411-413` | devtools key：`isDev → markDevOpAuthorized 直过` | ✅ |
| `tools/edm-studio/src/main/ipc.ts:100-101` | `!app.isPackaged → true`；打包版 `app.developerMode===true` | ✅ 语义正确（dev 全权） |
| `renderer/components/ToolManifestDialog.vue` | dev 恒可用；打包版需 developerMode | ✅ |

**结论：铁律本体（dev 下不受 developerMode 限制）执行正确，无「dev 被误关」反例。**

### 8.2 不一致点（真问题）

| # | 级别 | 不一致 | 影响 | 方案 |
|---|---|---|---|---|
| D-1 | **高** | **dev 判据双源**：main=`!app.isPackaged`（3 处：index.ts:61、update-dev-fake.ts:16、edm ipc.ts 间接）；renderer=`import.meta.env.DEV`（5 处）。`pnpm start`（electron-vite preview，NODE_ENV=production、未打包）下：main 认为是 dev（自动开 DevTools、更新走 dev 桩），renderer 认为是生产（隐藏 dev 入口） | preview 调试态行为诡异；将来若出现「构建未打包」产物（CI 产物调试）同样分裂 | **A（推荐）**：electron.vite.config.ts `define` 注入 `__SSHK_DEV__: mode==='dev'`，三端（main/preload/renderer）统一用这一个常量；shared 增 `declare const __SSHK_DEV__: boolean`；`isDevOpAuthorized`/dev-tools.ts 的「是否源码仓库」判据保留 `!app.isPackaged`（其语义本来就是「仓库」，两者概念分开命名：`__SSHK_DEV__`=开发构建、`isSourceRepo`=源码仓库）。**B**：main 改读 `process.env.NODE_ENV==='development'`（electron-vite 已按 mode 注入）——改动小但语义不如 A 显式 |
| D-2 | 中 | **developerMode 判断写法 8 处 4 种**（`isDev||developerMode`、`!isPackaged||developerMode`、`devFeatures computed`、`cfg.get('app.developerMode')===true` 直接判） | 语义相同、写法发散，审计铁律时要逐处人肉核对 | shared 增纯函数 `isDevFeaturesEnabled(isDev: boolean, developerMode: boolean)`（渲染层）+ 宿主侧统一从 catalog 裁决下发 `devFeatures` 布尔字段（工具侧不再自己 `isPackaged||developerMode` 拼装）；全部替换后 lint 禁止新写裸判断 |
| D-3 | 中 | ToolsTab 内 `isDev` 与 `devFeatures` 混用（118/210/230/231/242/251/252/272 行交替出现） | 「dev 才显示的构建按钮」vs「devFeatures 才显示的全量数据」两种语义肉眼难分 | 约定注释规范：`isDev`=构建/源码仓库相关（创建工具、打包入口）、`devFeatures`=功能可见性（全量列表、隐藏工具），并加注释分节 |
| D-4 | 低 | `dev-tools.ts`/`dev-access.ts` 可用性按「是否源码仓库」裁决（符合 AGENTS.md），但该判据（`!app.isPackaged`）与 D-1 的 dev 判据物理上是同一个表达式，概念未分离 | 概念耦合，改判据时易误伤 | 随 D-1 方案 A 一并拆分命名 |

### 8.3 判定

**门控逻辑方向正确，无铁律违例；需要修的是「判据统一」与「写法收敛」**（D-1~D-4）。

---

## 九、命名规范（用户项 9）

| # | 级别 | 项 | 方案 |
|---|---|---|---|
| N1 | 低 | 工具 id 后缀不统一：`badge-studio`/`edm-studio` vs `file-manager`/`model-console`/`share-manager`（-studio vs -manager/-console 无规则） | 已发布工具不改 id（toolId 记账鉴权依赖它，见 share-hub 迁移注释）；写入《工具开发指南》命名规则：「新工具统一 `-manager`/`-studio` 按语义选，禁止随意后缀」，存量不改 |
| N2 | 中 | 工具页面文件位置漂移：file-manager 把编辑器组件（ContentEditorCore/Dialog/Page 3 个）放 `pages/`；share-manager 把弹框（MountEditDialog/ProxyEditDialog）放 `pages/`；edm 把 6 个组件平铺 renderer 根（无 components/）；file-manager 有 components/（只有 TransferPanel） | 统一目标树（§十六 T1）：`pages/` 只放真实页面（XxxPage.vue），组件一律 `components/`，弹框也是组件 |
| N3 | 低 | `api-plain.ts` vs `plain.ts`（renderer）与 `plain.ts`（preload）三文件都叫 plain | 合并为 `renderer/ipc-plain/`（install.ts + to-plain.ts）或改名 `plain-arg.ts` |
| N4 | 低 | `main/fs.ts` 名字过泛（实为文件管理运行时） | 随 T3 下沉时改名 `fs-runtime/`（模块化） |
| N5 | 低 | `main/services.ts` 命名过泛 | O6 |
| N6 | 低 | 工具 util 命名：edm `shared.ts`（易与 packages/shared 混淆）、share-manager `share-util.ts`、badge `state.ts` | 统一为 `store.ts`（若为响应式状态）或按域命名（`edm-context.ts`），禁用 `shared.ts` 做文件名 |
| N7 | ✅ | IPC channel（IPC_CHANNELS 常量 + namespace:action）、包名 @sshk/*、组件 PascalCase、文件 kebab-case | 保持 |

---

## 十、docs 与根目录文档治理（用户项 10）

### 10.1 00-index.md 登记缺口（6 份漏登记）

| 文档 | 现状 | 处置 |
|---|---|---|
| `docs/plans/08-文件管理系统.md`（263 行） | 未登记 | 登记 |
| `docs/plans/09-常驻分享服务设计.md`（320 行） | 未登记 | 登记 |
| `docs/plans/10-传输队列可控化与分片上传.md`（180 行） | 未登记 | 登记 |
| `docs/plans/11-内容管理与文章分享.md`（169 行） | 未登记 | 登记 |
| `docs/plans/12-分享服务工具化与三能力分层设计.md`（223 行） | 未登记 | 登记 |
| `docs/02-architecture/列表页筛选与操作栏规范.md` / `文件管理操作行为清单.md` / `页面留白与间距规范.md`、`05-release/代码签名证书获取与配置.md` / `官方签名密钥跨设备开发.md` | 未登记 | 逐一登记或按 10.3 合并 |

### 10.2 状态漂移（文档说的 ≠ 实际）

| # | 级别 | 漂移 | 修正动作 |
|---|---|---|---|
| G1 | **高** | **README 阶段横幅过时**：仍写「当前阶段：M0 工程骨架（已落地，待刷新依赖）」——实际 M0~M7 全落、已进收尾阶段 | 重写 README 状态区（指向 00-index §三） |
| G2 | **高** | **`pnpm local` 脚本不存在**：README:33/171 与 00-index:100 多处引用 `pnpm local`，package.json 只有 `dist`/`pack` | 文档统一改 `pnpm dist`（或恢复 local 别名，二选一；推荐改文档） |
| G3 | 中 | README:78 「本机 husky 跑不起来，用 .git/cph」与 00-index「husky 已生效、.git/cph 已废弃」矛盾 | README 更新为 husky 现行方案 |
| G4 | 中 | 00-index 文档清单标注 EDM v5「已归档」但文件仍在 02-architecture 未移入 99-archive | 移入 99-archive（只移不删） |
| G5 | 中 | README 技术栈表列 3 个工具（edm/badge/model），实际 6 个 | 更新工具清单（指向 tool-catalog 动态发现机制说明） |
| G6 | 低 | 00-index §三「本机验证 pnpm local」等历史快照表述 | 随 G2 一并清 |

### 10.3 合并 / 归档 / 删除建议

| 处置 | 对象 | 理由 |
|---|---|---|
| **合并** | `plans/01-界面与表单规范` + `02-architecture/页面留白与间距规范` + `02-architecture/列表页筛选与操作栏规范` → 单一《UI 与页面规范》（建议落 plans/01 修订版） | 三份 UI 规范两处存放、口径易分裂 |
| **合并** | `02-architecture/工具包开发打包分发工作流规划.md`（244 行，2026-11-14 规划稿）→ 结论并入《工具开发指南》，原件移 99-archive | 指南已是落地版，规划稿使命完成 |
| **归档** | `02-architecture/EDM系统内容页改造与内容管理统一规划.md`（v5，220 行）→ 99-archive | 00-index 已标「已归档（非权威）」，文件位置未跟上（G4） |
| **归档** | `02-architecture/R26-R27协同开工方案.md`（已完成 B0-B8）→ 99-archive | 完成的开工方案，结论已在各自规划文档 |
| **归档** | `02-architecture/上传能力规划.md`、`代码编辑与富文本共享能力规划.md` 若确认全部条目落地（标题均标「已落地」）→ 99-archive | 落地完成的规划稿按规范归档；若仍留验证项（V7 等），保留并在头部标注「仅剩验证项」 |
| **保留** | 台账（1220 行持续增长） | 唯一需求真相源；建议按季度分卷（台账-2026Q4.md）控制单文件体积 |
| **保留** | 遗留事项与收尾总账、安全与密钥体系、工具开发指南、数据契约、技术选型（门禁依赖）、plans/00~12 | 各司其职 |
| **删除** | 无发现纯垃圾文件 | 99-archive 机制运转正常 |

---

## 十一、三大基础能力分层专项：模型 / 分享 / 上传（用户项 11）★

### 11.1 现状分层地图

| 能力 | packages（内核） | 宿主 main | 配置存储 | 配置 UI（入口） | 操作台（工具） |
|---|---|---|---|---|---|
| 模型 | `llm-gateway` | `index.ts` LLM IPC 段（chat/流式）+ `presets.ts` + 能力注入 | `app.provider*`（应用级） | **model-console/ProvidersPage**（⚠️ 在工具里） | model-console（Chat/Usage） |
| 分享 | `share-core`（851 行内核） | `share-hub.ts`（常驻 HTTP + 生命周期 + toolId 鉴权） | hub-state.json + `app.shareHub.*` | **share-manager 5 页**（⚠️ 在工具里） | share-manager（Routes/Mounts/Proxies/Logs/Service） |
| 上传/文件 | `upload-core`（providers）+ `shared/upload-manager`（配置纯函数） | `upload.ts` IPC + **`fs.ts`（FsRuntime 2047 行，⚠️ 越界）** | `app.upload.*`（应用级）+ `app:upload:<pid>` 密钥 | **file-manager/ProfilesPage**（⚠️ 在工具里） | file-manager（Explorer/Contents/Transfer） |

### 11.2 问题清单

| # | 级别 | 问题 |
|---|---|---|
| S1 | **高** | **「配置藏在可禁用的工具里」×3**：工具被禁用/未启用时，其它工具（badge 用模型识别、edm 用上传、任何工具用分享）的能力仍工作，但用户没有任何入口改配置。这违反「能力所有权与配置入口匹配」原则，也违背 D32「应用级配置进顶部设置」的既有决策精神（上传通道配置已是应用级数据，入口却在工具） |
| S2 | 中 | **share-hub 生命周期与管理台解耦不彻底**：服务宿主级常驻（合理），但启停/端口/日志容量等「服务级配置」在 share-manager ServicePage；禁用 share-manager 后服务照跑且无 UI（O8）。需拍板：服务配置随 S3 升应用级，share-manager 只留路由/挂载/代理运营 |
| S3 | 中 | ShareDialog/share-ticket 放 ui-kit（X1/X2）：业务组件错放通用库 |
| S4 | **高** | FsRuntime 越界（T3）：文件管理工具的后端住宿主 main，2047 行是宿主最大文件；D39「工具自包含」在文件能力上不成立 |
| S5 | 中 | 模型预设/播种逻辑住宿主 main（presets.ts + seedDefaultProviders），预设语义却属于模型能力（D47 说「model-console manifest 自带预设」——实现与决策有出入） |
| S6 | 低 | 上传类型双真相源（R2）加大三能力边界模糊度 |

### 11.3 调整方案（供抉择）

**方案 A（激进·推荐）：三能力「配置 + 服务开关」统一升应用设置中心，工具只留操作台**
- 设置中心新增三个分组：「模型服务」（Provider CRUD + 预设 + 连接测试）、「上传通道」（Profile CRUD，迁移 ProfilesPage 逻辑）、「分享服务」（端口/开关/日志容量/清日志）；
- 工具侧：model-console 留 Chat 调试 + Usage 明细；share-manager 留 Routes/Mounts/Proxies/Logs 运营；file-manager 留 Explorer/Contents/Transfer，删 ProfilesPage（或保留只读链接「到设置中管理」）；
-FsRuntime 下沉 file-manager/src/main（T3-A）；
- 代价：设置抽屉体积 +3 分组、一次数据无迁移（配置键不变，仅 UI 搬家）、约 3~4 个批次工作量。
- 收益：工具可随意禁用，能力配置永远可达；D32 从「精神」变「实现」。

**方案 B（保守）：配置留工具，宿主设置中心放「只读镜像 + 跳转」**
- 设置中心三卡：状态摘要 +「前往工具配置」按钮；工具禁用时按钮置灰并提示；
- 代价小，但「禁用工具后改不了配置」本质上没解决，只是暴露得更明显。
- 不推荐，除非担心设置抽屉过载。

**方案 C（按能力分治）**：模型配置升应用（S1 最痛，badge 等跨工具依赖）；分享服务配置升应用、路由管理留工具；上传通道配置升应用、FsRuntime 下沉工具。= 方案 A 的分批版。

**推荐：C = A 的落地路径**（一次拍板、分三批做，避免大爆炸重构）。

### 11.4 目标架构图（文字版）

```
应用层（宿主）
├── 设置中心：模型服务 / 上传通道 / 分享服务（配置与开关——三能力唯一配置入口）
├── main：IPC 封装 + share-hub 生命周期 + LLM 网关接入 + upload service（密钥 safeStorage）
packages（内核，无 UI）
├── llm-gateway / share-core / upload-core(+node-safe 类型子入口)
└── ui-kit（纯通用，ShareDialog 迁出）
工具层（操作台，可禁用）
├── model-console：对话调试 + 用量明细
├── share-manager：路由/挂载/代理/日志运营
└── file-manager：文件浏览/传输/内容编辑（FsRuntime 回归工具 src/main）
```

---

## 十二、代码 / 声明 / 使用规范一致性（用户项 12）

| # | 项 | 结论 |
|---|---|---|
| C1 | ESM/CJS 契约 | ✅ preload .cjs 门禁 + 条件导出双格式检查在位 |
| C2 | IPC 频道 | ✅ 全量走 IPC_CHANNELS 常量（preload grep 无裸字符串） |
| C3 | 时间规范 | ⚠️ 5 处违例（R1） |
| C4 | 类型真相源 | ⚠️ UploadProfile 双定义（R2） |
| C5 | 配置分层 D32 | ⚠️ 三能力配置 UI 位置与「应用级配置进设置」不一致（§十一） |
| C6 | UI 组件规范 | ⚠️ ToolPageLayout/EmptyState/FormHint 覆盖不均（§十七） |
| C7 | manifest 字段 | ✅ 六工具 manifest 字段使用一致（visibility/configLayout/permissions 语义同形）；纯渲染工具 `main:""` 是契约内合法形态 |
| C8 | 包依赖声明 | ✅ 工具 package.json 依赖声明齐全（@sshk/* 显式声明，check:contract 门禁） |

---

## 十三、功能遗漏 / 不全（用户项 13）

| # | 项 | 状态 | 出处 |
|---|---|---|---|
| F1 | PaddleOCR 本机识别绑定 | ⏳ 等用户提供命令与截图版式（接口已落） | 台账 #13 / D45 |
| F2 | 外部工具包运行时安装/卸载（.sshktool） | 📌 已排期，等签名与沙箱拍板 | 台账 #8 |
| F3 | 上传真实云链路验证 V7 等 | ⏳ 验证清单 | 上传能力规划 / 遗留总账 |
| F4 | 诊断与可观测（plans/04）：一键诊断报告/健康面板 | 部分（diagnostics.ts/health.ts 已有） | 对照 plans/04 核差量 |
| F5 | 云 Provider 补齐（plans/05） | 部分实现（providers 齐但 vendor 数有限） | 对照 plans/05 |
| F6 | 工具健康面板（禁用/失败可视化） | 未实现 | plans/04 |
| F7 | 快照/导出 zip 后悔药（D19 的唯一后悔药）在部分工具未入口化 | 待核 | 数据契约 |

> 本轮静态审查无法判定全部「规划 vs 实现」差量，F4~F7 建议按 plans/04、05 逐条核对后更新遗留总账。

---

## 十四、工具与应用的能力边界（用户项 14）

| # | 级别 | 边界问题 | 建议 |
|---|---|---|---|
| B1 | **高** | FsRuntime（fs.ts）在宿主 main 实现 file-manager 全部后端 → 「工具自包含」失效；宿主包揽工具业务 | 按 T3 下沉（A：工具内；B：fs-core 包）。宿主只保留「IPC 通道 + 密钥 + 审计日志」等平台能力 |
| B2 | 中 | 上传/分享/模型配置 UI 边界（§十一 S1） | 升应用 |
| B3 | ✅ | dev-tools/dev-access/verify-sessions/runtime-installer/diagnostics/health 属宿主平台能力，位置正确 | 保持 |
| B4 | ✅ | badge 视觉识别经宿主 `chat` 能力注入（D37 正向依赖）正确 | 保持 |
| B5 | 低 | badge-studio main 侧 adapter/hash 与 core/ 边界（O9） | 重整 core/main 分层 |
| B6 | 低 | template-tool 展示「全能力」但 file-manager/model-console/share-manager 实际无 main 入口——模板教的是「有 main 的形态」，与 3/6 工具的「纯渲染形态」并存。指南应写明两种形态 | 《工具开发指南》补「纯渲染工具」形态说明 |

---

## 十五、大文件 / 臃肿文件拆分清单（用户项 17）

| # | 文件 | 行数 | 拆分方案 |
|---|---|---|---|
| F1 | `tools/file-manager/src/renderer/pages/FileExplorerPage.vue` | **3039** | 拆 composables：`useExplorerTree`（树/导航/面包屑）、`useTransferQueue`（队列/进度）、`useFilePreview`（预览/媒体）、`useExplorerActions`（右键/重命名/收藏）；拆组件：`ExplorerToolbar` / `ExplorerContextMenu` / `PreviewPane` / `PropertiesDialog` / `RenameDialog`；页面骨架 ≤400 行 |
| F2 | `apps/desktop/src/main/fs.ts` | **2047** | 按 LangID 现有段落注释拆（持久化/控制入口/分片上传/续传清理/媒体播放/只读/写操作/搜索容量/§十一扩展/传输队列/通道元信息/本地选择）→ 或直接随 T3 下沉为 `fs-runtime/` 目录 12 模块 |
| F3 | `packages/file-picker/src/components/FilePickerDialog.vue` | **1549** | 拆 `useFileBrowser`（列表/导航）+ `Breadcrumbs.vue` + `PreviewPanel.vue` + `KindFilterBar.vue`；弹框骨架 ≤400 行 |
| F4 | `tools/edm-studio/src/renderer/pages/ContentManagePage.vue` | **1484** | 左树（SystemTree.vue）/ 元数据表单（MetaForm.vue）/ 示例数据（已抽 SampleForm）/ 预览 tab（PreviewTab.vue）/ 源码 tab（SourceTab.vue）拆出 |
| F5 | `apps/desktop/src/main/index.ts` | **1131** | §六 A1 方案 |
| F6 | `tools/badge-studio/src/renderer/state.ts` | **1088** | 拆 `stores/datasource.ts`（四数据源）+ `stores/poster.ts`（海报参数/产物）+ `stores/recent.ts`（最近使用）+ `index.ts` 聚合 |
| F7 | `tools/edm-studio/src/main/ipc.ts` | **778** | 按域拆 `ipc/content.ts` + `ipc/mails.ts` + `ipc/share.ts` + `ipc/system.ts`（注册函数各自导出，index.ts 聚合） |
| F8 | `packages/share-core/src/index.ts` | **851** | 拆 `server.ts`（HTTP/Range/MIME）/ `routes.ts`（路由表/TTL）/ `static.ts`（目录列表页）/ `logs.ts`（环形缓冲）/ `state-file.ts`（持久化恢复） |
| F9 | `packages/upload-core/src/providers/fs-cloud.ts` | **890** | 拉平到 driver 分层：fs-cloud 组合 fs-paths + cloud-sdk，重复段抽 `cloud-listing.ts` |
| F10 | `packages/ui-kit/src/components/ShareDialog.vue` | **625** | 随 X1 迁出 ui-kit 后按「凭证区/参数区/预览区」拆 |

> 补充：badge-studio `GeneratePage.vue` 660 行、file-manager `ProfilesPage.vue` 603 行（随 T1 迁移时拆）、`shared/types.ts` 629 行（随 A3 拆域文件）。

---

## 十六、目录组织结构统一（用户项 18）

### T1. 工具包目标目录规范（所有工具对齐，写进《工具开发指南》）

```
tools/<id>/
├── tool.manifest.json          # 清单（唯一真相源）
├── assets/icon.svg
├── package.json / tsconfig.json
└── src/
    ├── index.ts                # 渲染入口（纯渲染工具仅此 + renderer/）
    ├── main/                   # 有 main 能力才有（D41: index.ts export default register）
    │   ├── index.ts
    │   ├── ipc.ts              # 可再拆 ipc/ 目录
    │   └── ...领域模块
    └── renderer/
        ├── index.ts            # 渲染挂载入口
        ├── host.ts             # 宿主能力声明（全部工具已统一 ✅）
        ├── store.ts            # 响应式状态（现 state.ts/shared.ts 命名收敛至此）
        ├── pages/              # 只放页面 XxxPage.vue
        ├── components/         # 组件+弹框（现 pages/ 里的弹框、根平铺组件全部归此）
        └── composables/        # use* 组合式
```

### T2. 六工具现状对照表

| 维度 | badge | edm | file-manager | model-console | share-manager | template |
|---|---|---|---|---|---|---|
| main 目录 | ✅ 5 文件 | ✅ 5 文件 | ❌ 无 | ❌ 无 | ❌ 无 | ✅ 1 文件 |
| renderer 根页面 XxxPage.vue | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pages/ 子页 | ✅ 2 | ✅ 5 | ✅ 6（混入 3 组件） | ✅ 3 | ✅ 7（混入 2 弹框） | ✅ 3 |
| components/ 目录 | ❌ | ❌（6 组件平铺根） | ✅ 1 | ❌ | ❌ | ❌ |
| 状态文件 | state.ts | state.ts+shared.ts+upload.ts+ai-copy.ts | ❌ 无独立 | state.ts | share-util.ts | state.ts |
| host.ts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

需收敛项：② pages/ 混组件（N2）；③ components/ 缺失或平铺；④ 状态文件命名与位置。

### T3. 宿主渲染层

见 §六 A2（pages/ 缺失、VerifyGuidePage 错放）。

### T4. packages

命名 `@sshk/*` 统一 ✅；内聚问题见 §六 A3（shared 领域数据外迁）与 §三 X1/X4。

---

## 十七、常用组件 / 布局规范统一（用户项 19）

| # | 级别 | 项 | 证据 | 建议 |
|---|---|---|---|---|
| C1 | **高** | **FormHint/FormGrid 未推广到工具**：宿主 settings/tool-form 在用，6 个工具 0 使用；工具页 hint 用 `.hint` span + scoped CSS，台账 #30 曾为间距问题打全局补丁 | grep FormHint 工具 0 命中 | 所有工具表单统一 FormHint/FormGrid；间距规则由组件内置，删除散落 CSS 补丁 |
| C2 | **中** | **ToolPageLayout 覆盖不均**：file-manager 主页 FileManagerPage、浏览页 FileExplorerPage 均 0 使用；而其子页 ProfilesPage 用了；model-console 子页 ChatPage 也用了（根页已用 → 疑似嵌套双布局，需核验视觉） | grep 计数 0/0/1 | 文件管理主页补 ToolPageLayout（浏览页是全屏工作台可豁免，需在规范里写明豁免条款）；核实 ChatPage 是否双布局 |
| C3 | 中 | **EmptyState 覆盖不均**：12 页在用；GeneratePage/ChatPage/UsagePage/ServicePage/ConfigPage/HomePage/RichTextPage/FileExplorerPage/ProfilesPage 未用 | grep 对照 | 空态统一走 EmptyState（表格空态/搜索空态/初始态三类写进规范） |
| C4 | 中 | **ConfirmDialog 与 ElMessageBox.confirm 双轨**：ui-kit ConfirmDialog 4 页使用；ElMessageBox 25 文件使用 | grep 对照 | 拍板单一约定：A（推荐）以 ElMessageBox.confirm 为唯一危险操作确认（promise 风格、与 Element Plus 一致），ConfirmDialog 降级为特殊场景（表单确认）或删除；B 反向（组件化统一视觉）成本高 |
| C5 | 中 | **分页规范**：el-pagination 10 页统一使用 ✅，但「分页信息展示位置/文案」未对齐 plans/01（如 total 文案中文、页码位置）；最新提交刚清理过无效 total 插槽，说明此处反复出问题 | git log 2835157 | 在《UI 与页面规范》（10.3 合并产物）定死：底栏 layout="total, sizes, prev, pager, next, jumper" + 中文 total 模板；抽 `useTablePage()`（R4）内置 |
| C6 | 低 | **useTablePage 缺失**（R4） | 11+ 处表格页重复 | 提取（§三） |
| C7 | 低 | 工具页操作列「≤3 按钮 + 更多下拉」规范已有文档（台账 #25）无组件落地 | TableOpsColumn 缺失 | 抽组件（R4 一起） |

---

## 十八、注释 / 文档 / 代码一致性（用户项 16）

| # | 级别 | 项 | 处置 |
|---|---|---|---|
| D6 | 中 | `renderer/env.d.ts` 336 行手写 window.api 类型与 preload 双维护 | O5（类型推导） |
| D7 | 中 | D47 说「预设由 model-console manifest 自带」vs 实现 `main/presets.ts` + `seedDefaultProviders()` 住宿主 | 随 T4 对齐（改实现或改 D47 表述） |
| D8 | 中 | ChatPage.vue:180 注释引用「ToolPageLayout body flex:1」——子页与根页双布局的注释自证（C2 一并核） | 核实后修注释或修布局 |
| D9 | 低 | AGENTS.md/README 提到的 `.git/cph` 历史方案在 README 仍描述为现行（G3） | 改 README |
| D10 | ✅ | 抽查高价值注释（ipc-wrap/api-plain/share-hub 迁移/baked-env/upload-manager 头注）均与实现一致、质量高 | 保持这个水准 |
| D11 | 低 | manifest 注释（edm ipc.ts:29「R12：!isPackaged || app.developerMode」）与 D-1 双源问题联动 | 随 §八统一改 |

---

## 十九、TOP 必修清单（汇总排序）

| 级 | # | 一句话 | 关联 |
|---|---|---|---|
| H1 | 统一 dev 判据 `__SSHK_DEV__` 三端注入，main 弃用 `!app.isPackaged` 判 dev（isSourceRepo 概念分离） | O1/D-1 |
| H2 | `main/fs.ts` FsRuntime 下沉 file-manager（或抽 fs-core），fs.ts 目录化拆分 | T3/B1/F2 |
| H3 | 三能力配置入口升设置中心（模型/上传/分享三分组，分三批） | §十一 方案 C |
| H4 | 时间格式化 5 处违例替换为 shared/time 统一函数 + lint 防回潮 | R1 |
| H5 | UploadProfile 类型归一（shared 单一真相源） | R2 |
| H6 | main/index.ts 拆分（A1 六模块，registerIpc 目录化） | O2/F5 |
| H7 | FileExplorerPage.vue（3039 行）拆分 | F1 |
| H8 | 00-index 登记 6+ 份漏登文档 + README 过时三处修正（M0 横幅/pnpm local/.git/cph）+ EDM v5 移 99-archive | §十 G1~G5 |
| M1 | developerMode 判断收敛为 shared 纯函数 + 裁决下发 | D-2 |
| M2 | useSelection 删除或推广（推荐删） | U1 |
| M3 | ShareDialog/share-ticket 迁出 ui-kit | X1/X2 |
| M4 | FilePickerDialog（1549）/ContentManagePage（1484）/badge state.ts（1088）/edm ipc.ts（778）拆分 | F3/F4/F6/F7 |
| M5 | 工具目录规范对齐（pages/ 只放页面、components/ 收编、store.ts 命名） | T2/N2/N6 |
| M6 | FormHint/FormGrid 推广到全部工具表单 | C1 |
| M7 | 确认弹框双轨收敛（ElMessageBox 单轨） | C4 |
| M8 | ToolPageLayout/EmptyState 覆盖补齐 + ChatPage 双布局核实 | C2/C3 |
| M9 | knip 死代码门禁 + classifyExpected 注册制 | O3/O4 |
| M10 | presets/播种逻辑归属对齐（T4） | D7 |
| M11 | env.d.ts 类型由 preload 推导 | O5/D6 |
| M12 | ui-kit 导出审计 + useTablePage/TableOpsColumn 提取 | U2/R4 |
| M13 | 领域数据迁出 shared（upload-manager 等） | A3 |
| M14 | 文档合并三合一（UI 规范）+ 两份完成规划归档 + 工作流规划并入指南 | §十 10.3 |
| M15 | 服务配置随 H3 升应用级，share-manager 只留运营页 | S2 |
| M16 | 台账按季度分卷 | §十 |

建议批次（供排期参考，用户拍板）：
- **批 1（判据与真相源）**：H1/H4/H5/M1/M11 —— 纯代码收敛，无 UI 变化
- **批 2（边界重构）**：H2/T3/T5/H6/M10/M13 —— main 大手术
- **批 3（能力配置升层）**：H3/M15/T1/T2 —— 设置中心三分组 + 工具页瘦身
- **批 4（大文件拆分）**：H7/M4/F8/F9 —— 渲染层与包拆分
- **批 5（组件规范统一）**：M2/M3/M6/M7/M8/M12
- **批 6（文档治理）**：H8/M14/M16 + 《工具开发指南》补纯渲染形态（B6）
- 每批完成跑 `pnpm verify` 全绿后提交，conventional commits。

---

## 二十、待用户拍板事项（多方案抉择）

| # | 决策点 | 选项 |
|---|---|---|
| P1 | dev 判据统一机制 | A：`__SSHK_DEV__` define 注入（推荐） / B：NODE_ENV 判断 |
| P2 | FsRuntime 去向 | A：下沉 file-manager 工具（推荐） / B：抽 packages/fs-core |
| P3 | 三能力配置升层 | A：全升设置中心（激进） / B：只读镜像（保守） / C：分能力分批（=A 的路径，推荐） |
| P4 | share-manager 禁用后服务是否继续跑 | 维持现行为 + 文档说明 / 服务随管理台启停（不推荐，破坏其它工具分享） |
| P5 | ConfirmDialog vs ElMessageBox 单轨 | ElMessageBox 单轨（推荐）/ ConfirmDialog 组件化 |
| P6 | useSelection | 删除（推荐）/ 推广落地 |
| P7 | 文件名规范 | pages 内禁组件（推荐）/ 维持现状 |
| P8 | `pnpm local` | 文档改 `pnpm dist`（推荐）/ 恢复 local 别名脚本 |
| P9 | 工具 id 存量命名 | 保留 + 指南立规（推荐）/ 统一改名（高成本，toolId 迁移） |
| P10 | shared 领域数据外迁 | 拆领域包（推荐）/ 维持 |

---

> 本报告为纯审查产物，未改动任何代码。各项修复执行时按 AGENTS.md 登记《工具插件化需求台账》，落档索引已在 `docs/00-index.md` 文档清单登记。
