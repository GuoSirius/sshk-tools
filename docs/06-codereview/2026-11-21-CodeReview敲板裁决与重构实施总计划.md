# CodeReview 敲板裁决与重构实施总计划（2026-11-21）

- 状态：**执行中（2026-11-21 开工令，台账 #156）：P0-1/P0-2 ✅ 已完成 · P0 全部 ✅（P1-7 顺批完成）· P1 起进行中/待执行**
- 版本：v1.4（v1.0 = 敲板汇总；v1.1 = 终审落档；v1.2/v1.3 = 菜单规整二/三轮；**v1.4 = 全页面统一重构指令入 §九 执行总原则（#155），P4 迁即重构 / P6 收窄**）
- 日期：2026-11-21（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`（分支 `main`）
- 关联需求：台账 #151；输入四份文档（本目录下 报告A / 报告B / 二次复核台账 v1.1 / 交叉合并总计划）+ 用户 2026-11-21 敲板消息（报告B 40 项 + 报告A 18 项 + 台账 C1/C4/Q-01~21 + **重构新想法 1~8**）
- 决策入口：本文 §二（已确认）/ §三（冲突点）/ §四（待确认）；实施以 §九 批次为唯一排期。
- 处置原则不变：不考虑兼容、禁止双轨兜底、危险操作二次确认、每批 `pnpm verify` 全绿 → conventional commit → push → `git log -1` 核验。

---

## 〇、一页速览（TL;DR）

1. **敲板总体成立，无推翻性冲突**；识别出 **3 处真冲突 + 2 处敲板前提过时 + 1 处与仓库铁律冲突**（§三 CF-1~CF-6）+ **11 个小落点**（§四 C-1~C-11）——**已于 2026-11-21 全部终审落定（§十三）**，其中 CF-1 终审改判：developerMode **保留不删**（D52 推翻 → D55）。
2. **重构新想法吸收了多个待决策点**：三基础能力工具（file-manager / model-console / share-manager）并入「应用管理」成为应用本体后，Q-03（FsRuntime 下沉）、Q-04（三能力配置升层）、Q-22（share-hub 生命周期）、S1/S2（配置藏在可禁用工具）等**不再是问题**——它们从"待决策"变为"被架构吸收"（§五.7）。
3. **Q-19 useSelection 改判**：它正是当初为「需求 8·跨页选择」建的 composable（代码注释自证），按你的敲板从"删除"改为**保留 + 增强 + 全量多选表格接入**（§七）。
4. **F2（.sshktool 运行时安装/卸载）主体已做完**：SystemTab「运行时工具包」区已有 预览/安装（含降级确认）/卸载/信任钥导入吊销 全套 UI；剩全链路实测演练（§八）。
5. 实施分 **10 个阶段（P0~P9）**，P0 判据与地基 → P1 正确性 → P2 抽象建库 → P3 main 层重构 → P4 应用管理架构重构（最大批）→ P5 包内聚 → P6 页面接入与大文件拆分 → P7 删除清理 → P8 文档治理 → P9 验证收尾（§九）。
6. **全页面统一重构指令（2026-11-21 用户指令·台账 #155）**：趁此次重构，**所有页面（新建+存量）全部重构到位**——尽量提前、优先复用公共组件，杜绝散乱与不统一；**迁移即重构**（P4 每迁一页直接落公共组件+规范清单重写），P6 只收尾纯工具页（§九 执行总原则）。

---

## 一、敲板核对总述与前提勘误

- 报告A 18 项、报告B 40 项、台账 C1/C4/Q-01~Q-21（除明确外均采纳建议）、重构新想法 1~8，**全部逐项登记**于 §二；结论落点精确到 §九 批次号。
- **前提勘误（不影响敲板方向，但纠正事实）**：
  - 报告B 第 1 条称 `SSHK_TOOLS_ALLOW_SECRET_MIGRATION` "在 5 处源码使用"——二次复核已证实**全仓零代码读取**，批1/批3 已清理注释残留。本敲板实际剩余动作 = Q-18 文档终扫 + 口径声明「填迁移口令即加密携带，无 env 开关」（P8-3）。`.env.example` 不补登记（C1 已裁 A 对）。
  - 报告B 第 2 条 useSelection"零使用→建议删除"——你改判为落地跨页多选需求，方向成立（见 §七）。
- **被敲板推翻的既有决策**（按 ADR 规则登记"已推翻"标注，不回收编号）：
  - **D45（PaddleOCR 可插拔识别源）→ 推翻**（B19/F1：彻底移除，不再考虑本机识别）。
  - **AGENTS.md「开发模式铁律」中的 `app.developerMode` 机制 → 推翻**（B23：删除开关，只区分 dev/build；铁律"dev 全量展示"本体保留，P0-2 修订文本）。
  - **D36（设置抽屉形态）→ 被 D53 吸收**（应用设置从侧滑抽屉变应用管理页面）。
  - **D39 的适用范围收窄**：工具自包含原则只对「纯工具」成立；三个基础能力模块属应用本体（D53）。

---

## 二、已确认裁决总表

> 「落点」= §九 批次号。状态列：✅=直接执行；🔁=改判（含理由）；📦=被新架构吸收。

### 2.1 报告B（2026-11-20-全仓CodeReview与重构建议）40 项

| B# | 敲板内容 | 结论 | 落点 |
|---|---|---|---|
| B1 | SECRET_MIGRATION env 文案全删 | ✅（代码已清，余文档终扫） | P8-3 |
| B2 | useSelection = 跨页跨搜索多选能力，全部多选表格接入 | 🔁 Q-19 删除→**推广落地**（§七） | P2-1 / P4 / P6-1 |
| B3 | ui-kit 导出审计，删零引用导出 | ✅ | P2-6 / P0-7（knip） |
| B4 | 未完成项在代码留 TODO/FIXME/HACK 标识 | ✅ 立规：`// TODO(台账#编号): 说明`，写进《工具开发指南》与总纲 | P8-2 |
| B5 | 时间处理统一 + lint 禁 `toLocaleString('sv-SE')` | ✅（14 处替换 + ESLint 规则） | P0-3 |
| B6 | UploadProfile 双真相源彻底解决 | ✅ upload-core 零依赖类型子入口为真相源，shared 改 re-export | P0-5（P5-2 拆包收尾） |
| B7 | 抽 plain-core（keepFunctions 参数化），两处薄封装 | ✅ + N3 目录 `renderer/ipc-plain/` | P0-8 |
| B8 | useTablePage() + TableOpsColumn，11+ 表格页接入 | ✅ | P2-1~2 / P4 / P6-1 |
| B9 | 工具页 hint 统一改 FormHint（注意位置与四周留白） | ✅ | P2-3 / P4 / P6-2 |
| B10 | ui-kit 应零业务 | ✅ ShareDialog/share-ticket 迁出（落点见 C-4） | P5-3 |
| B11 | X4 tool-skeleton 迁出 shared | ✅（落点见 C-5） | P5-1 |
| B12 | T1~T6 按重构新想法重排 | 🔁 见 §五/§六（T3 不再"下沉工具"，改应用内 modules/file） | P3 / P4 |
| B13 | O1 统一 dev 判据 `__SSHK_DEV__` | ✅ | P0-1 |
| B14 | O2 registerIpc 600 行拆分 | ✅ | P3-1 |
| B15 | O3 knip 进 pnpm verify | ✅ | P0-7 |
| B16 | O4 classifyExpected 注册制 | ✅ | P0-4 |
| B17 | O5 env.d.ts 由 preload 推导 | ✅ | P0-5 |
| B18 | O6 services.ts 拆分改名 | ✅ | P3-2 |
| B19 | PaddleOCR 彻底移除，不再考虑本机命名 | ✅（D45 推翻标注） | P7-1 |
| B20 | A1 main/index.ts 拆 6 模块（按报告组织结构） | ✅ | P3-1 |
| B21 | A2 渲染层 pages/ 彻底规范化 | ✅（并入应用管理新结构） | P4 |
| B22 | A3 shared 包内聚 | ✅（=P10 拆领域包） | P0-5 / P5-2 |
| B23 | 删 developerMode 开关，只区分 dev/build | 🔁 **终审改判：不删，developerMode 保留**（CF-1；D52 推翻→D55；铁律原文不变） | P0-2（保留+收敛） |
| B24 | D-1 方案A：`__SSHK_DEV__` define 注入 + isSourceRepo 分离 | ✅ | P0-1 |
| B25 | D-3 isDev/devFeatures 注释分节 | ✅ **恢复执行**（CF-1 终审保留 developerMode） | P0-2 |
| B26 | D-4 判据概念分离命名 | ✅（随 D-1） | P0-1 |
| B27 | N1 工具 id 后缀不统一，命名合法即可 | ✅ 存量不改 + 指南立规 | P8-2 |
| B28 | N2 pages/ 只放真实页面 | ✅ | P4 / P6-7 |
| B29 | N3 plain 三文件合并改名 | ✅ | P0-8 |
| B30 | N4 main/fs.ts 改名 | ✅ 改 `main/modules/file/`（随架构） | P3-3 |
| B31 | N5 services.ts 改名 | ✅ | P3-2 |
| B32 | N6 工具 util 命名（禁 shared.ts） | ✅ | P6-7 |
| B33 | C3 时间 / C4 类型真相源全部规范化 | ✅ | P0-3 / P0-5 |
| B34 | F1 PaddleOCR 彻底删除 | ✅（=B19） | P7-1 |
| B35 | F2 .sshktool 没做完就写计划做完 | 🔁 **核查：主体已完成**，剩实测演练（§八） | P9-2 |
| B36 | F3~F7 功能遗漏补全 | 🔁 拆解：F3=F5=V7 待账号 ⏳；F4/F6/F7 先做「规划 vs 实现」专项核对再补 | P8-6 / P9-1 |
| B37 | 大文件拆分清单全部执行 | ✅ | P4（迁移时顺拆）/ P6 |
| B38 | T1 工具包目标目录规范写进《工具开发指南》 | ✅ | P8-2 |
| B39 | C1~C7 组件/布局规范全部落地 | ✅ | P2 / P4 / P6 |
| B40 | P1/P5/P7/P8/P10 全按推荐 | ✅（P5=C4 敲板分轨） | 各对应批 |

### 2.2 报告A（2026-11-20-独立全仓深度CodeReview报告）18 项

| A# | 敲板内容 | 结论 | 落点 |
|---|---|---|---|
| A1 | CR-01 conflict 被 success 覆盖 → 方案A | ✅ 抛专用信号（同 `__fs_paused__` 机制）+ 补 fs 状态机单测 | P1-1 |
| A2 | CR-02 密钥竞态 → 彻底方案 SecretsStore | ✅ 单一 SecretsStore 类收口 + Promise 串行 + 失败可见 | P1-2 |
| A3 | CR-03 dev 判据双源 → 采纳建议 | ✅（=O1/D-1） | P0-1 |
| A4 | CR-05 → 统一错误工厂，禁业务代码 new Error | ✅ 范围 apps+tools main（Q-15），含 preload 保留 code | P0-4 |
| A5 | CR-06 D18 残留 → 采纳 | ✅ 代码已清；余历史稿批注 | P8-3 |
| A6 | CR-07 字数口径 → 采纳 | ✅ 已改；余状态栏「已选 X 字」口径核对 | P8-3 |
| A7 | CR-08 → 验收步骤参数引用常量/类型 | ✅ verify-steps 改引 `TOOL_IDS`/常量拼接 | P8-4 |
| A8 | CR-11 edm 三死代码页 → 改合规、删 | ✅ 删（Q-09）；存活页合规随组件批 | P1-7 |
| A9 | §2.2 死代码/声明-使用 → 改 | ✅ knip + 僵尸常量 A 案 + CR-25 四组收敛 + CR-26 已修 | P0-7 |
| A10 | §2.3 重复代码/大文件 → 改 | ✅ | P2 / P6 |
| A11 | §2.4 健壮性 → 改 | ✅ Q-20 分批 | P1 |
| A12 | P-2 edm 死代码页删 | ✅ | P1-7 |
| A13 | P-3 保留 v6、删/归档 v5 | ✅ 已完成（批3 `f830be6` 归档） | — |
| A14 | P-4 99-archive 优化建议文档删除 | ⚠️ **冲突 CF-5**：99-archive「只移不删」铁律 → 建议保持归档 | 待 C 确认 |
| A15 | P-6 分享路由硬鉴权本轮纳入 | ✅（Q-13） | P1-5 |
| A16 | P-7 COS/七牛 Provider 写能力补齐 | 🔁 SDK 写能力已落地（CR-55 复核）；剩 V7 真实账号验证 ⏳ | P9-1 |
| A17 | P-8 CR-05 错误工厂 + CR-34 runWithToast 一并引入 | ✅ | P0-4 / P2-4 |
| A18 | P-9 preview 归入 dev | ⚠️ **冲突 CF-2**：与 O1 表达式表面相反，可统一（见 CF-2） | 待 C 确认 |

### 2.3 二次复核台账 + 交叉合并新增（Q-01~Q-23）

| Q# | 决策点 | 敲板结论 | 落点 |
|---|---|---|---|
| Q-01 | conflict 修复方案 | ✅ A（抛信号） | P1-1 |
| Q-02 | 密钥竞态 | ✅ ② SecretsStore | P1-2 |
| Q-03 | FsRuntime 下沉 | 📦 **被 D53 吸收改判**：不下沉工具包，改应用内 `main/modules/file/`（CF-3） | P3-3 |
| Q-04 | 三能力配置升层 | 📦 **被 D53 吸收**：三模块并入应用后配置天然可达；Provider/通道页落位见 §六 | P4 |
| Q-05 | dev 判据 | ✅ A | P0-1 |
| Q-06 | preview 归属 | ⚠️ → CF-2 / C-1 | P0-1 |
| Q-07 | 确认弹框 | ✅ 按 C4 敲板分轨：简单=ElMessageBox.confirm、复杂表单=ConfirmDialog（组件保留不删）；manifest name 统一中文、工具 id 存量不改 | P2-5 / P8-2 |
| Q-08 | ShareDialog 去留 | ✅ 迁出 ui-kit（落点 C-4） | P5-3 |
| Q-09 | edm 三死代码页 | ✅ 直接删 | P1-7 |
| Q-10 | EDM v5 归档 | ✅ 已执行（批3） | — |
| Q-11 | archive 优化建议文档 | ⚠️ → CF-5（建议保持归档） | 待确认 |
| Q-12 | build+developerMode 图标字段 | ✅ **恢复**：采纳报告A P-5 倾向（devFeatures 可改） | P0-2 |
| Q-13 | 分享硬鉴权 | ✅ 本轮纳入（webContents 绑定可信身份） | P1-5 |
| Q-14 | COS/七牛验证 | ✅ 方向确认；V7 需你提供真实账号 ⏳ | P9-1 |
| Q-15 | AppError 治理范围 | ✅ apps + tools main（裸 throw 121+66 处） | P0-4 |
| Q-16 | 8 僵尸常量 | ✅ A 案（硬编码点改 import 常量 + 门禁禁产物文件名字面量） | P0-7 |
| Q-17 | env 烤入契约 | ✅ 按细化默认执行（C-9） | P0-6 |
| Q-18 | 文档规整收尾 | ✅ 本轮清 | P8 |
| Q-19 | useSelection | 🔁 **删除→推广落地**（你的敲板，§七） | P2-1 |
| Q-20 | 健壮性批次 | ✅ 分批，更新竞态优先 | P1-3/4 |
| Q-21 | check-dialogs 补强 | ✅ 做 | P0-7 |
| Q-22 | share-hub 生命周期 | 📦 **被 D53 吸收**：分享管理=应用模块、服务=应用级常驻（autoStart 语义保留，文档说明） | P4-6 |
| Q-23 | shared 拆包 | ✅ A 两步走：先迁 tool-skeleton，领域数据随拆包批 | P5-1 / P5-2 |

### 2.4 重构新想法 1~8 → 架构定稿（D53）

| # | 新想法 | 结论 | 落点 |
|---|---|---|---|
| 1 | 应用/工具边界重划 | ✅ 定稿为 **D53**（§五.1 边界铁律） | P4 |
| 2 | 桌面结构/布局/交互/进出不变 | ✅ 桌面卡片只剩纯工具；应用管理为独立入口 | P4-1/2 |
| 3 | 顶栏改造 + 更多下拉三段 | ✅ 采纳，设计稿见 §五.3（样式细节 C-7） | P4-1 |
| 4 | 应用管理页面（左菜单+右内容） | ✅ 采纳，结构与 ASCII 见 §五.4 | P4-2 |
| 5 | 一级菜单 应用设置/文件管理/模型管理/分享管理 | ✅ 采纳，菜单表见 §五.5；迁移完成后删除应用设置侧滑与三工具包 | P4-3~6 / P4-8 |
| 6 | 以后工具=纯工具，单向依赖 | ✅ 立为边界铁律（§五.1） | P4 / P8-2 |
| 7 | 提取工具内跨能力配置 | ✅ 提取清单见 §六 | P4-3~6 |
| 8 | 代码/包结构是否重调（可弃兼容弃迁移） | ✅ 目标结构见 §五.6；配置键一次性迁移（C-3） | P3 / P4 / P5 |

---

## 三、冲突点清单（CF，需你终审）

> **✅ 终审结果（2026-11-21 用户逐项回复，登记 §十三）**：**CF-1 = 不删，developerMode 保留**（D52 已推翻 → D55；D-2/D-3/Q-12/CR-46 恢复执行，2026-11-14 铁律原文不变）；**CF-2 / C-1 = preview 归 dev**；CF-3 = 确认改判应用内 `main/modules/file/`；**CF-4 / C-2 = 保持归档**；CF-5 = 确认彻底移除 PaddleOCR；CF-6 = 随 developerMode 保留而恢复执行。下表保留原始冲突分析供追溯。

| # | 冲突 | 双方 | 影响与后果 | 处置建议 |
|---|---|---|---|---|
| **CF-1** | **删除 developerMode vs AGENTS.md「开发模式铁律」（最高优先级）** | 你的敲板 B23 vs 2026-11-14 铁律（`devFeatures = isDev \|\| cfg.developerMode`，developerMode 只作用于打包版） | 删除后**安装版永久失去所有开发者入口**：①创建工具（dev 恒显，不受影响）②工具全量列表/配置按钮（打包版永不可见）③devOnly 配置字段（打包版隐藏）④图标字段（Q-12 作废=仅 dev）⑤验证引导入口（打包版隐藏，与新想法#3"区分 dev 显示"一致）⑥EDM 系统内容编辑（打包版只读，无提权途径）⑦开发者模式开关及其口令通道（GeneralTab 行删除；DevTools 口令通道保留） | **按敲板执行**。铁律本体「dev 下全量展示全量可编辑」不变；P0-2 同步修订 AGENTS.md + 00-CONVENTIONS §5.1（新表述：门控唯一判据 `__SSHK_DEV__`，打包版不存在任何用户可配置功能开关）。**若你想保留"安装版口令开启开发者功能"能力，请在开工前改判** |
| **CF-2** | **preview 归属：O1 敲板表达式 vs 报告A P-9 倾向** | B13/O1「`__SSHK_DEV__` 值 = mode==='dev'」（preview 归 build） vs A18/P-9「倾向归入 dev」 | preview（`pnpm start`）下调试体验不同：归 dev=有 DevTools/更新桩/验证引导；归 build=贴近安装版行为 | 建议采纳 P-9：`__SSHK_DEV__ = mode==='dev' || mode==='preview'`（electron-vite preview 以 production mode 构建时，preview 专链显式传 `--mode preview` 或注入标记，实施时实测校准）。→ **C-1** |
| **CF-3** | **FsRuntime 下沉（Q-03 A）vs 三基础工具并入应用（新想法#4/#5）** | 台账拍板"整体下沉 tools/file-manager/src/main" vs 新架构中 file-manager 不再是工具 | 若仍执行"下沉工具"会在 P4 立即返工 | 改判：FsRuntime **不进出任何工具包**，在应用 main 内目录化 `main/modules/file/`（browser/transfer/archive/media/metadata），语义=应用内置文件能力；总纲 §1.3 归属判据补注「基础能力模块例外，属应用本体」。→ **C-2 附带确认** |
| **CF-4** | **P-4/A14 删除 99-archive 文档 vs 「只移不删」铁律** | 你的敲板（删除）vs 00-index 归档铁律 + 台账 Q-11 建议保持归档 | 删除违反铁律；文件已被 plans 吸收但仅是"建议池" | 建议改为**保持归档**（Q-11 原建议）；若你坚持删除即视为对该铁律的个案豁免，需在 00-index 显式登记。→ **C-2** |
| **CF-5** | **B19/F1 彻底移除 PaddleOCR vs D45/台账 #13（等用户本机命令）** | 你的敲板（移除） vs D45 可插拔识别源设计 + 待办"等用户提供本机命令" | 撤销等待项；删除宿主 `runLocalOcr` 能力、template-tool config-ocr、badge 本机 OCR 选项、shared OCR 类型 | 按敲板执行，D45 加"已推翻"标注，台账 #13/#109 相关行收口 → P7-1 |
| **CF-6** | **B25（D-3 注释分节）/Q-12/D-2 vs B23（删 developerMode）** | 三个敲板互相依赖 developerMode 概念 | developerMode 删除后 D-2 写法收敛、D-3 注释分节、Q-12 图标字段全部失去对象 | D-2/D-3/Q-12 **作废**，并入 P0-1/P0-2 的"判据唯一化"（只存 `__SSHK_DEV__` 与 `isSourceRepo` 两个概念） |

> 结论：**6 处冲突中 4 处（CF-3/5/6 + Q-22 类）由你的重构新想法自然消解**，真正需要你点头的只有 **CF-1（developerMode 后果确认）与 CF-2/C-1（preview 口径）+ CF-4/C-2（archive 删留）**。

---

## 四、待确认清单（C，逐项回复"编号+选择"即可；不回复则按建议默认执行）

> **✅ 终审结果（2026-11-21，登记 §十三）**：C-1=dev；C-2=保持归档；C-3=采纳（配置键一次性迁移）；C-4=采纳（`@sshk/share-core/ui`）；C-5=采纳（`scripts/tool-skeleton/`）；**C-6=应用设置 tab 与三工具菜单「结构原样下移一级」**（§五.5 v1.1 定稿）；C-7=方案一（语义色胶囊组）；**C-8=文件管理侧不保留传输设置入口**；**C-9=保持现有烤入机制，只修 bug 完善**（CR-20/47/E4/E5 修复 + CR-22 注释，机制与默认值不动）；C-10=采纳（`apps/desktop/src/shared/verify-steps.ts`）；**C-11=模块 id 沿用，但 model-console → `model-manager`**（原文"model-manger"按拼写惯例取 manager，如需原拼写请指出）。下表保留原始清单供追溯。

| # | 待确认 | 建议默认 | 影响面 |
|---|---|---|---|
| C-1 | preview（pnpm start）归 dev 还是 build | **归 dev**（`__SSHK_DEV__ = mode==='dev' \|\| mode==='preview'`，守 A18/P-9 敲板与"源码运行即开发态"精神） | P0-1 |
| C-2 | 99-archive 优化建议文档：保持归档 or 删除 | **保持归档**（守只移不删铁律；内容已被 plans 接管，档案仅留追溯） | P8 |
| C-3 | 三模块配置键是否一次性迁移 `tools.<id>.*` → `app.modules.<moduleId>.*` | **迁移**（禁双轨铁律；你已允许忽略数据迁移；moduleId 沿用原工具 id，见 C-11） | P4-8 |
| C-4 | ShareDialog(625)/share-ticket 迁出 ui-kit 的落点 | **`packages/share-core` 渲染子入口 `@sshk/share-core/ui`**（vue 作 peerDependency；工具与分享管理模块共同消费；避免包爆炸） | P5-3 |
| C-5 | tool-skeleton（350 行）迁出落点 | **`scripts/tool-skeleton/`**（dev:toolCreate 与向导预览改从此处引；不独立发包，减少发布形态） | P5-1 |
| C-6 | 应用设置二级菜单清单与顺序 | **常规 / 分享服务 / 文件与传输 / 系统与数据 / 工具与权限 / 关于**（§五.5；原 tabs 全保留+新增"文件与传输"，去掉开发者模式行） | P4-3 |
| C-7 | 顶栏彩色按钮样式方案 | **语义色胶囊组**（§五.3 方案一；备选=分段式 segmented） | P4-1 |
| C-8 | 传输/分片设置迁到应用设置后，文件管理侧是否保留快捷入口 | **保留只读跳转**（传输面板「传输设置…」改为跳应用设置>文件与传输） | P4-7 |
| C-9 | Q-17 env 契约三案细节 | **CR-20**：烤入键集合 = .env ∪ process.env(SSHK_*)；**CR-22**：注释改为实情（local/release 子进程默认放行）+ .env.example 提示生产显式设 1，不改默认值；**CR-47/E4/E5**：`SSHK_DEV_` 前缀加入烤入 denylist + 注释键名修正 | P0-6 |
| C-10 | verify-steps（68 条验证步骤数据）归宿 | **`apps/desktop/src/shared/verify-steps.ts`**（宿主专用，随 verify-sessions/VerifyGuidePage 同层；shared 回归纯契约） | P5-2 |
| C-11 | 三个内置模块 id 是否沿用原工具 id | **沿用** `file-manager / model-console / share-manager` 作为模块命名空间（分享归属显示、用量记账、verify-steps 引用零迁移） | P4 |

---

## 五、新架构定稿（重构新想法 → D53）

### 5.1 边界铁律（写入总纲 §1.3，随 P4/P8 落档）

1. **应用本体** = 桌面壳 + **应用管理**（应用设置 + 文件管理/模型管理/分享管理三模块）+ 平台能力（main：窗口/托盘/更新/密钥/local-res/快照/备份/运行时安装/诊断 + `main/modules/*`）。
2. **纯工具** = `tools/` 下自包含工具包（现有 edm-studio / badge-studio / template-tool；未来含外部 .sshktool），经 `createSafeHost` 单向消费应用能力；可禁用、可分发。
3. **依赖方向唯一**：工具 → 应用能力；**应用本体绝不 import 工具代码**（运行时 discovery 动态加载除外）。
4. 总纲 §1.3 归属判据补充：**≥2 消费者留 `packages/`；仅 1 消费者且属"纯工具"才下沉工具**；基础能力模块（文件/模型/分享）属应用本体，不参与"下沉工具"判定。

### 5.2 不变项

桌面布局、三态换肤、工具卡片进入/返回交互、F5/Ctrl+R 刷新协议、托盘、更新机制、全部 IPC 契约（`IpcResult`/`AppError`）、`localres://`、密钥体系（safeStorage + `app:upload:<pid>`）——**全部保持**。

### 5.3 桌面顶栏（右上角）改造

```
现状：  [主题▾select] [检查更新] [验证引导(dev)] [更多▾] [⚙设置]
目标：  [🎨主题▾] [🔄检查更新] [✅验证引导·dev] [⋯更多操作▾] [应用管理]
        └─彩色胶囊按钮组，图标+短文字，语义色──────────────┘ primary 实底锚点
```

- **方案一（✅ 终审确认，C-7）·语义色胶囊组**：高度 28px、圆角 6px、图标 14px + 12px 文字；底色用 EP 语义色 `color-*-light-9`、前景/边框 `color-*`，hover 加深一档；「应用管理」用 primary 实底胶囊（全组视觉锚点，最右）。色彩语义沿用总纲 §2.5：主题=purple、检查更新=success、验证引导=warning、更多操作=info、应用管理=primary。图标按 D50 优先 EP/FontAwesome（Brush、Refresh、CircleCheck、MoreFilled、Setting）。
- **方案二（备选）·分段式**：一个 rounded 容器内五段 icon 按钮 + active 底色，更紧凑但"应用管理"不突出。
- **更多操作下拉（三段）**：
  1. 刷新页面（F5 / Ctrl+R）· 强制刷新（Ctrl+F5）· 开发者工具 —— 照现保留；
  2. 创建工具（仅 dev）；
  3. 关于应用 → **轻弹框**：运行环境卡（版本+commit / Electron / Chrome / Node，复用 AboutTab 数据源 `window.api` runtime 信息）。
- 原「更多」里的 数据目录 / 工具与权限 / 系统与数据 **迁往应用管理对应页**（数据目录→系统与数据页按钮；其余为独立页）；原「⚙设置」按钮删除（被「应用管理」替代）。

### 5.4 应用管理页面（AppAdminPage）

```
┌─────────────────────────────────────────────────────────────────────┐
│ [← 返回桌面]  应用管理                                    [≡ 折叠]   │ 页头
├──────────────┬──────────────────────────────────────────────────────┤
│ 左侧菜单      │   右侧内容区（padding: var(--sshk-page-padding)）     │
│ （可折叠，     │                                                      │
│  复用         │  ┌ 页面标题 + 页面级操作 ─────────────────────────┐  │
│  SidebarMenu  │  │ ┌ 筛选栏（label+.f-item+查询/重置）──────────┐ │  │
│  递归渲染）    │  │ ├ 操作栏（居右紧凑）────────────────────────┤ │  │
│              │  │ ├ 表格（撑满 + EmptyState）─────────────────┤ │  │
│ ▾应用设置     │  │ └ 分页（total,sizes,prev,pager,next,jumper）┘ │  │
│  常规设置     │  └───────────────────────────────────────────────┘  │
│  系统与数据   │   （表单类页面：FormGrid + FormHint + 校验双层）      │
│  工具与权限   │                                                      │
│  关于应用     │                                                      │
│ ▾文件管理     │                                                      │
│  文件系统     │                                                      │
│  内容管理     │                                                      │
│  通道配置     │                                                      │
│  工具设置     │                                                      │
│ ▾模型管理     │                                                      │
│  模型配置     │                                                      │
│  对话调试     │                                                      │
│  用量统计     │                                                      │
│  工具配置     │                                                      │
│ ▾分享管理     │                                                      │
│  路由管理     │                                                      │
│  访问日志     │                                                      │
│  工具设置 ▾   │                                                      │
│  · 服务配置   │                                                      │
│  · 挂载管理   │                                                      │
│  · 代理管理   │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

- 路由：hash 路由 `#/app/<模块>/<页面>`（如 `#/app/files/explorer`）；`← 返回桌面` 与工具页返回协议一致。
- **菜单结构定稿（C-6 终审 + 二/三轮规整 2026-11-21）**：应用设置 tab 与三工具现有菜单**结构原样下移一级**为基线；二轮+三轮按你的调整执行：3 处更名（常规→常规设置、模型 Provider→模型配置、关于→关于应用）+ 2 处合并（传输参数并入文件管理工具设置【你授权】、应用设置分享页并入分享管理服务配置【实测同键双入口重合】）；三轮复核改判：**模型工具配置恢复独立页**（与文件管理「资产↔偏好」分页模式一致）；应用设置二级 6→4 页，**零新增页**（原计划新增的「文件与传输」取消）。详见 §五.5/§5.5a。
- 菜单驱动推荐：三模块各保留一份**模块描述文件**（复用 manifest 的 menus/configGroups 引擎与 SettingsPage 表单组件，实现「原样下移」零重写；仅数据文件，不构成对工具代码的依赖）。
- 传输面板：保持**全局悬浮**（不占菜单，任何页面可唤起）。

### 5.5 应用管理菜单结构表（v1.3：下移基线 + 二/三轮规整）

> 基线（C-6）：应用设置 tab 与三工具现有菜单**标签、层级、顺序沿用现状**，仅整体下移一级（tab/一级→二级、二级→三级）。**二轮（§十四 #1~5）**：2 更名 + 2 合并；**三轮（#6~7）**：关于→关于应用更名 + 模型工具配置恢复独立页。应用设置二级 6→4 页，**零新增页**。

| 一级 | 二级/三级 | 内容来源（现状） | 标记 |
|---|---|---|---|
| 应用设置 | 常规设置 | GeneralTab → 页面（主题/开机自启/托盘/自动更新/开发者模式/产物目录） | **更名**（原「常规」，二轮 #1）；开发者模式行保留（CF-1） |
| | 系统与数据 | SystemTab → 页面（更新/数据目录与日志/备份/配置预览/运行时工具包/回滚快照/诊断） | 原样 |
| | 工具与权限 | ToolsTab → 页面（启用/密钥权限/元数据覆盖） | 原样；仅剩纯工具 + 外部安装工具 |
| | 关于应用 | AboutTab → 页面（运行环境/配置分层约定） | **更名**（原「关于」，三轮 #6）；「更多>关于应用」轻弹框复用其数据 |
| 文件管理 | 文件系统 | 原「文件系统」（FileExplorerPage，迁移时拆 composables/组件） | 下移；全屏工作台，ToolPageLayout 豁免 |
| | 内容管理 | 原「内容管理」（ContentsPage + ContentEditorCore/Dialog） | 下移；editorMode 设置随迁 |
| | 通道配置 | 原「通道配置」（ProfilesPage + Cloud/RemoteProfileForm，迁移时抽 SecretField） | 下移；数据 `app.upload.*` 不动 |
| | 工具设置 | 原「工具设置」（content-editor 组）+ **新增「传输与分片」分组**（阈值/片大小/并发/超时，`app.fs.multipart.*`） | **合并**（二轮 #3 授权）；原「传输设置」面板入口删除（C-8） |
| 模型管理 | 模型配置 | 原「模型 Provider」（ProvidersPage：Provider CRUD/预设/连接测试） | **更名**（二轮 #4）；模块 id `model-manager`（C-11） |
| | 对话调试 | 原「对话调试」（ChatPage） | 下移；核实双布局（C2） |
| | 用量统计 | 原「用量统计」（UsagePage） | 下移 |
| | 工具配置 | 原「工具配置」（config-gateway 网关偏好：默认 Provider/超时/流式） | 下移；键迁 `app.modules.modelManager.*`；**三轮复核恢复独立页** |
| 分享管理 | 路由管理 | 原「路由管理」（RoutesPage） | 下移 |
| | 访问日志 | 原「访问日志」（LogsPage） | 下移 |
| | 工具设置 ▸ 服务配置 | 原 ServicePage（状态/启停/清路由/基础设置/日志容量）**+ 收编 ShareTab 全部内容**（状态卡/autoStart/基础设置 4 字段：端口/默认时长/分享 IP/允许目录） | **合并**（二轮 #5，实测同键双入口重合）；应用设置「分享」页取消，二轮 #2 改名随页面取消（可回退） |
| | 工具设置 ▸ 挂载管理 | 原「挂载管理」（MountsPage） | 三级 |
| | 工具设置 ▸ 代理管理 | 原「代理管理」（ProxiesPage） | 三级 |

#### 5.5a 合并与细拆规划（二轮结论 + 三轮复核改判）

| 处置 | 项 | 依据 |
|---|---|---|
| ✅ 合（已拍板） | 传输/分片参数 → 文件管理>工具设置「传输与分片」 | 二轮 #3 授权；参数语义属文件/传输能力域，FilePicker 本质是该能力的通用组件（同一份 `app.fs.multipart.*`，#139 已统一注入）；模块化后无「禁用不可达」问题；应用设置回归纯全局偏好 |
| ✅ 合（事实驱动） | 应用设置>分享 整页 → 分享管理>工具设置>服务配置 | **实测两页同键双入口大面积重合**：服务状态卡（含 autoStart）+ 基础设置 4 字段（端口/默认时长/分享 IP/允许目录）两处重复渲染，仅日志容量与启停/清空操作为服务页独有（`ShareTab.vue:111-171` / `ServicePage.vue:140-175`，ServicePage 头注释自述「与应用设置同键读写天然一致」）；双份表单是维护隐患 |
| ✂ 独立（三轮复核改判） | 模型配置（Provider 资产）↔ 工具配置（网关偏好） | 二轮曾建议合并，三轮复核**改判恢复独立页**：与文件管理「通道配置（资产）↔ 工具设置（偏好）」跨模块分页模式保持一致；Provider 管理（密钥/端点/连接测试）与使用偏好（默认用谁/超时/流式）心智不同；独立成本仅一个菜单项 |
| ✂ 保持独立 | 常规设置 / 系统与数据 / 工具与权限 / 关于应用 | 应用全局域：偏好 / 本体运维 / 纯工具治理 / 信息，与任何单一能力无关 |
| ✂ 保持独立 | 通道配置 ↔ 工具设置（文件管理） | 资产数据（Profile CRUD + 密钥）vs 偏好参数；混页会让 Profile 表单页过长 |
| ✂ 保持独立 | 对话调试 / 用量统计；路由 / 日志 / 挂载 / 代理 | 高频操作页与运营列表页，各自成页 |

> 可回退：分享页合并（事实驱动）若不认可，回复一句即回退为「下移基线 + 全部更名」结构（恢复应用设置分享页）。

### 5.6 目标代码结构（Q-23/P10/A3/A2 落地形态）

```
packages/
├── shared/            # 纯契约+裁决+机制：types / ipc-result / time / baked-env / trust /
│                      #   pkg-validate / tool-catalog / constants（领域数据全部迁出）
├── llm-gateway/       # 模型内核（不动）
├── upload-core/       # 上传内核 + 零依赖类型子入口 @sshk/upload-core/types
│                      #   （吸收 shared/upload-manager + upload-vendors，真相源）
├── share-core/        # 分享内核 + 渲染子入口 @sshk/share-core/ui（ShareDialog/share-ticket）
├── repository/ backup/ file-picker/ rich-text/ code-editor/   # 不动
├── export-core/       # 新：exportZip/exportSingleFile/文件名编码统一（T6，fflate 4 处直用收敛）
└── ui-kit/            # 纯通用（ShareDialog 迁出后审计；+useTablePage/TableOpsColumn/ListPageShell）

apps/desktop/src/main/
├── index.ts           # 只留生命周期编排 + whenReady 装配（~150 行）
├── window.ts / tray.ts / updater.ts / migrations.ts / compact.ts
├── ipc/               # registerIpc 目录化：config / dev / update / llm / share / upload /
│                      #   runtime / verify / snapshots / tools（fs 并入 modules/file 对应通道）
├── modules/           # 应用内置能力运行时
│   ├── file/          # 原 fs.ts 2047 行拆分：browser / transfer / archive / media / metadata
│   ├── llm/           # presets.ts + seedDefaultProviders（T4 归位）
│   └── share/         # share-hub.ts（生命周期保持宿主常驻，Q-22）
├── services.ts → secrets-store.ts + llm-service.ts（拆分改名，O6/N5 第一刀）
└── （其余平台文件不动：local-res / dev-tools / dev-access / runtime-installer / diagnostics / health / verify-sessions / media-stream / …）

apps/desktop/src/renderer/
├── App.vue            # 壳：顶栏（AppHeader 抽出）+ 三容器切换（桌面/应用管理/工具宿主）
├── pages/
│   ├── app-admin/
│   │   ├── AppAdminPage.vue          # 左菜单（折叠）+ 右内容 + hash 路由
│   │   ├── settings/  GeneralPage / SystemDataPage / ToolsPermissionPage / AboutPage  # 4 页（规整后；关于应用更名，分享页并入分享管理）
│   │   ├── files/     FileExplorerPage / ContentsPage / ProfilesPage  # 原页平移（C-6 下移原则）
│   │   ├── models/    ProvidersPage（模型配置）/ ChatPage / UsagePage / 工具配置页（模块描述+SettingsPage 引擎）  # model-manager（C-11）
│   │   └── share/     RoutesPage / LogsPage / ServicePage / MountsPage / ProxiesPage
│   └── verify-guide/VerifyGuidePage.vue          # 从 components/ 归位（A2）
├── components/        # 真组件+弹框（原 settings/tabs 拆为页面后，组件留此或随页面就近）
├── composables/       # useAppConfig / useUpdater / useNewToolScan / useRuntimeComponent …
└── ipc-plain/         # install.ts + to-plain.ts（N3；plain-core 抽公共）

tools/                  # 只剩纯工具
├── edm-studio/  badge-studio/  template-tool/
scripts/
└── tool-skeleton/      # 骨架生成迁出 shared（X4/Q-23 第一步）
```

### 5.7 被新架构吸收/作废的决策点（销账清单）

| 原决策点 | 处置 |
|---|---|
| Q-03 FsRuntime 下沉工具 | 改判：应用内 `main/modules/file/`（CF-3） |
| Q-04 三能力配置升层（设置中心加三分组） | 吸收：模块页即应用页，配置天然可达；无需再往设置塞三分组 |
| Q-22 / O8 / S2 share-hub 生命周期 | 吸收：分享管理=应用模块，服务=应用级常驻（autoStart 保留 + 文档说明） |
| S1「配置藏在可禁用工具」 | 吸收：三模块不可禁用（应用本体） |
| D-2 developerMode 写法收敛 | **恢复执行**（CF-1 终审保留 developerMode）：shared 纯函数 + 统一下发（P0-2） |
| D-3 isDev/devFeatures 注释分节 | **恢复执行**（B25 敲板；P0-2） |
| Q-12 build+developerMode 图标字段 | **恢复**：devFeatures 可改（报告A P-5 倾向采纳；P0-2） |
| CR-46 developerModeOn 不订阅变更 | **恢复执行**：订阅 config.onChanged 或复用 useAppConfig 同源（P0-2） |
| H3/M15/T1/T2（设置中心升层批次） | 并入 P4 模块化迁移 |
| B S2/P4 share-manager 禁用语义 | 吸收（不可禁用） |
| 台账 D-Q 三能力"配置入口"相关待办 | 以 §六 提取清单为准 |

---

## 六、配置提取清单（重构新想法 #7）

> 原则：**参数进应用设置、操作进模块页、工具业务配置留纯工具**（D32 口径延续）。

| # | 配置 | 现位置 | 配置键 | 新位置 | 说明 |
|---|---|---|---|---|---|
| 1 | 传输/分片参数（阈值/片大小/并发/超时） | 文件管理「更多▾→传输设置」面板 | `app.fs.multipart.*` | **文件管理 > 工具设置「传输与分片」分组**（二轮规整，#3 授权并入） | FilePicker 图片库同一份配置（#139 已统一注入）；「传输设置」面板入口删除（C-8）；应用设置零新增页 |
| 2 | 上传通道 Profile CRUD | file-manager 通道配置页 | `app.upload.*` + 密钥 `app:upload:<pid>` | **文件管理 > 通道配置（原页平移）** | 数据零迁移，仅 UI 归位为模块页 |
| 3 | 模型 Provider CRUD | model-console Provider 页 | `app.provider*`（密钥 safeStorage） | **模型管理 > 模型 Provider（原页平移）** | 模块 id model-manager（C-11） |
| 4 | 模型预设 + 播种 | main/presets.ts + seedDefaultProviders | `app.provider*` | **main/modules/llm/**（应用本体） | T4 对齐，宿主单一播种器 |
| 5 | 分享服务参数+状态（端口/autoPort/TTL/分享 IP/允许目录/autoStart/日志容量/启停） | 应用设置 ShareTab + share-manager ServicePage（**同键双入口**） | `app.shareHub.*` | **分享管理 > 工具设置 > 服务配置（唯一页，二轮规整并入）** | 两页实测重合（状态卡+基础设置 4 字段双渲染）；应用设置删分享页，#2 改名随页面取消（可回退） |
| 6 | 挂载/代理 | share-manager 工具设置子菜单 | 模块配置 | **分享管理 > 工具设置 ▸ 挂载管理/代理管理（下移为三级）** | 运营数据留模块 |
| 7 | 内容编辑器形态 | file-manager 工具设置 | `tools.file-manager.editorMode` | **文件管理 > 工具设置（原页平移）** | 键随 C-3 迁 `app.modules.fileManager.*` |
| 8 | 网关偏好（默认 Provider/超时/流式） | model-console 工具配置（3 字段） | `tools.model-console.*` | **模型管理 > 模型配置页「网关偏好」分组**（二轮规整并入，可回退） | 键随 C-3 迁 `app.modules.modelManager.*`；模块 id model-manager（C-11） |
| 9 | OCR 命令/超时 | template-tool config-ocr | `tools.template-tool.ocr.*` | **删除** | 随 PaddleOCR 移除（CF-5） |
| 10 | badge/edm/template 工具业务配置 | 各工具 manifest configGroups | `tools.<id>.*` | **不动** | 纯工具自留（D32 边界不变） |
| 11 | 常规项（主题/自启/托盘/更新/产物目录） | 设置抽屉 GeneralTab | `app.*` | **应用设置 > 常规** | 删开发者模式行 |
| 12 | 快照/备份/运行时工具/诊断 | 设置抽屉 SystemTab | `app.*` | **应用设置 > 系统与数据** | 原样迁移 |

---

## 七、useSelection 与「跨页 + 跨搜索多选」答复（B2/Q-19 改判）

**直接回答：是的——`packages/ui-kit/src/composables/useSelection.ts` 正是为这个需求建的能力。** 文件头注释自证：「跨页选择（需求 8）：全局 Set\<id\>；翻页与过滤不清空；失效 ID 由 prune 清理」。机制与你的描述逐条对应：

| 你的需求 | useSelection 现有实现 |
|---|---|
| 第一页选中，翻页保持 | 全局 `Set<id>`（`selected`），翻页不重置 |
| 搜索条件变化不清空 | 过滤只改当前页数据，Set 不动 |
| 返回第一页仍可见选中状态 | `has(id)` 驱动勾选态回显 |
| 手动取消才失效 | `toggle/unselectMany` |
| 删除/导入后失效项清理 | `prune(validIds)` |

**缺口与补齐方案**（P2-1）：
1. **表格接线约定**：el-table 需 `:row-key="row => row.id"` + 选择列 `reserve-selection`（Element Plus 原生支持数据变化时保留勾选），`@select/@select-all` 事件同步进 composable；表头全选/半选用 `isPageAllSelected/isPageIndeterminate`。此约定写进《UI 与页面规范》。
2. **批量操作单一真相**：批量删除/导出/发布等一律以 `selection.count + selected` 为准，不再读表格瞬时勾选。
3. **接入范围**：现有全部带勾选列/批量操作的表格页（edm MailsPage/ContentManagePage、badge PostersPage、share Routes/Mounts/Proxies/LogsPage、file ContentsPage，迁移后为应用管理对应页）全部接入；`useTablePage()` 内置 selection 选项，新页面零成本获得。
4. **失效清理时机**：删除/导入覆盖成功回调后调 `prune`（避免"幽灵计数"）。

---

## 八、F2（外部工具包运行时安装/卸载 .sshktool）现状核查

**结论：主体已完成，不是"没做完"。** 实测证据：
- `main/runtime-installer.ts`：`previewInstall / installPackage / listInstalled / uninstallPackage / readRenderer / loadRuntimeManifests / verifySignature` 全套 API + 单测；
- 信任链：`packages/shared/trust.ts` + `pkg-validate.ts`（签名验签、trustLevel、内置白名单 builtinIds）；
- 沙箱：`main/utility-host.ts` + `utility-protocol.ts`（utilityProcess 宿主，install record 含 sandbox 字段）；
- **UI 已入口化**：SystemTab「运行时工具包」区 = 预览（内置重名拦截）/ 安装（降级二次确认）/ 卸载 / 信任公钥导入·吊销。
- preload 通道：`runtime.install/uninstall/list/preview/keysList/keysImport/keysRevoke` 齐备。

**剩余收尾**（P9-2）：①真实 `.sshktool` 样例包全链路演练（打包→安装→桌面出现→运行→卸载→验签拒绝路径）；②外部工具在「应用管理」新结构下的展现口径确认（桌面卡片 + 工具与权限页管理）；③台账 #8/#35 阶段二销账。

---

## 九、实施总计划（P0~P9，每批独立可交付）

> **执行总原则（2026-11-21 用户指令·台账 #155）**：趁此次重构，**所有页面——新建与存量一视同仁——全部重构到位**：
> ① 尽量提前：公共组件库（P2）是最早批次前提，先于一切页面工作（P0~P2 → P3/P4 排布已满足）；新建页面从第一天起只用公共组件，不再产生任何"旧写法"页面。
> ② 优先复用公共组件：useTablePage / ListPageShell / TableOpsColumn / EmptyState / FormHint / FormGrid / SecretField / ConnectivityField / useAction().runWithToast / 弹框分轨（简单 ElMessageBox / 复杂 ConfirmDialog）/ 统一分页与留白 token；禁止散写 `.hint` span、手写空态、手写分页 CSS、散落 `catch{ElMessage.error}`。
> ③ **迁移即重构**：P4 每迁入一页必须直接落公共组件并按规范清单重写，**禁止原样搬运旧散写实现**（先搬家后补课的模式作废）。
> ④ 逐页验收清单 = 总纲 §2（表单/列表页/弹框/按钮语义配色/图标 D50）+《列表页筛选与操作栏规范》+《页面留白与间距规范》（P8-1 三合一后以《UI 与页面规范》为唯一清单）。
>
> 执行纪律（每批相同）：批前在台账登记 → 实施 → `pnpm verify` 全绿（13 门禁 + typecheck + lint + build + vitest）→ conventional commit → push main → `git log -1 --format='%h | %s'` 核验 message。规模：S≤半天 / M 1 天 / L 2~3 天 / XL 专项。

| 批 | 目标 | 内容 | 对应敲板 | 规模 |
|---|---|---|---|---|
| **P0-1** ✅ 已完成（`__SSHK_DEV__` 三端注入 + shared dev-flag.ts 单一真相源 + preview --mode preview 实测通过 + ESLint/verify-structure 双门禁） | dev 判据唯一化 | electron.vite.config 转 `defineConfig(({mode})=>…)`，注入 `__SSHK_DEV__`（**终审定值：`mode==='dev' \|\| mode==='preview'`，preview 归 dev**）三端；shared `declare const __SSHK_DEV__`；main 弃 `!app.isPackaged` 判 dev、拆 `isSourceRepo`（dev-tools/dev-access）；renderer 5 处 `import.meta.env.DEV` 全替换并加 lint 禁用；`pnpm start` 实测校准 | B13/B24/B26/A3/Q-05/C-1 | M |
| **P0-2** ✅ 已完成（isDevFeaturesEnabled 唯一口径 + catalog 下发 devFeatures + D-3 分节注释 + CR-46 订阅修复） | developerMode 保留 + 写法收敛 | **developerMode 不删（CF-1 终审，D55；AGENTS/铁律原文不变）**；D-2 写法收敛：shared 纯函数 `isDevFeaturesEnabled(isDev, developerMode)` + catalog 统一下发 `devFeatures`，替换 8 处 4 种写法并 lint 禁裸拼；D-3：ToolsTab isDev/devFeatures 注释分节；Q-12：图标字段改 `devFeatures`（build+developerMode 可改）；CR-46：developerModeOn 订阅 config.onChanged（或复用 useAppConfig 同源） | B25/D-2/D-3/Q-12/CR-46/CF-1 | M |
| **P0-3** ✅ 已完成（17 处 toLocale*/Date.parse 归零→shared time.ts；数字千分位改 Intl.NumberFormat；ESLint+verify-structure 双禁令） | 时间统一 | 14 处（toLocale\* 7 + Date.parse 7）替换 shared/time；ESLint `no-restricted-syntax` 禁 `toLocaleString/toLocaleTimeString/Date.parse`（白名单 time.ts） | B5/B33/R1/CR-32 | S |
| **P0-4** ✅ 已完成（222 处 throw/reject AppError 化 + classifyExpected 注册制 + useAction.runWithToast + ESLint main 层禁裸 throw） | 错误契约 | 统一错误工厂（`AppError(msg,'validation'\|'permission'\|'io')`），apps+tools main 裸 throw 187 处治理；`classifyExpected` 改 provider 注册制（upload-core 注册 errorClassifier）；preload 保留 code；ui-kit `useAction().runWithToast` | A4/A17/Q-15/B16 | L |
| **P0-5** ✅ 已完成（`@sshk/upload-core/types` 零依赖子入口=真相源入口 + window.api 类型由 preload typeof 推导（删 300 行手写镜像）+ preload 宽签名收紧 + invoke 泛型化） | 类型真相源 | `@sshk/upload-core/types` 零依赖子入口收编 UploadProfile/UploadTargetType/upload-vendors；shared/upload-manager 改 re-export（P5-2 拆包收尾）；env.d.ts 改由 preload `typeof api` 推导 + IPC_CHANNELS 泛型映射；`Promise<any>` 收紧 unknown | B6/B17/B22/B40-P10/O5 | M |
| **P0-6** ✅ 已完成（烤入键集合 .env ∪ process.env SSHK_*；SSHK_BUILD_/SSHK_DEV_ 前缀拒烤；CR-22 注释改实情；E4 注释键名修正） | env 烤入完善 | **机制保持（C-9 终审），只修 bug 补全**：CR-20 烤入键集合合并（.env ∪ process.env SSHK_*）；CR-47/E5 `SSHK_DEV_` 前缀入烤入 denylist（对齐契约）；E4 注释键名修正；CR-22 注释改实情（默认值不动） | Q-17/C-9 | S |
| **P0-7** ✅ 已完成（knip 入 verify（exports 审计按计划留 P2-6）；check-dialogs 补扫 ElMessageBox.confirm 双禁；CHANGELOG 结构校验；CR-23 A案接线 5 常量+删 3 无孪生僵尸+字面量门禁；CR-25 四组收敛（ID_PREFIX 删/logFront 上收 shared/configKey→toolConfigKey/verify-steps target 门禁）；CR-26 补导出；**P1-7 edm 三死页顺批删除**） | 门禁三件套 + 死代码 | knip 进 verify（与 check-env 并列）；check-dialogs 补扫 ElMessageBox.confirm 选项；CHANGELOG 结构校验；8 僵尸常量 A 案（硬编码点 import + 门禁禁产物文件名字面量）；CR-25 四组收敛（ID_PREFIX/logFront/configKey/verify-steps 工具 id） | B15/A9/Q-16/Q-21 | M |
| **P0-8** ✅ 已完成（plain/plain-core.ts keepFunctions 参数化唯一核心 + preload 薄封装 + renderer ipc-plain/{install,to-plain}） | plain 收敛 | 抽 `plain-core.ts`（keepFunctions 参数化）；renderer `ipc-plain/`（install.ts+to-plain.ts）；preload 薄封装 | B7/B29/N3 | S |
| **P1-1** ✅ 已完成（`__fs_conflict__:` 信号机制（upload/download/cross 三分支）+ FsTransferEngine 导出 + fs-engine.test.ts 状态机矩阵 5 测（conflict/pause/cancel/对照/下载）） | conflict 修复 | 冲突分支抛 `__fs_conflict__:` 信号，execute catch 识别置 conflict；补 FsRuntime 状态机单测（含 conflict/pause/cancel 矩阵） | A1/Q-01 | M |
| **P1-2** ✅ 已完成（secrets-store.ts 单一类：写队列串行 + 写前强制预载 + 快照拷贝 commit 语义 + 失败 logger.error 落盘；services 六写入口全部收口） | SecretsStore | 单一 SecretsStore 类：同步 cache 先行 + 写队列串行 + 失败 logger.error + 渲染层错误事件；三写入口收口 | A2/Q-02 | M |
| **P1-3** ✅ 已完成（checkForUpdates 互斥闸门手动+自动共用 / updateDownload 下载单路径幂等 / error 事件不覆盖 downloading 进度） | 更新竞态 | checkForUpdates 互斥闸门、下载单路径、catch 不覆盖 downloading | A11/Q-20 | S |
| **P1-4** ✅ 已完成（CR-39 分片闸门唤醒丢失根治+静默 return 终判补齐；CR-40 preload 7 订阅全部返回退订函数；CR-41 媒体 Map 终态 60s TTL 回收；CR-45 shareHubLogs 分页下推 NeDB skip/limit） | 其余健壮性 | CR-39 分片 gate 唤醒、CR-40 事件订阅统一返回退订函数、CR-41 媒体 Map 60s 自动移除、CR-45 shareHubLogs 游标分页 | A11/Q-20 | M |
| **P1-5** ✅ 已完成（ShareHubGuards 守卫注入：sender 绑定主窗口 webContents + create toolId 在册校验 + revoke/renew 废除 '*' 通配严格匹配；不传 toolId 保留分享管理台特权） | 分享硬鉴权 | share-hub 按 webContents 绑定可信 toolId，不信任渲染层参数 | A15/Q-13 | M |
| **P1-6** ✅ 已完成（CR-36 editorMode 旧键 app.content.editorMode 回落清 + DEFAULT_SETTINGS 清 content 段；CR-37 app.llm.health 持久化双轨清改内存态；CR-23 已随 P0-7） | 杂项修复 | CR-23 常量（若 P0-7 未含）、editorMode/app.llm.health 双轨清（CR-36/37）、edm 现存页面守卫复核 | A10/A11 | S |
| **P1-7** | 死代码页 | 删 edm Brands/Fragments/TemplatesPage 三死文件（Q-09） | A8/A12 | S |
| **P2-1** ✅ 已完成（ui-kit 增 useTablePage（分页/加载/草稿生效筛选/轮询/内置 useSelection）/ListPageShell（四 slot，CSS 上收 theme.css .lp-*）/TableOpsColumn（≤3+更多▾）；样板页 ProxiesPage 迁即重构接入验证，PostersPage 等留 P6-1 批量迁移） | 列表页抽象建库 | ui-kit 增 `useTablePage()`（分页状态+加载+错误+刷新+内置 useSelection 选项）、`ListPageShell.vue`（筛选/操作/表格/分页四 slot，CSS 上收 theme.css）、`TableOpsColumn`（≤3 按钮+更多下拉）；样板页接入验证（PostersPage 或 ContentsPage） | B8/B39/R4/CR-30/C5~C7 | L |
| **P2-2** ✅ 已完成（ListPagination 组件：layout 固定 total,sizes,prev,pager,next,jumper + 页尺寸变化回第一页；CSS 走 theme.css .el-pagination） | 分页规范内置 | layout 固定 + 中文 total + 分页 CSS 全部进 useTablePage/ListPageShell | B39-C5 | S |
| **P2-3** ✅ 已完成（.lp-*/f-item/f-label/op-row/mini-tag 全局化=散写样式废除登记；FormHint/EmptyState 规范注释锚点；四向留白随 .lp-* token 化） | hint/空态组件化 | FormHint/FormGrid 细化（四向留白自适应）；`.hint` span 样式废弃登记；EmptyState 三类空态规范 | B9/B39 | S |
| **P2-4** ✅ 已完成（SecretField=密码+查看回显+清除三件套、ConnectivityField=测试连接+结果、SIGN_URL_HINT 常量；迁移后供上传通道页共用） | 表单抽象 | `SecretField.vue` + `ConnectivityField.vue` + `SIGN_URL_HINT`（CloudProfileForm/RemoteProfileForm 收敛，迁移后用于上传通道页） | A10/CR-31 | S |
| **P2-5** ✅ 已完成（ConfirmDialog 头注释立分轨规范锚点：简单确认=ElMessageBox.confirm（check-dialogs 守双禁）、复杂表单确认=ConfirmDialog；细则随 P8-1《UI 与页面规范》） | 弹框分轨 | 简单确认=ElMessageBox.confirm（守卫齐备）；复杂表单确认=ConfirmDialog；规范入《UI 与页面规范》 | B40-P5/Q-07/C4 | S |
| **P2-6** ✅ 已完成（29 导出×全仓引用矩阵：useAction/logFront/OpsAction/SIGN_URL_HINT/useTablePage 类型=新库面（P4/P6 迁移即消费，保留）；logFront=工具文档化 API 保留；其余全部有消费） | ui-kit 导出审计 | 全导出×全仓引用矩阵，零引用删除/降 @internal（knip 结果交叉） | B3/U2 | S |
| **P3-1** ✅ 已完成（index.ts 1161→188 行：window/tray/catalog/migrations/compact/updater 六模块 + `ipc/` 目录 12 文件（context+config/app/tools/backup/runtime/update/llm/upload/fs/os/misc，各导出 registerXxxIpc(ctx)，IpcContext 按实际依赖裁剪）；electron-updater 收敛 updater.ts 唯一导入点（update-dev-fake 求值顺序内置）；FsRuntime 创建留 ipc/fs 经 setFsRuntime 回写 before-quit 落盘引用；check-ipc.mjs 原生递归扫描无需改；IPC 通道与 handler 行为零变化） | index.ts 拆分 | A1 六模块：window/tray/catalog/migrations/updater/compact + `ipc/` 目录（registerIpc 600 行拆 config/dev/update/llm/share/upload/runtime/verify/tools） | B14/B20/O2 | L |
| **P3-2** ✅ 已完成（LLM 域拆 `llm-service.ts`：readProviders/findProvider/listProviders/chatByProvider/listModelsByProvider 经 createLlmService 工厂装配，services.ts 组装进 host；secrets-store.ts 已在 P1-2 落位；services.ts 名字保留作装配入口=密钥/备份面/视觉直连/OCR，IPC 契约零变化） | services.ts 拆分改名 | 第一刀：`secrets-store.ts`（P1-2 产物）+ `llm-service.ts` + 其余按内容归位（O6/N5） | B18/B31 | M |
| **P3-3** ✅ 已完成（fs.ts 2064 行拆 `main/modules/file/` 六文件：transfer/browser/archive/media/metadata + runtime.ts 门面（FsCore 接口组合，FsRuntime 类名与对外行为不变）；顶层小函数按消费者归置（readMultipartSettings→metadata、readUploadCap/readSearchMaxPages→metadata 供 browser 消费）；旧 fs.ts 删除、importer（index/ipc/fs/ipc/context/fs-engine.test）全量更新；IPC 通道名与行为零变化） | fs.ts → modules/file | 2047 行拆 `modules/file/{browser,transfer,archive,media,metadata}`；IPC 通道名不变（渲染层零感知）；`fs:transfer:control` 等契约不动 | B12-T3/B30/CF-3/Q-03 | L |
| **P3-4** ✅ 已完成（presets.ts git mv → `main/modules/llm/`，index.ts/presets.test.ts import 随改；seedDefaultProviders 按 P3-1 批次落 migrations.ts） | presets 归位 | presets.ts + seedDefaultProviders → `modules/llm/` | B12-T4 | S |
| **P3-5** ✅ 已完成（share-hub.ts git mv → `main/modules/share/`；头注释补「生命周期=宿主常驻（Q-22 终审），分享管理=应用模块」；迁移文件相对 import 随路径修正） | share-hub 保持 | 生命周期宿主常驻不动；`modules/share/` 归置 + 文档说明（Q-22） | Q-22 | S |
| **P4-1** ✅ 已完成（`components/AppHeader.vue` 语义色胶囊组落地 §五.3 方案一：主题=紫胶囊（el-select 包壳）/检查更新=success（四态与进度遮罩原样迁移）/验证引导=warning/更多操作=info 三段 dropdown（删数据目录/工具与权限/系统与数据三迁项）/应用管理=primary 实底；`AboutDialog.vue` 轻弹框（runtime 四行 kv-line）；App.vue 583→423 行抽 `useUpdateBanner`/`useNewToolScan`/`useRuntimeComponent` 三 composable；theme.css 清 .app-settings-btn/.update-btn--progress） | 顶栏改版 + App.vue 瘦身 | 彩色胶囊按钮组（C-7）；更多下拉三段；关于应用轻弹框；App.vue 抽 `AppHeader.vue` + useUpdateBanner/useNewToolScan/useRuntimeComponent（CR-42 首刀） | 新想法#2/#3、CR-42 | M |
| **P4-2** ✅ 已完成（router 注册 `/app` redirect + `/app/:module/:page?`（passthrough 同模式）；`pages/app-admin/AppAdminPage.vue`：页头返回桌面/标题/折叠 + 左菜单复用 SidebarMenu（§五.5 v1.3 菜单树硬编码，shareconfig 三级）+ 右内容区按 module+page 分发；应用设置 4 页过渡直引 tab 组件（`pages/app-admin/settings/`，P4-3 再页化）；三模块过渡直引壳组件 FileManagerPage/ModelConsolePage/ShareManagerPage（provideToolId/onDelta 注入在壳内，fileconfig/modelconfig 走 ToolSettingsPage）；App.vue isAdminRoute 第三容器接入，顶栏「应用管理」胶囊 → `/app/settings/general`） | AppAdminPage 壳 | 页面骨架 + 左菜单（SidebarMenu 复用/折叠）+ hash 路由 `#/app/...` + 返回桌面协议 + 桌面入口按钮 | 新想法#4 | M |
| **P4-3** ✅ 已完成（4 页真页化原位重写 `pages/app-admin/settings/`：GeneralPage 五分组 FormGrid（外观/启动与托盘/更新/产物目录/开发者选项）+ 统一保存区、SystemDataPage 拆 `parts/` 六分区（更新/数据目录与备份/配置预设/运行时工具包/回滚快照/诊断）、ToolsPermissionPage、AboutPage（配置分层约定文案改应用管理口径）；迁即重构落 FormGrid/label-width=auto/FormHint detail/留白 token/语义色按钮，加载·保存·分轨确认流语义不变；删 GeneralTab/SystemTab/ToolsTab/AboutTab/ShareTab 五 tab + AppSettingsDrawer 抽屉，VerifyGuide settings 直达入口改页内 hash 路由 `/app/settings/*`（share → `/app/share/service`）；BadgeStylePreview 迁 `components/`（仅宿主 ToolSettingsPage 使用）；useAppConfig 清 share 残留字段；theme.css 清抽屉壳层/share-* 死类。分享页并入分享管理与「文件与传输」不新增按 P4-6/P4-4 执行） | 应用设置页化 | **4 页（规整后）**：GeneralPage（更名「常规设置」；开发者模式行保留）/SystemDataPage/ToolsPermissionPage/AboutPage（更名「关于应用」）；**分享页取消**（并入分享管理，P4-6）；**不再新增文件与传输页**（传输参数并入文件管理工具设置，P4-4）；菜单/表单推荐复用模块描述文件 + SettingsPage 引擎（§五.4）；删除 AppSettingsDrawer 侧滑；**迁即重构**：4 页按规范清单直接重写（FormGrid/FormHint/分轨确认/留白 token），禁原样搬运 | 新想法#5、C-6、二/三轮规整、#155、§六 | L |
| **P4-4** | 文件管理模块迁入 | **迁即重构**：FileExplorerPage 迁移时拆 composables（useFsNavigation/useFsSelection/useFsPreview/useFsTransfer…）+ 组件，列表/传输页直接落 useTablePage/ListPageShell/TableOpsColumn/useSelection（§七）+ EmptyState/FormHint；ContentsPage+编辑器、ProfilesPage（同步用 SecretField/ConnectivityField）同口径重写；菜单**原样下移**（文件系统/内容管理/通道配置/工具设置）；**工具设置页含「内容编辑器」+「传输与分片」两组**（传输参数迁入，原「传输设置」面板入口删除 C-8） | 新想法#5、C-6、二轮规整、#155、§六#2/#7、B37-F1 | XL |
| **P4-5** | 模型管理模块迁入 | **模块 id `model-manager`（C-11，原 model-console）**；模型配置页（ProvidersPage 更名）/ChatPage（核实双布局并随迁重构）/UsagePage/**工具配置页**（网关偏好 3 字段，模块描述 + SettingsPage 引擎渲染；三轮复核恢复独立页）；菜单原样下移+更名；**迁即重构**：四页按规范清单重写落公共组件 | §六#3/#8、C-11、二/三轮规整、#155 | M |
| **P4-6** | 分享管理模块迁入 | Routes/Logs + 工具设置▸Service/Mounts/Proxies（**二级变三级**，C-6）；**ServicePage 扩容为唯一分享服务页**：收编 ShareTab 全部内容（状态卡/autoStart/基础设置 4 字段/保存后重拉逻辑 #144）+ 既有启停/清路由/日志容量；应用设置分享页删除；**迁即重构**：四页按规范清单重写落 useTablePage/ListPageShell/TableOpsColumn 等公共组件 | §六#5/#6、C-6、二轮规整、#155 | M |
| **P4-7** | 传输面板全局化 | TransferPanel 挂 App 层（跨桌面/应用管理/工具宿主可用）；**不设任何传输设置入口**（C-8；参数在 文件管理>工具设置「传输与分片」）；FilePicker 联动回归 | §六#1 | M |
| **P4-8** | 三工具包退役 | 删 tools/{file-manager,model-console,share-manager}；discovery/catalog/BUILTIN 名单/内置判定收缩为纯工具；配置键一次性迁移 `app.modules.<moduleId>.*`（C-3；模块 id：file-manager / **model-manager**（原 model-console，C-11）/ share-manager）；verify-steps 相关条目改写指向应用管理页；工具与权限页适配；桌面卡片只剩纯工具 | 新想法#5/#6 | L |
| **P4-9** ✅ 已完成（git mv `components/VerifyGuidePage.vue` → `pages/verify-guide/VerifyGuidePage.vue`（§五.6 A2 归位）；App.vue import 随改；入口=顶栏验证引导胶囊不变，verify-sessions 数据结构不动） | VerifyGuidePage 归位 | pages/verify-guide/（A2）；入口=顶栏验证引导（仅 dev）；verify-sessions 数据结构不动 | B21/A2 | S |
| **P5-1** | tool-skeleton 迁出 | → `scripts/tool-skeleton/`（C-5）；shared 零运行时骨架代码；dev:toolCreate/向导预览接线 | B11/Q-23 | S |
| **P5-2** | shared 领域外迁收尾 | upload-manager/upload-vendors 完成 `@sshk/upload-core/types` 收编（P0-5 收尾）；verify-steps → `apps/desktop/src/shared/`（C-10）；shared 复审=纯契约+裁决+机制 | B22/A3/Q-23 | M |
| **P5-3** | ShareDialog 迁出 | → `@sshk/share-core/ui`（C-4）；share-ticket 同迁；ui-kit 复审零业务（B10 收口） | B10/Q-08 | M |
| **P5-4** | export-core | 新包：exportZip/exportSingleFile/文件名编码（toFileName 统一）；fflate 4 处直用收敛 | B12-T6 | M |
| **P6-1** | 纯工具列表页收尾 | 应用管理各页已在 P4 迁即重构完成；本批收尾**纯工具**存量列表页（edm 邮件管理/内容相关列表、badge 海报列表、template 示例页等）接 useTablePage/ListPageShell/TableOpsColumn + useSelection（§七） | B2/B8、#155 | M |
| **P6-2** | 纯工具组件规范收尾 | edm/badge/template 存量页补齐 FormHint/EmptyState/ToolPageLayout（应用管理页已在 P4 完成；ChatPage 双布局已在 P4-5 处理） | B9/B39-C1~C3、#155 | S |
| **P6-3** | FilePickerDialog 拆分 | 三 tab 拆组件 + useUploadPool/useDirPicker | B37-F3 | M |
| **P6-4** | ContentManagePage 拆分 | useContentTree/ContentEditors/useCssTabs/useContextMenu/SaveAsDialog | B37-F4 | M |
| **P6-5** | badge state.ts + edm ipc.ts 拆分 | stores 三分 + ipc 按域目录 | B37-F6/F7 | M |
| **P6-6** | share-core/index.ts 拆分 | server/routes/static/logs/state-file | B37-F8 | M |
| **P6-7** | 工具目录规范对齐 | edm 根平铺 6 组件收编 components/；pages/ 只留 *Page.vue；状态文件收敛 store.ts/域命名（禁 shared.ts）；TTL 口径终核（CR-33） | B28/B32/N2/N6 | M |
| **P6-8** | App.vue 终拆 | StatusBar/useRuntimeComponent 收尾；main.ts import 位置统一 | CR-42 | S |
| **P7-1** | PaddleOCR 全套删除 | 宿主 runLocalOcr IPC+能力声明、shared OCR 类型、template config-ocr 组、badge「本机 OCR」选项与适配器引用；D45 推翻标注；台账 #13/#109 收口 | B19/B34/CF-5 | M |
| **P7-2** | useSelection 终态 | 推广完成后从"待决策"销账；无死代码残留 | B2 | — |
| **P8-1** | UI 规范三合一 | plans/01 + 页面留白与间距规范 + 列表页筛选与操作栏规范 → 《UI 与页面规范》；含 useTablePage 接线约定、分页规范、弹框分轨、EmptyState 三态、ToolPageLayout 豁免条款 | B39/域9#79 | M |
| **P8-2** | 指南与总纲 | 《工具开发指南》：T1 目标目录 + 纯渲染形态 + id 命名规则 + TODO(台账#编号) 标记约定 + 应用能力消费说明（新边界）；00-CONVENTIONS §1.3 补基础能力模块例外 + §5.6 一致性口径同步 | B4/B27/B38/新想法#6 | M |
| **P8-3** | 口径与旧称清理 | D18 历史稿批注（选型稿/数据契约/台账）；CR-57 旧称批量替换；SECRET_MIGRATION 文案终扫；字数状态栏口径核对 | B1/A5/A6/CR-57 | S |
| **P8-4** | 验收步骤常量化 | verify-steps 参数名改引用 TOOL_IDS/常量拼接（CR-08 彻底方案） | A7 | S |
| **P8-5** | 00-index/README 同步 | 本总计划 + D52~D54 登记；codereview 目录规范入索引；03-design 占位处置；verify-sessions JSON 登记 | Q-18 | S |
| **P8-6** | 规划 vs 实现专项核对 | plans/04/05 差量（F4 诊断/F6 健康面板/F7 快照入口/X2 注册表/X3 分类治理）逐条核对，结果回写遗留总账 | B36 | M |
| **P8-7** | 台账分卷 | 2026Q4 卷归档（可选，体积触发时执行） | B40 | S |
| **P9-1** | V7 云链路验证 | COS/七牛/ OSS/S3 真实账号上传下载分片续传（⏳ 需你提供账号） | A16/Q-14 | ⏳ |
| **P9-2** | F2 实测演练 | .sshktool 全链路（§八） | B35 | S |
| **P9-3** | 全量回归 | pnpm verify + pnpm dist 安装包实测（安装/更新/三模块/纯工具/FilePicker/分享/传输） | 全部 | M |
| **P9-4** | 收尾销账 | 遗留总账/EDM 验证清单/台账 #151 批次勾选 | — | S |

**建议开工顺序**：P0 全部 → P1 → P2 → P3 → P4（XL 核心）→ P5 → P6 → P7 → P8 → P9。P0-2 与 P0-1 同批提交（判据互依）；P4 期间 P1~P3 产物保持契约不变，渲染层零感知。

---

## 十、codereview 文档独立目录规范（本次已执行）

- 新目录：**`docs/06-codereview/`** —— 后续所有 CodeReview 报告、复核台账、交叉合并、处置/敲板计划**唯一存放地**；命名沿用一次性规范 `YYYY-MM-DD-主题.md`。
- 本次迁入（git mv，历史可追溯）：
  1. `2026-11-20-全仓CodeReview与重构建议.md`（报告B）
  2. `2026-11-20-独立全仓深度CodeReview报告.md`（报告A）
  3. `2026-11-20-CodeReview二次复核与处置台账.md`（台账 v1.1）
  4. `2026-11-21-CodeReview交叉合并与处置总计划.md`
  5. 本文（敲板裁决与重构实施总计划，决策入口）
- 同步更新引用：AGENTS.md、00-CONVENTIONS.md §0.3/§1.4、00-index.md 文档清单与目录树；四份文档互引路径已改写。
- 台账 #149/#150 等历史行中的旧路径**不改写**（历史记录原则），以本节为迁移凭证。

---

## 十一、风险与回滚口径

| 风险 | 缓解 |
|---|---|
| P0-2 删 developerMode 改动面广（约 10 处门控） | 独立批次 + 全量 grep `developerMode` 归零验收 + AGENTS/CONVENTIONS 同批修订 |
| P3/P4 大手术期 IPC 行为漂移 | P3 严格"只动文件组织不动契约"；P4 分模块小批迁移，每批 verify + 手测该模块 |
| `__SSHK_DEV__` 注入遗漏某端 | define 三端各加冒烟断言（dev 值日志）+ verify-structure 增检查 |
| 配置键迁移（C-3）丢用户本地配置 | 你已接受忽略数据迁移；实施批内提供一次性打印旧→新键对照说明（不写迁移代码） |
| 三工具包退役影响 verify-steps/内置名单 | P4-8 内逐项清单化（discovery/catalog/BUILTIN/trust builtinIds/verify-steps/工具与权限页/桌面卡片） |
| 长周期多批并发改稿冲突 | 单线推进，批间 push；并发期路径限定提交（铁律 5.5） |

---

## 十二、登记与执行

- 台账 #151 已登记本总计划；00-index 新增 **D52**（dev/build 二态，developerMode 删除）、**D53**（应用/工具边界重划 + 应用管理架构）、**D54**（codereview 独立目录）。
- **开工条件：已满足**（2026-11-21 终审，§十三）→ 待你回复「开工」即从 P0-1 起按 §九 顺序执行，每批可中断、可插队（P1 各项彼此独立）。
- 本文档为唯一实施排期来源；执行中的增量决策一律登记台账并回写本文对应批次行。

---

## 十三、终审记录（2026-11-21，用户逐项回复）

| # | 用户回复 | 落定 |
|---|---|---|
| 1 | CF-1：不删了，保留 | **developerMode 开关保留**（D52 推翻 → **D55**）；2026-11-14 铁律原文不变；D-2 写法收敛 / D-3 注释分节 / Q-12 图标字段 devFeatures 可改 / CR-46 订阅修复 恢复执行（P0-2） |
| 2 | CF-2：归 dev | preview 归 dev（=C-1） |
| 3 | CF-4：仅归档即可 | 99-archive 优化建议文档保持归档，不删除（Q-11 维持；P8 无删除动作） |
| 4 | C-1：dev | `__SSHK_DEV__ = mode==='dev' \|\| mode==='preview'`（P0-1 定值） |
| 5 | C-6：应用设置 tab 作为二级菜单全变页面；三工具一级菜单下移为二级、二级变三级以此类推 | §五.4/§五.5 定稿：**结构原样下移一级**，标签层级沿用现状；唯一新增页 = 应用设置 > 文件与传输 |
| 6 | C-8：不保留 | 文件管理侧移除传输设置入口，参数只在 应用设置 > 文件与传输（P4-4/P4-7） |
| 7 | C-9：保持现有烤入逻辑，只是完善修 bug | P0-6 改为完善批：CR-20（烤入集合合并）/CR-47+E5（SSHK_DEV_ 入 denylist）/E4（注释键名）修 bug + CR-22 注释改实情；机制与默认值不动 |
| 8 | C-11：model-console 改为 model-manager | 模块 id 定 `model-manager`（原文"model-manger"按拼写惯例取 manager，如需原拼写请指出）；配置键/TOOL_IDS/verify-steps 同步（P4-5/P4-8） |
| 9 | C-1~11 其余全部采纳建议 | C-3 配置键一次性迁移 / C-4 `@sshk/share-core/ui` / C-5 `scripts/tool-skeleton/` / C-10 `apps/desktop/src/shared/verify-steps.ts` 全采纳 |
| 10 | 顶栏方案一 | 语义色胶囊组（§五.3，P4-1） |

> 决策看板同步：D52 加「已推翻」标注指向 D55；D53 细化（菜单下移 + module id）；本记录登记台账 #152。

---

## 十四、菜单规整二/三轮（2026-11-21，用户 5+2 点调整 + 合并/细拆规划）

> 背景：C-6 定稿后用户对菜单先后提出 5+2 点调整，并要求规划「哪些合在一起、哪些需要细拆」。结论见 §五.5/§5.5a；总计划升 v1.3。

| # | 用户调整 | 落定 |
|---|---|---|
| 1 | 常规 → **常规设置** | ✅ 更名（P4-3） |
| 2 | 分享 → 分享服务 | ⚠️ **随 #5 合并被取消**：应用设置不再有分享页；若想保留应用侧入口请回复（届时按「分享服务」名保留，字段仍同键读写） |
| 3 | 文件与传输的设置能否并入文件管理>工具设置 | ✅ **可以并（已拍板）**：工具设置页新增「传输与分片」分组（阈值/片大小/并发/超时）；应用设置零新增页；「传输设置」面板入口删除（C-8）；FilePicker 共用同一份 `app.fs.multipart.*`（规范文档写明参数位置） |
| 4 | 模型 Provider → **模型配置** | ✅ 更名（P4-5） |
| 5 | 应用的分享设置与服务配置是否重合 | **重合（实测）**：ShareTab 与 ServicePage 为同键双入口——服务状态卡（含 autoStart）+ 基础设置 4 字段两处重复渲染，仅日志容量与启停/清空操作为服务页独有；**整页并入 分享管理>工具设置>服务配置**，应用设置删分享页（可回退） |

> 登记台账 #153/#154；00-index 变更记录 v1.8/v1.9。

**三轮补充（2026-11-21）**：

| # | 用户调整 | 落定 |
|---|---|---|
| 6 | 关于 → **关于应用** | ✅ 更名（P4-3；与「更多>关于应用」轻弹框同名同源，一致性更好） |
| 7 | 模型管理：模型配置配的是 Provider、工具配置是其他参数——二轮把它合并进模型配置页是否合适？ | **改判：不合适，加回来**。依据：①与文件管理「通道配置（资产）↔ 工具设置（偏好）」跨模块分页模式保持一致；②Provider 管理（密钥/端点/连接测试）与使用偏好（默认用谁/超时/流式）心智不同；③独立成本仅一个菜单项。模型管理终版 = 模型配置 / 对话调试 / 用量统计 / 工具配置 4 页（下移+更名基线完全照搬） |
