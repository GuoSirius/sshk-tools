# CodeReview 交叉合并与处置总计划（2026-11-21）

- 状态：**交叉比对 + 代码复核完成**。无争议待执行清单见 §五.2（待用户一声令下即执行）；决策入口仍是台账 §六 Q-01~Q-21 + **本报告新增 Q-22/Q-23**。
- 版本：v1.0
- 日期：2026-11-21（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`（分支 `main`）
- 输入（三份）：
  - **报告A** = `2026-11-20-独立全仓深度CodeReview报告.md`（CR 系列，台账 #148）
  - **报告B** = `2026-11-20-全仓CodeReview与重构建议.md`（E/U/R/O/T/N/G/S/B/F/C/X/H/M/P 系列，台账 #147）
  - **台账** = `2026-11-20-CodeReview二次复核与处置台账.md`（v1.1，含三次核对 §八 Z1~Z7）
- 本文目标：①两报告交叉合并、去重、互补评价；②台账正确性结论；③报告B明细逐条回源码补验（台账此前对报告B明细是泛引，这是唯一遗留缺口）；④查漏补缺；⑤给出合并后的统一处置总计划。
- 已直接修复部分（批1 `4e879fb` / 批2 `3a0acf5` / 批3 `f830be6`+`ea0230f`）不在本文重复展开，仅在总表中标注状态。

---

## 〇、三份文档正确性结论（先看）

| 文档 | 结论 | 依据 |
|---|---|---|
| **台账 v1.1** | **总体准确，是当前唯一可信处置基线**。v1.0 曾有 7 处偏差（Z1~Z7：CR-54"已归档"误判、D-2 local-res 前提失实、守卫清点 8→10、CR-06 未收尾、报告B横幅失实、进度漏勾、内部断链），已全部修正落档 | 台账 §八 + 批3 提交 `f830be6`/`ea0230f`；本次再抽查报告B独有条目（§三.1）全部属实 |
| **报告A** | 主体扎实：正确性缺陷（conflict/竞态/泄漏）与契约细节（env 烤入/TLS/时间）贡献最大，🔴 级全部回源码验证可信。**缺陷**：①CR-12~19、CR-27~29 编号空洞（grep 实测 0 命中，但标题称"CR-01~60"，易误导为 60 条全存在）；②4 处判定失实（CR-21 自锁已存在、CR-04"39 IPC"夸大、CR-40"onUnmounted 仅 1 处"、CR-60"FormHint 工具 0 使用"）；③漏报 B 的类型双真相源/门禁工具化/宿主渲染层结构类问题 | 台账 §三 + 本次 grep 复核 |
| **报告B** | 架构面贡献大：三能力配置入口、UploadProfile 类型双真相源、knip 门禁、宿主渲染层 pages/、文档合并策略均为 A 未覆盖的真问题。**缺陷**：①E1 判断方向错误（D18 变量已删，"补登记"错，C1 已裁 A 对）；②R5/R6 失实；③**L1~L12 空洞引用**——摘要称"低危 12 项 L1~L12"，全文 0 处定义（grep 实测）；④横幅"G1~G5 已顺手修复"失实（Z3）；⑤§11.1"分享配置在工具里"已过时（ShareTab.vue 已在应用设置，实测存在） | 台账 §四/§八 + 本次复核 |
| **两报告共同盲区** | 危险操作守卫缺失 10 处、`check-dialogs.mjs` 门禁盲区、EDM v5 实际未归档、local-res 消费者误判——均由三次核对（批2/3）补上 | 台账 §八 Z1~Z5 |

**互补性总结**：A 强在"运行时正确性 + 契约一致性 + 验证纪律"，B 强在"类型真相源 + 导出面治理 + 门禁工具化 + 组织结构"。两报告对同一事实的 7 处结论冲突（台账 §四 C1~C7）中：C1 裁 A 对（E1 误报）、C2 不冲突（v6 权威一致）、C3 判据不同（数据层 vs 入口层，Q-04 裁）、C4/C5/C6 直接相反（Q-07/Q-06/Q-08 裁）、C7 部分重叠（Q-07 裁）。

---

## 一、交叉比对方法

1. **去重**：以"同一底层事实"为单位合并（如 A CR-03 = B O1/D-1 = H1 同一 dev 判据双源问题），保留信息量最大的表述与全部证据。
2. **回源码补验**：台账 v1.1 已核验报告A全部条目；本次对**报告B独有条目**逐条回源码（§三.1），补上台账泛引的缺口。
3. **查漏**：三方（A/B/台账）都没提的问题以"核"标注（本轮新增）。
4. **状态口径**：`✅已修（批1~3）` / `📋待拍板（Q-xx）` / `▶无争议待执行`（方向唯一、不涉产品意图，见 §五.2）/ `⏳待用户输入` / `❌撤销`。

---

## 二、交叉合并总表（去重后，按 9 域组织）

### 域1 · 正确性与竞态

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 1 | 传输 conflict 被 success 覆盖（覆盖确认失效） | A CR-01；**B 漏** | 📋 | Q-01 |
| 2 | 密钥写竞态 + fire-and-forget | A CR-02；**B 漏** | 📋 | Q-02 |
| 3 | contentSave status 无白名单 | A CR-43；B 漏 | ✅批1 | — |
| 4 | App.vue 重复挂载 CreateToolWizard | A CR-09 | ✅批1 | — |
| 5 | 自动更新并发竞态（单例并发/双下载路径/error 覆盖） | A CR-38；B 漏 | 📋 | Q-20 |
| 6 | 分片 gate 唤醒丢失（取消/暂停饥饿） | A CR-39；B 漏 | 📋 | Q-20 |
| 7 | 事件订阅无退订（范围收窄到事件订阅） | A CR-40；B 漏 | ⚠️ | Q-20 |
| 8 | 媒体会话 Map 只增不减 | A CR-41；B 漏 | 📋 | Q-20 |
| 9 | shareHubLogs 全表加载后 slice | A CR-45；B 漏 | 📋 | Q-20 |
| 10 | 危险操作缺禁遮罩/禁ESC 共 10 处 | **A/B 均漏**（三次核对） | ✅批2/3 + 📋Q-21（门禁防回潮） | Q-21 |

### 域2 · 判据与契约统一

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 11 | dev 判据双源（`!app.isPackaged` vs `import.meta.env.DEV`） | A CR-03 = B O1/D-1/H1 | 📋 | Q-05 + Q-06 |
| 12 | developerMode 判断写法 8 处 4 种（收敛为纯函数/统一下发 + isDev/devFeatures 注释分节） | B D-2/D-3 ≈ A CR-48 部分 | ▶ | §五.2 |
| 13 | AppError 铁律违背（apps main 121 + tools main 66 处裸 throw） | A CR-05；B 无独立条（仅 O4） | 📋 | Q-15 |
| 14 | classifyExpected 改 provider 注册制（云 SDK 知识出宿主） | B O4；A 未提注册制 | ▶归 Q-15 同批 | Q-15 |
| 15 | CI 纯环境变量烤入丢失 | A CR-20；B 漏 | 📋 | Q-17 |
| 16 | TLS 校验默认放行与注释矛盾 | A CR-22；B 漏 | 📋 | Q-17 |
| 17 | `SSHK_DEV_*` 违约烤入 + E4 注释键名拼写 | A CR-47/E5/E4；B 漏 | 📋 | Q-17 |
| 18 | 时间口径 14 处绕过 shared/time（实测 toLocale 7 + Date.parse 7） | A CR-32 = B R1/H4（A 计 12+ 更准，B 计 5 处偏少） | ▶ | §五.2（M4 批） |
| 19 | **UploadProfile 类型双真相源**（UploadTargetType 在 `upload-core/types.ts:9` 与 `shared/upload-manager.ts:10` 双定义；shared 侧为 UploadProfileOption 映射） | **B R2/H5；A 漏** | ✅本次实测属实 | §五.2 |
| 20 | 字数口径矛盾 | A CR-07；B 漏 | ✅批1 | — |
| 21 | `?ak=` 参数残留 | A CR-08；B 漏 | ✅批1 | — |
| 22 | D18 env 残留（constants/backup 注释/README/00-index） | A CR-06；B E1 方向错（C1 已裁） | ✅批1/3；⏳历史稿批注 | Q-18 |
| 23 | env.d.ts 手写 window.api 类型 336 行与 preload 双维护 | **B O5/D6；A 漏** | ✅实测恰 336 行 | §五.2（M6 批） |
| 24 | preload `Promise<any>`/`any[]` 收紧 unknown、monaco `@ts-ignore` 改 expect-error | A 💭P2 | ▶ | §五.2 |

### 域3 · 结构性归属（升降级 / 包组织）

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 25 | FsRuntime（2047 行 / 30 通道）下沉 file-manager | A CR-04 = B T3/X3/S4/B1/H2 | 📋 | Q-03 |
| 26 | local-res 归属：**三次核对改判保持应用层**（≥4 消费者：file-manager + rich-text + file-picker + edm） | B T5 → 台账 D-2（Z2 修正） | ✅已结 | — |
| 27 | 三能力配置入口升层（模型/上传；分享已就位） | B S1/T1/T2/H3 vs A 专题A"无需上提" | 冲突 C3：数据对、入口错 | Q-04 |
| 28 | 分享配置入口 | B §11.1 称"在工具里" | ⚠️**已过时**：ShareTab.vue 已在应用设置（实测存在），是正面范例 | 无需动作 |
| 29 | **share-hub 禁用 share-manager 后服务照跑**（autoStart 默认开，`share-hub.ts:209` 实测） | **B O8/S2/P4；A 漏；台账漏收 P4** | 🆕 | **Q-22（新增）** |
| 30 | presets/播种逻辑归属（D47 对齐） | B T4/D7/S5/M10；A 漏 | 📋归 Q-04 一并 | Q-04 |
| 31 | ShareDialog(625)/share-ticket 迁出 ui-kit？ | A C.3 保持 vs B X1/X2/S3/M3 | 冲突 C6 直接相反 | Q-08 |
| 32 | tool-skeleton.ts（350 行骨架生成）打进 shared | **B X4；A 仅 P2 提"杂物包"** | ✅实测 350 行 | Q-23（新增）关联 |
| 33 | **shared 领域数据外迁拆包**（upload-manager/upload-vendors/verify-steps 等迁领域包，shared 回归纯契约） | **B A3/M13/P10；台账漏收 P10** | 🆕 | **Q-23（新增）** |
| 34 | `app.llm.health` 单工具缓存写应用级命名空间 | A CR-36；B 漏 | 📋归 Q-04 关联 | Q-04 |
| 35 | `app.content.editorMode` 双轨清除（DEFAULT_SETTINGS + 回落读旧键 + plans/11 旧键） | A CR-37；B 同向（plans/11 批注） | 📋归 Q-04/M8 | Q-18 |
| 36 | fflate zipSync 工具侧 3~4 处直用（badge/edm/file-manager）→ 抽 export-core | **B T6；A 漏** | ✅实测属实 | §五.2 |
| 37 | 复用归属判据（≥2 留应用层/1 下沉/ui-kit 零业务） | 台账 §五.3 → 总纲 §1.3 已立法 | ✅已落档 | — |

### 域4 · 重复代码与抽象

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 38 | 列表页「筛选+分页+空态+操作栏」11+ 页重复 → useTablePage + ListPageShell + TableOpsColumn | A CR-30 = B R4/C6/C7/M12 | ▶ | §五.2（M4 批） |
| 39 | CloudProfileForm/RemoteProfileForm 大段重复 → SecretField/ConnectivityField | A CR-31 | ▶ | §五.2 |
| 40 | 分享逻辑散落 5 处、TTL 口径分裂 → 收敛 share-core | A CR-33；B 漏 | ▶ | §五.2 |
| 41 | 错误提示样板 10+ 页 → useAction().runWithToast | A CR-34 = B C4 相关联 | ▶ | §五.2 |
| 42 | ToolPageLayout 覆盖不均（file-manager/share-manager 自建三段式；ChatPage 疑似双布局需核实） | A CR-35 = B C2/M8/D8 | ▶ | §五.2 |
| 43 | EmptyState 覆盖不均（9 页未用） | B C3；A 💭 | ▶ | §五.2 |
| 44 | FormHint 推广（⚠️论据修正：file-manager/share-manager 6 文件已用；badge/edm/template/model-console 用 `.hint` span） | B C1/M6（R5 失实） | ▶ | §五.2 |
| 45 | useSelection 零使用 | A CR-24 = B U1/M2 | 📋 | Q-19 |
| 46 | CR-25 四组重复定义（ID_PREFIX 双份✅ / logFront 4 份✅ / configKey 2 份✅ / verify-steps 工具 id 字面量 100+） | A 独有 | ✅前三组实测确认 | §五.2 |
| 47 | 脱壳算法双份（renderer/plain.ts 34 行 + preload/plain.ts 46 行，语义有别）→ 可抽 plain-core | **B R3；A 漏** | ✅实测属实 | §五.2 |
| 48 | ui-kit 导出审计（导出面 > 消费面） | B U2 | ▶ | §五.2 |
| 49 | composable 文件名 camelCase | A CR-50 | ✅故意设计已入总纲 §3 | — |
| 50 | 分页 layout/total 文案统一（随 useTablePage 内置） | B C5 | ▶ | §五.2 |

### 域5 · 大文件与目录组织

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 51 | 大文件 Top15（FileExplorerPage 3039 / fs.ts 2047 / FilePickerDialog 1549 / ContentManagePage 1484 / index.ts 1131 / badge state.ts 1088） | A 专题C = B §十五 F1~F10 | ▶M6 | §五.1 |
| 52 | main/index.ts 拆分（registerIpc 600 行目录化） | B O2/A1/H6；A C.2 同向 | ▶M6 | §五.1 |
| 53 | App.vue 上帝组件拆分 | A CR-42 = B F1 相关 | ▶M6 | §五.1 |
| 54 | 工具目录规范对齐（pages/ 只放页面、components/ 收编、store.ts 命名） | A CR-58/59 = B T1/T2/M5/N2/P7 | ✅规范已入总纲 §1.2/§3 | ▶M6 执行 |
| 55 | 宿主渲染层结构（pages/ 缺失、VerifyGuidePage 错放 components/） | **B A2；A 漏** | ▶M6 | §五.1 |
| 56 | plain 三文件命名（N3）/ edm `shared.ts` 禁用（N6）/ discovery 同名 / 类型声明分散 | B N3/N6；A 💭P2 | ▶M6 | §五.2 |
| 57 | badge main adapter/hash 与 core/ 边界 | B O9/B5 | ▶M6 低优 | §五.1 |
| 58 | 工具 id 后缀规则（-studio/-manager）指南立规 | B N1/P9；A CR-49 是 name 面 | 📋归 Q-07 | Q-07 |

### 域6 · UI 组件与页面规范

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 59 | 确认弹框单轨（A：ConfirmDialog 组件化 vs B：ElMessageBox 单轨） | A CR-60 💭 vs B C4/M7/P5 | 冲突 C4 直接相反 | Q-07 |
| 60 | edm 三死代码页（Brands/Fragments/Templates，零引用 + 6 项违规 + 3 处守卫缺失） | A CR-11；B 未识别死代码属性 | 📋 | Q-09 |
| 61 | ProvidersPage/UsagePage 违规（UsagePage 守卫已批2修；手写 form-hint/空态、写死 gap 待统一） | A CR-60 | ⚠️部分 | ▶M4 |
| 62 | manifest name 中英混杂 | A CR-49 | 📋 | Q-07 |
| 63 | 模板工具应补"纯渲染工具形态"说明 | B B6 | ▶M8 | §五.2 |

### 域7 · 健壮性 / 门禁 / 安全

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 64 | **knip/ts-prune 死代码门禁**（A 只指出盲区，B 给出工具方案——互补） | B O3/M9；A 盲区结论 | ▶M7（无争议） | §五.2 |
| 65 | check-dialogs 补扫 ElMessageBox.confirm 选项 | 三次核对 Q-21 | 📋 | Q-21 |
| 66 | 分享路由软鉴权（自报 toolId）→ 按 webContents 绑定可信身份 | A CR-44；B 漏 | 📋 | Q-13 |
| 67 | CHANGELOG"必须由 release.mjs 生成"结构校验门禁 | A 专题D；B 漏 | ▶M7 | §五.2 |
| 68 | 图片库 60 并发无上限 / 定时发布句柄 / TransferPanel catch 静默 | A 💭P2 | ▶M5 顺带 | Q-20 |

### 域8 · 功能遗漏与验证（非本轮重构范围，维持登记）

| # | 议题 | 来源 | 状态 |
|---|---|---|---|
| 69 | PaddleOCR 本机绑定 | B F1（A 未列） | ⏳待用户输入 |
| 70 | 外部工具运行时安装（.sshktool） | B F2 | ⏳等签名/沙箱拍板 |
| 71 | 上传真实云链路 V7 + COS/七牛 | A CR-55 = B F3/F5 | 📋Q-14（SDK 已落地，仅缺真实账号验证） |
| 72 | 诊断/健康面板 plans/04 差量、快照后悔药入口（F4/F6/F7） | B 独有 | ⚠️**双方均未逐条核对**，待按 plans/04 与数据契约专项核对（诚实声明，见 §三.3） |
| 73 | X2 共享能力注册表 / X3 工具分类治理（plans/05） | A CR-55 引 | ⏳待排期 |

### 域9 · 文档治理

| # | 议题 | 来源 | 状态 | 入口 |
|---|---|---|---|---|
| 74 | 00-index 元信息/断链/登记 | A CR-51/52 = B H8/§10.1 | ✅faa30c7+批3 大半；**verify-sessions 3 个 JSON 仍未登记（实测）**、03-design 占位 | Q-18 |
| 75 | README 三处过时 + 工具清单 | B G1/G2/G3/G5 | ✅批3 | — |
| 76 | EDM v5 归档 | A CR-54 = B G4 | ✅批3 | — |
| 77 | 旧称 upload-manager 9+ 文档批量替换 | A CR-57 | ⏳ | Q-18 |
| 78 | `SSHK_DEVTOOLS_KEY` 漂移、plans/11 旧键批注、electron.vite 注释重复 | A 💭P2 | ⏳ | Q-18 |
| 79 | **UI 规范三合一**（plans/01 + 留白 + 列表页规范合并为单一《UI 与页面规范》） | **B 10.3/M14；A 漏** | ▶M8 | §五.2 |
| 80 | 完成规划归档 / 工作流规划并入《工具开发指南》 | B 10.3 | ▶M8 | §五.2 |
| 81 | 台账按季度分卷 | B M16 | ▶M8 | §五.2 |

---

## 三、查漏补缺（本次复核新增产出）

### 3.1 报告B独有条目回源码补验结果（台账此前泛引，本次逐条落定）

| B 条目 | 实测证据 | 结论 |
|---|---|---|
| R2 类型双真相源 | `UploadTargetType` 双定义确凿（`upload-core/types.ts:9` / `shared/upload-manager.ts:10`）；UploadProfile 在 core:123，shared 侧为 UploadProfileOption 映射 | ✅属实（措辞微修：shared 是映射视图非同名重复） |
| R3 脱壳双份 | renderer/plain.ts 34 行 + preload/plain.ts 46 行（+api-plain.ts 29 行），注释自述语义有别 | ✅属实（建议级，可抽 plain-core） |
| O5 env.d.ts | **恰好 336 行**（B 精确） | ✅属实 |
| O8 share-hub 照跑 | `share-hub.ts:209` `cfg.get('app.shareHub.autoStart') !== false` 默认启动 | ✅属实 → **Q-22** |
| X4 tool-skeleton | `packages/shared/src/tool-skeleton.ts` 350 行 | ✅属实 → Q-23 关联 |
| T6 fflate 重复 | badge/edm/file-manager 工具侧 4 文件直用 zipSync（backup 包属独立域，不计） | ✅属实 → export-core |
| U2 ui-kit 导出面 | logFront 确为双份定义（apps renderer + ui-kit，CR-25② 同源） | ✅方向属实 |
| 其余（N1/N2/N6、O2/O3/O4/O9、A1/A2/A3、S1~S6、B1~B6、T1/T3/T4、F1~F7、G1~G6、D6~D11、C1~C8） | 与报告A/台账交叉印证或属登记类 | 见 §二 各域行 |

### 3.2 元缺陷（三份文档自身，本次证实）

- **报告A**：CR-12~19、CR-27~29 编号空洞（grep 0 命中）——标题"CR-01~60"应理解为"实际定义 46 条、编号有洞"。
- **报告B**：L1~L12 在摘要被引用（"低危 12 项"）但全文 0 处定义——空洞引用，无法逐条处置，按摘要口径并入 M 系理解。
- **台账 v1.0**：Z1~Z7（已修正）；v1.1 遗留缺口 = 报告B明细泛引——**本报告 §二/§三.1 补齐，缺口闭合**。

### 3.3 未深核声明（诚实边界）

- 域8 的 plans/04、plans/05 差量核对（F4/F6/F7/X2/X3）双方报告都未完成逐条对照，本报告也不擅自判定——建议单独排一次「规划 vs 实现」专项核对。
- 报告B Q9 引用的"224 tests / 41 files"为历史快照（当前 467/70），已按总纲"以最近 verify 输出为准"口径处理。

---

## 四、撤销/修正清单（两报告应撤或已改判的条目汇总）

| 报告 | 撤销/改判条目 | 原因 |
|---|---|---|
| A | CR-21（误报）、CR-51（已修复态）、CR-53（建议违反只移不删铁律）、CR-54（部分：v6 权威一致，但"已归档"描述失实，批3已落实归档）、CR-04 计数（39→30）、CR-40 子断言、CR-60 FormHint 断言 | 台账 §三 + 三次核对 |
| B | E1（方向错误，C1 裁 A 对）、R5/R6（失实）、横幅"G1~G5 已顺手修复"（Z3）、L1~L12（空洞引用，并入 M 系）、§11.1 分享配置入口描述（已过时） | 台账 §四/§八 + 本次复核 |
| 台账 | v1.0 七处（Z1~Z7） | v1.1 已修正 |

---

## 五、统一处置总计划（合并 A §十二 六批次 + B §十九 批1~6，去掉已完成项）

### 5.1 已完成

- **批1 `4e879fb`**：口径 4 项 + 纯 bug 2 项（CR-06/07/08/09/26/43）
- **批2 `3a0acf5`**：危险操作守卫 8 处 + share-manager 图标
- **批3 `f830be6` + `ea0230f`**：三次核对勘误与守卫补漏 2 处、backup D18 注释收尾、EDM v5 归档、README/00-index 治理

### 5.2 无争议待执行清单（方向唯一、不涉产品意图，待用户一声令下分批跑）

| 批 | 内容 | 对应总表 # |
|---|---|---|
| **N1 抽象收敛** | useTablePage/ListPageShell/TableOpsColumn、SecretField、时间口径 14 处替换 + lint 防回潮、分享 TTL 收敛 share-core、useAction、ToolPageLayout/EmptyState/FormHint 补齐 + ChatPage 双布局核实、CR-25 四组收敛、R3 plain-core、ui-kit 导出审计、分页规范内置 | 18/38~44/46~50 |
| **N2 类型与结构归一** | UploadProfile 类型单源（shared 真相源、core re-export）、fflate → export-core、env.d.ts 由 preload 推导、any→unknown 收紧 | 19/23/24/36 |
| **N3 门禁补强** | knip 进 verify、check-dialogs 增扫 ElMessageBox.confirm 选项、CHANGELOG 结构校验 | 64/65*/*67 |
| **N4 组织与拆分** | 工具目录规范对齐（ edm/file-manager/share-manager）、宿主渲染层 pages/、main/index.ts 拆分、App.vue 拆分、大文件拆分（按 Top6 逐个）、N3/N6 命名 | 51~58 |
| **N5 文档治理** | UI 规范三合一、完成规划归档、工作流规划并入指南、CR-57 旧称替换、D18 历史稿批注、verify-sessions 登记、03-design 占位处理、B6 纯渲染形态、N1 命名规则、台账分卷 | 74/77~81 |

> 注：65（check-dialogs 补强）技术上无争议，已列 Q-21 仅为与台账决策入口对齐，两处任一拍板即执行。

### 5.3 需拍板后执行（映射决策点）

| 批 | 内容 | 决策 |
|---|---|---|
| **D1 正确性与竞态** | conflict 信号机制 + 单测、SecretsStore | Q-01 / Q-02 |
| **D2 判据与契约** | `__SSHK_DEV__` 三端注入 + isSourceRepo 分离、preview 归属、env 烤入契约三项、AppError 全主进程治理 + classifyExpected 注册制、developerMode 写法收敛、CR-46 config 订阅 | Q-05 / Q-06 / Q-17 / Q-15 |
| **D3 结构性归属** | FsRuntime 下沉（专项设计）、三能力配置升层（含 presets 归属、app.llm.health/editorMode 清理）、ShareDialog 去留、share-hub 生命周期（Q-22）、shared 拆包（Q-23）、useSelection 去留 | Q-03 / Q-04 / Q-08 / Q-22 / Q-23 / Q-19 |
| **D4 健壮性与安全** | 更新竞态、分片 gate、订阅退订、媒体 Map、日志分页、分享硬鉴权（若纳入） | Q-20 / Q-13 |
| **D5 产品意图小项** | 图标字段是否 build+developerMode 可改、manifest name 统一、edm 死代码页删/归档、COS/七牛验证范围 | Q-12 / Q-07 / Q-09 / Q-14 |

---

## 六、决策入口（唯一清单）

- **台账 §六 Q-01~Q-21** 维持不变（Q-10 已执行完毕）。
- **本次新增两项**（报告B提出但台账漏收，本次补齐）：

| 编号 | 决策点 | 选项 | 复核者建议 |
|---|---|---|---|
| **Q-22** | share-hub 生命周期与管理台解耦（B O8/S2/P4：禁用 share-manager 后宿主 HTTP 服务照跑、无 UI 可管，实测 autoStart 默认开） | A 维持宿主常驻 + 文档说明（服务属应用级能力，工具只是运营台）/ B 服务随管理台启停 | **A**（与"服务配置已在应用 ShareTab"一致；破坏其它工具分享的路由能力不可取），并随 Q-04 把服务开关收敛到应用设置 |
| **Q-23** | shared 包内聚（B P10/X4/A3/M13：upload-manager/upload-vendors/verify-steps 等领域数据与 350 行 tool-skeleton 打进运行时 shared） | A 拆领域包（`@sshk/upload-shared` 或并入 upload-core node-safe 子入口；tool-skeleton 迁 scripts/devDependency）/ B 维持（门禁依赖 verify-structure 已硬编码两份文档路径，包结构不受影响） | **A**（分两步：先迁 tool-skeleton 出运行时（零风险），领域数据外迁随 N2 类型归一同批） |

---

## 七、记录

- 本文为纯比对/计划产物：本轮除本文件与台账 #150 登记、00-index 登记外，**未改动任何源码**。
- 前序修复批次与三次核对记录见台账 §二/§八；两报告头部横幅已同步至三次核对结论。
- 待用户：①逐项回复 Q-01~Q-21 + 新增 Q-22/Q-23（"编号 + 选择"）；②对 §五.2 无争议清单说"开始"即分批执行（每批 verify 全绿 → commit → push → 核验 message）。
