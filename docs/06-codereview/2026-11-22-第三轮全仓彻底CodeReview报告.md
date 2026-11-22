# 第三轮全仓彻底 Code Review 报告（2026-11-22）

- 状态：**已逐项二次复核 + 无异议项已分批修复落地；待敲板项见配套专项**。本报告为第三轮（上一轮 P0~P9 重构整改落地后的首轮复查）。复核结论与处置进度见 §十三 及配套台账/专项文档。
- 版本：v1.0
- 日期：2026-11-22（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`（分支 `main`，基准提交 `1386475`）
- 审查范围：`docs/` 全树 54 文件 + 根目录 md；`packages/` 11 包、`tools/` 3 工具、`apps/desktop/{main,preload,renderer}` 全量源码；约 78 个 .vue + 200+ .ts。
- 审查方式：**19 维度分 5 组并行深读 + 主审逐条回源码交叉验证**。所有 🔴/🟡 结论均由主审回源码验证当前态后保留（验证过程见各条"证据"与 §三"主审复核记录"）；上一轮已修项（CR-40/41/43/46/47、P0~P9）经复核确已修复，本轮不重复列入。
- **适用前提**（用户明确）：应用尚未正式、大批量使用，所有破坏性改动一律可接受；以"彻底重构、单一真相源"为目标，**禁止打兼容补丁、禁止双轨兜底**。
- 门禁基线：`pnpm verify` 全绿——13 门禁 + typecheck + lint + build + **70 测试文件 / 466 测试全部通过**（本轮实测）。
- 工作区说明：审查期间工作区有 3 个未提交文件（`CHANGELOG.md`、`apps/desktop/package.json`、`package.json`，疑为 release 流程产物），**本轮全程只读，未触碰**。
- 关联：`2026-11-21-CodeReview敲板裁决与重构实施总计划.md`（上轮决策入口 D52~D55）、`02-architecture/遗留事项与收尾总账.md`（收尾总账）。

---

## 〇、一页速览（TL;DR）

**总体结论**：上一轮 P0~P9 重构质量高，本轮**未发现 🔴 阻塞级安全/数据丢失类问题**；dev 判据、时间/字数/密钥/访问密钥等"真相源"口径已高度统一。本轮发现的真实问题集中在四类：

1. **功能性缺陷（🟡，须优先修）**：定时发布重启后永久失效（静默）、工具密钥写失败被静默吞（数据丢失风险）、EDM 邮件"复制代码"功能缺失（明确需求未实现、`mail:readFinal` 成死代码）、跨通道复制进度冲破 200%。
2. **健壮性隐患（🟡）**：`secrets.bin` 非原子写（崩溃即静默丢全部密钥）、传输队列 remove/clearFinished 不清续传产物。
3. **PaddleOCR 删除未贯穿（跨 3 组交叉命中，系统性）**：源码已彻底移除，但 docs（plans/06、长期台账、总账、工具开发指南、00-index D45）与部分代码声明/注释/测试仍写"保留/待确认/7 项能力"——本轮最高优先级的"一致性"专项。
4. **规范与组织债（🟡）**：`.vue` 文件名 PascalCase 与规范 kebab-case 冲突（规范内部自相矛盾）、`store.ts` 收敛名从未落地（state.ts/tool-store.ts/stores/ 三套并存，三工具结构不一致根因）、README 5 处断链、pages/ 混入弹框。

**统计**：本轮共 **40 条发现**（🔴 0 / 🟡 22 / 💭 18），其中功能缺陷 4、健壮性 2、一致性 8、重复抽象 6、组织命名 8、文档 6、页面规范 6（部分条目跨维度，详见各节）。**待拍板 6 项**（见 §八）。

---

## 一、维度覆盖矩阵

| 维度 | 要求 | 结论 | 发现数 |
|---|---|---|---|
| 1 | 环境变量声明未用/使用未声明 | check-env 双向契约全绿，无僵尸/臆造变量 | 1💭 |
| 2 | 代码声明未用/使用未声明 | knip/tsc/eslint/vue-tsc 四工具全绿 | 0 |
| 3 | 重复/可提取/抽象 + 已抽取复核 | 6 处重复，UploadRuntime 三处装配最值得修 | 4🟡2💭 |
| 4 | 工具⇄应用升降级 | 2 处胶水归位建议 | 1🟡1💭 |
| 5 | 代码缺陷/优化/增强 | 定时发布失效、密钥写静默、进度 200% | 3🟡2💭 |
| 6 | 应用层分层组织 | main/ 根目录过度平铺、plain-core 落点 | 1🟡2💭 |
| 7 | 健壮性/可靠性/可读性 | secrets.bin 非原子写、续传产物遗留 | 2🟡2💭 |
| 8 | dev/build/developerMode 判据 | **高度统一，无真实违反**（本组重点） | 0（1 提示） |
| 9 | 命名规范统一 | .vue 文件名口径冲突、store.ts 未落地 | 2🟡2💭 |
| 10 | 文档合并/规整/删除 | README 断链、03-design 占位、D45 缺标注 | 1🔴6🟡1💭 |
| 11 | 三基础能力归属 | 18 项裁决：13 维持、5 调整（均为胶水/命名） | 见 §四 |
| 12 | 代码/声明/使用一致性 | preload 丢弃 IpcErr.code、ipc 注释错位 | 1🟡2💭 |
| 13 | 功能遗漏/不全 | 复制代码缺失、定时发布不全 | 2🟡1💭 |
| 14 | 工具与应用边界 | D53 边界成立，胶水层规范待补 | 1🟡2💭 |
| 15 | 破坏性重构视角 | FileExplorerPage 上帝组件、宿主能力异步化 | 2🟡2💭 |
| 16 | 注释/文档/代码一致性 | **PaddleOCR 系统性未贯穿** | 1🔴4🟡 |
| 17 | 大文件拆分 | Top4 仍大（FileExplorerPage/transfer/fs-cloud/workspace） | 1🟡 |
| 18 | 目录组织一致性 | 三工具结构差异大、pages/ 混弹框 | 3🟡2💭 |
| 19 | 页面组件/布局规范 | 2 筛选栏即时刷新、3 处固定 label-width | 5🟡1💭 |

> 说明：🔴 在维度10/16 各 1 条，均为**文档断链/失实**（非运行期阻塞），合并为"PaddleOCR 一致性专项 + README 断链"处理，不构成"必须立即修复才能发布"的阻塞。

---

## 二、功能性缺陷与健壮性（维度 5 / 7 / 13 / 15）

### 🟡 F-01 定时发布在应用重启后永久失效（静默失败）
- **位置**：`apps/desktop/src/main/content.ts:122-147`（`ensureScheduler`）、`:83/:88`（唯一调用点）、`main/index.ts:134-181`（启动链无调用）。
- **问题**：`ensureScheduler(repo)` 仅在 `contentSave()` 且 status==='scheduled' 时调用；`schedulerStarted` 为模块级布尔、`setInterval` 只在进程内跑。用户设了定时发布后关闭应用，到点**不会翻 published**；而 `makeContentListResolver`（content.ts:158-160）只查 `status='published'`，该内容**永不在分享列表出现且无任何报错**。
- **证据**：主审已回源码确认启动链 `whenReady` 无 `ensureScheduler` 调用；`schedulerStarted` 布尔无持久化恢复。
- **建议**（破坏性、不做兼容）：`setupServices/whenReady` 后无条件调用一次 `ensureScheduler(repo)` 扫描所有过期 scheduled；定时器纳入 app 生命周期（退出 `clearInterval`）；扫描时把到点项一次性翻 published。

### 🟡 F-02 工具密钥写入失败被静默吞掉，用户以为保存成功
- **位置**：`apps/desktop/src/main/services.ts:95-101`、`packages/shared/src/types.ts:130`、`tools/badge-studio/src/main/ipc.ts:204-207`、`tools/template-tool/src/main/index.ts:47-50`。
- **问题**：`ToolHostCapabilities.setToolSecret` 返回 `void`，实现为 `void secretsStore.set(...).catch(() => {})`，异常仅 onError 落日志；两个工具 IPC handler 无条件 `return true`。与 `SecretsStore` 头注释（"失败向上抛，渲染层可见"）**直接矛盾**。另：set 异步排队 + get 同步读，set 后立刻 get 会读到旧值（竞态）。
- **建议**：破坏性把 `setToolSecret` 改返回 `Promise<void>`，两个 IPC handler `await` 后再返回，交给 `handleOk` 统一转错误 toast；`getToolSecret` 一并异步化或文档明确"下个 tick 生效"。（与 §六 宿主能力契约异步化同类，建议合并处理）

### 🟡 F-03 EDM 邮件"复制代码"功能缺失（明确需求未实现）
- **位置**：`tools/edm-studio/src/renderer/pages/MailsPage.vue:175-192`（更多菜单）、`tools/edm-studio/src/main/ipc/mail.ts:118`（`mail:readFinal`，渲染层零调用=死代码）。
- **问题**：`requirement.txt:8` 要求"复制渲染、juice、压缩后的最终代码"，`render.ts:32` 注释亦写 final 产物"→ 复制代码/分享链接指向它"，三种形态产物已落盘（mail.ts:78），但 MailsPage 更多菜单只有 编辑/复制为新邮件/打开产物/删除，**无"复制代码"入口**，IPC 成死代码。
- **证据**：主审回源码确认 moreOps 四项无 copyCode，全仓渲染层零调用 `mail:readFinal`。
- **建议**：更多菜单补"复制代码"二级选择 raw/inlined/final 三形态，调 `mail:readFinal` + `host.os.clipboardWrite`（host.ts:9 已暴露）。

### 🟡 F-04 跨通道复制进度冲破 100%（先 200% 再跳回）
- **位置**：`apps/desktop/src/main/modules/file/transfer.ts:882-890`（`runCross`）。
- **问题**：`t.size = stat.size`；下载阶段 `sample(t, n)` 把 transferred 推到 size，写入阶段 `sample(t, size+n)` 推到 2×size，末尾才 `t.transferred = t.size`。进度条先冲 200% 再跳回 100%，speed 采样同样放大一倍。
- **证据**：主审回源码逐行确认。
- **建议**：两阶段按 50/50 归一化（download 用 `n/2`、write 用 `size + n/2`），`t.size` 语义恒为最终总字节。

### 🟡 F-05 secrets.bin 非原子写（崩溃即静默丢全部密钥）
- **位置**：`apps/desktop/src/main/secrets-store.ts:84-91`、`:58-61`。
- **问题**：`writeFile(this.file, encrypted)` 直接覆写，无 tmp+rename；落盘中途崩溃/断电留下半截文件，下次 `doLoad()` 的 `JSON.parse` 抛错被 catch 吞掉、cache 置 `{}`，**全部密钥静默丢失且用户无提示**。
- **建议**：与 `transfer.ts` 的 `FsTransferStore.save` 同口径改为写 tmp 再 renameSync；解析失败 `logger.error` 明确告警而非静默。

### 🟡 F-06 传输队列 remove/clearFinished 不清理续传产物
- **位置**：`apps/desktop/src/main/modules/file/transfer.ts:371-385`（remove）、`:407-417`（clearFinished）。
- **问题**：`remove()` 只删 map/samples 等内存态，未调 `cleanupResumeArtifacts`；对 paused 可续传任务 remove 后，`checkpoints/<id>.json` 与服务端 uploadId 碎片永久遗留（download 的 `.sshkpart` 同理）。`clearFinished()` 清 failed/canceled 同样遗留（`stop()` 路径有清理，这两条没有）。
- **建议**：`remove()/clearFinished()` 对每个被删 id 调 `void this.cleanupResumeArtifacts(id)`。

### 💭 F-07 MAX_TASKS 注释与实现不符
`transfer.ts:27-28,271`：注释称"任务总量上限防队列撑爆"，实现只在单次 `add()` `slice(0, MAX_TASKS)`，多次 add 可无限增长。建议改为 `this.tasks.size + inputs.length ≤ MAX_TASKS` 判断，超出丢弃并告警。

### 💭 F-08 暂停/取消任务滞留 multipartWaiters
`transfer.ts:595-604`：`pause()/stop()` 只置标志不唤醒闸门等待者，须等其他持槽任务 release 才惰性醒来，占用 Promise 闭包。建议 pause/stop 主动 flush 唤醒（复用 releaseMultipartSlot 逻辑）。

### 💭 F-09 Range 后缀 `bytes=-N` 被误当头部 N 字节
`packages/share-core/src/server.ts:516-521`：正则 `^bytes=(\d*)-(\d*)$`，`m[1]===''` 时 start=0/end=N 返回前 N 字节；RFC 7233 后缀语义应是**末尾** N 字节。媒体拖进度主要用 `N-` 形式故影响小。建议显式分支处理 suffix-range。

---

## 三、dev / build / developerMode 判据（维度 8，本组重点）

**结论：当前判据高度统一，未发现任何"绕过统一判据 / 直接绑 cfg.developerMode / dev 下被配置关掉功能"的真实违反点。** D55 敲板各点均落源码：唯一判据 `packages/shared/src/dev-flag.ts:14` 的 `SSHK_DEV`（构建期 `__SSHK_DEV__` 注入三端）；`devFeatures` 统一走 `isDevFeaturesEnabled`（dev-flag.ts:22-24）或主进程下发 `payload.devFeatures`（catalog.ts:134）。

| 文件:行号 | 当前写法 | 是否统一 |
|---|---|---|
| `shared/src/dev-flag.ts:14,22-24` | `SSHK_DEV = typeof __SSHK_DEV__!=='undefined'&&__SSHK_DEV__`；`isDevFeaturesEnabled` | ✅ 唯一真相源 |
| `electron.vite.config.ts:72-74,173,195,210` | `sshkDevDefine(mode)` 含 development/dev/preview，注入三端 | ✅ |
| `main/index.ts:56,87,97,144,163,176` | `const isDev = SSHK_DEV` 注入 ctx/window/shareHub/updater | ✅ |
| `main/catalog.ts:134` | `devFeatures: isDevFeaturesEnabled(SSHK_DEV, cfg.get('app.developerMode')===true)` | ✅ |
| `main/ipc/config.ts:16-17`、`main/ipc/app.ts:38,49-57` | 安全边界用 `ctx.isDev`（源自 SSHK_DEV） | ✅ |
| `tools/edm-studio/src/main/ipc/context.ts:56-60,76-80` | `SSHK_DEV` + `isDevFeaturesEnabled` | ✅ |
| `renderer/App.vue:126,130-142` | `isDev=SSHK_DEV`；订阅 config.onChanged（CR-46 已修） | ✅ |
| `renderer/SettingsPage.vue:55,71` | `devOnly` 字段仅按 `isDev` 显示 | ⚠️ 刻意更严（见下） |
| `scripts/verify-structure.mjs:152-167`、`eslint.config.js:49-63` | 门禁强制三端注入 + 禁裸拼 | ✅ |

**两点提示（非违反）**：
- 💭 `SettingsPage.vue:71` 的 `devOnly` 语义是"仅源码 dev"而非 devFeatures，比铁律更严；台账 #460 与 CR-48 确认为刻意设计（build+developerMode 下仍隐藏）。建议在字段旁提示"仅源码 dev 可见"避免误解。
- 💭 文档口径小差异：`electron.vite.config.ts:73` 实际判定含 `'development'`（electron-vite dev 的真实 mode），而总纲/D55/敲板计划定值均写 `mode==='dev'||'preview'`。代码注释已解释，但**文档表述与代码不完全一致**，建议 00-index D55 与总计划 P0-1 补注 `development`。另：文档多处称"拆 `isSourceRepo` 概念"，代码无该具名符号，实际是 `dev-tools.ts` 的 `guard()`/`findRepoRoot()` 内联实现同等语义——建议文档改述为"源码仓库判定内联于 dev-tools guard"，或代码补 `isSourceRepo` 具名导出。
- `autoUpdateDisabled`（main/index.ts:61，SSHK_APP_AUTO_UPDATE=0）能在 dev 关"自动更新"行为，但它是分发策略旋钮、非开发功能门控，不构成违反 §5.1。

---

## 四、三基础能力归属裁决（维度 11，用户第 11 条专项）

**总体裁决**：三能力"内核在 packages（纯）、能力在生活应用、工具只消费"的格局**总体合理**，符合 D53 基础能力模块例外与"依赖方向唯一=工具→应用"。需调整的不是能力本体归属，而是**工具与应用之间的胶水代码归位**。18 项裁决表中 13 项建议维持、5 项建议调整（均为胶水/命名，非能力本体升降级）。

| # | 能力点 | 现状归属 | 建议归属 | 理由 |
|---|---|---|---|---|
| 1 | LLM 内核（chat/listModels/gateway） | packages/llm-gateway + app ipc/llm | 维持 | ≥2 消费者，纯逻辑，符合 §1.3 |
| 2 | Provider 配置与密钥 | app main/llm-service + safeStorage | 维持 | 应用级宿主能力，工具共享一份 |
| 3 | 模型管理页面 | pages/app-admin/models | 维持 | D53 例外 |
| 4 | 模型偏好 app.modules.modelManager.* | app | 维持 | C-3 一次性迁移已定版 |
| 5 | 工具内 LLM prompt 构造 | 工具内 core | 维持工具层 | 与工具产物强相关 |
| 6 | **模型输出 JSON/HTML 剥壳** | 两工具各自实现 | **↑ 提至 llm-gateway/pure** | 重复实现（见 J-03） |
| 7 | **配置预设（llm+upload 合体）** | modules/llm/presets.ts | **↑ 提到 modules 顶层或拆分** | 名实不符（见 J-07） |
| 8 | ShareHub 内核 | packages/share-core | 维持 | 纯逻辑多消费者 |
| 9 | ShareHub 常驻生命周期 | app modules/share | 维持 | Q-22 终审 |
| 10 | ShareDialog + 分享票据 | share-core/ui | 维持 | §1.3 定版 |
| 11 | 分享管理页面 | pages/app-admin/share | 维持 | D53 |
| 12 | **工具产物路径解析 share:resolve** | 各工具 main 自实现 | **↑ 上收应用宿主（按 toolId 注册 resolver）** | 重复胶水（见 J-06） |
| 13 | 上传内核 service/providers | packages/upload-core | 维持 | 纯逻辑多消费者 |
| 14 | UploadRuntime + ipc/upload | app main/upload.ts | 维持 | 密钥/profile 收口应用 |
| 15 | 图片库桥接 createHostImageLibrary | packages/file-picker | 维持 | 单一实现三处共用，已合理 |
| 16 | 文件管理页面 | pages/app-admin/files | 维持 | D53 |
| 17 | **上传进度 toast** | 工具内 upload-progress.ts | **↓ 下沉 ui-kit 通用组件** | 与 file-picker 进度口径重复 |
| 18 | **readAsDataUrl** | 工具+包各写 | **↑ 提到 shared/file-picker** | 重复实现（见 J-02） |

> 结论：**没有"应用层该降到工具层"的能力本体**（三能力均属应用本体，D53 已定）；建议降级的仅"上传进度 toast"这一 UI 组件（工具→ui-kit，实为横向提取非降级）。建议上提的 4 项都是**跨工具重复的纯函数/胶水**，符合 §1.3"≥2 消费者复用→packages"判据。

---

## 五、重复抽象与边界（维度 3 / 4 / 14）

### 🟡 J-01 UploadRuntime 三处 Provider 装配重复
`apps/desktop/src/main/upload.ts:128-205(prepare)/209-262(readonlyList)/337-368(probe)`：三处同构装配 Local/Remote/Cloud Provider（实例化、pickProfile、getUploadSecret、targetType 判定、overrides 合并），注释声称"避免两处重复"实则只统一了调用侧。方案A（推荐）抽私有 `buildService(targetType, profileId, overrides, global, {onProgress?})` 三处复用；方案B 下沉 `@sshk/upload-core` 工厂函数；方案C 仅补注释（不推荐）。

### 🟡 J-02 readAsDataUrl 两处逐字重复
`packages/file-picker/src/host-library.ts:60` 与 `tools/edm-studio/src/renderer/upload.ts:19` 完全相同。方案A（推荐）提为 `@sshk/shared` 纯函数；方案B 由 `@sshk/file-picker` 导出。

### 🟡 J-03 模型输出剥壳三处同构
`tools/badge-studio/src/core/vision.ts:39(extractJsonArray)` 与 `tools/edm-studio/src/renderer/ai-copy.ts:41(extractJson)/51(extractHtml)`：去围栏正则 + indexOf/lastIndexOf 截取逻辑一致，仅目标括号 `[ ]`/`{ }`/`< >` 不同。方案A（推荐）提 `parseModelOutput(text, kind)` 到 `@sshk/llm-gateway/pure`；方案B 放 shared。

### 🟡 J-04 分享存活判定重复 ≥7 处
`share-ticket.ts:32`(isTicketAlive)、`share/share-util.ts:11,17`、`badge/stores/posters.ts:179,184,243`、`ContentsPage.vue:122,129`：同一"永久哨兵或 expiresAt>now"判定手写多份。已有 `isTicketAlive` 只接受完整 ticket 对象，Cover ShareRouteInfo/裸 expiresAt 场景无法复用。方案（推荐）扩展接受 `{expiresAt:number}` 投影或新增 `isRouteAlive`，统一由 share-core/ui 导出。

### 🟡 J-05（维度4）两工具各写 share:resolve 胶水
`tools/edm-studio/src/main/ipc/mail.ts:162-166` 与 `tools/badge-studio/src/main/ipc.ts:419-429`：功能同构（业务 id→产物 root/entry/label）。方案A（推荐）应用宿主提供通用 share:resolve 按 toolId 分派、工具只声明 root 规则；方案B share-core 增 `resolveProductRoot`；方案C 维持并在 §1.3 明确"产物路径解析=工具责任"。

### 💭 J-06（维度4）presets.ts 名实不符
`apps/desktop/src/main/modules/llm/presets.ts`：位于 llm 目录却同时处理 LLM Provider + upload profile 两套预设。方案A（推荐）更名 `config-preset.ts` 提升到 modules 顶层；方案B 拆 llm/upload 两份。

### 💭 J-07 config 通道映射重复 4 处
`badge/template/models/share` 四份 `host.ts` 的 `config:{get:C.configGet,set:C.configSet}` 逐字相同。建议 ui-kit 提供 `CONFIG_HOST` 片段常量或 `createSafeHost` 内置默认映射。

### 💭 J-08 三套 upload:progress 进度口径
`useUploadPool.ts:66,151`（UI 爬升到 90）、`host-library.ts:33-45`（name 分发、只 0/100）、`edm/upload-progress.ts:11-73`（真实百分比 toast）。建议统一到 file-picker 进度模型，edm 会话 toast 下沉 ui-kit。

### 🟡 J-09（维度14）胶水层边界规范缺失
D53 铁律（应用不 import 工具、依赖单向）当前成立，但分享呈"内核在 packages + 管理在应用 + 工具各写 share:resolve"三段式，胶水边界模糊。建议 §1.3 补"基础能力的工具侧胶水（产物路径解析/进度展示/输出解析）归位规范"。

### 💭 J-10 正面复核（无需改）
`badge-studio/src/core/*`、`edm-studio/src/core/*` 纯逻辑且各仅 1 消费者，符合 §1.3"下沉工具 src"判据，判定合理，**不建议提升**。`@sshk/ui-kit` 已零业务（ShareDialog 已在 P5-3 迁出）。

---

## 六、注释 / 文档 / 代码一致性（维度 16，含 PaddleOCR 专项）

### 🔴 C-01 PaddleOCR"已彻底删除"结论未贯穿（跨 3 组交叉命中的系统性问题）
源码已彻底移除（packages 无 `runLocalOcr` 定义、badge vision/stores 已正确标注 CF-5），但**文档与部分代码声明仍写"保留/待确认/7 项能力"**。这是本轮一致性最高优先级专项，逐条清单：

| 位置 | 现状表述 | 应改为 |
|---|---|---|
| `docs/00-index.md:151` D45 | "PaddleOCR 作为可插拔识别源"（有效决策口吻） | 加"⛔已推翻 2026-11-21 → P7-1 彻底移除（CF-5）" |
| `docs/00-index.md:23` 台账描述 | "Badge 图片识别 / PaddleOCR" | "Badge 云端视觉识别（PaddleOCR 已移除）" |
| `docs/00-index.md:180` 待确认项 | "用户确认（PaddleOCR）：本机 Python 路径…" | 删除该待办（能力已删） |
| `docs/02-architecture/工具插件化需求台账.md:29,147,153,160-166,482,1052` | #13"接口已落/绑定待确认"、provider 含 paddleocr、"PaddleOCR 接入"整节、"#31 等自查值"、C-Q1"能力保留" | 按 CF-5 收口为"已删除（D45 推翻→P7-1）"，删整节、去 provider 选项 |
| `docs/02-architecture/遗留事项与收尾总账.md:88` | C-Q1"搁置+界面抹除（能力保留）" | "已删除（P7-1）" |
| `docs/plans/06-开发体验与工作流.md:57-66` | "方案（抹除 ≠ 删除能力）"、"runLocalOcr/适配器/纯函数全部保留"、"恢复路径" | 整节改写为"已彻底移除"，删"能力保留/配置兼容/恢复路径" |
| `docs/02-architecture/工具开发指南.md:130` | "7 项宿主能力…runLocalOcr" | "6 项"并删 runLocalOcr |
| `scripts/tool-skeleton/index.ts:15` | 骨架能力白名单含 `runLocalOcr` | 删除该白名单项 |
| `tools/template-tool/tool.manifest.json:175` | capabilities 声明 `runLocalOcr`（宿主已无此能力） | 删除 |
| `tools/template-tool/src/renderer/pages/HomePage.vue:71-72,144` | "全部 7 项宿主能力"+空 ⑦OCR 注释（CAPS 实 6 项） | 改"6 项"、删空注释 |
| `tools/badge-studio/src/core/datasource.test.ts:43,53` | describe/it 描述含 PaddleOCR | 改"云端视觉模型" |
| `apps/desktop/src/main/services.ts:89` | "本机 OCR：无 shell…"注释挂 LLM 服务上方 | 删除残留注释 |
| `tools/badge-studio/src/main/ipc.ts:128`、`src/core/datasource.ts:143`、`packages/shared/src/types.ts:125` | 注释仍称有本机 OCR | 删除/改写 |

> 主审复核：已验证 `packages/**` 无 `runLocalOcr` 定义；`pkg-validate.ts:85-87` 对 capabilities 仅做"是否数组"结构校验、不比对宿主白名单，main 侧无 capabilities 消费点——故**不会触发运行时降级异常**，定性为"能力清单/注释失实"的清理项，非运行期 bug。已通过 SendMessage 与两代理交叉去重，不重复计数。

### 🟡 C-02 plans/11 通篇用已弃用 `app.content.editorMode` 旧键
`docs/plans/11-内容管理与文章分享设计.md:70,130,148,160,168`：用 `app.content.editorMode`，但总纲 §5.6 明确 P4-8c（C-3）已迁 `app.modules.fileManager.editorMode`、旧键弃用不写迁移；CR-37 曾指出、P1-6 标"已清"实际该文件未改。建议按 §5.6 给历史设计稿加"实现已变更"批注（键已迁、dev 铁律不变），不改写历史正文。

### 🟡 C-03 preload 解包丢弃 `IpcErr.code`（维度12）
`apps/desktop/src/preload/index.ts:21`：`throw new Error(result.message)` 丢弃 `code`，与总纲 §4"preload 统一解包且保留 code 分类"不一致；主进程 `ipc-wrap.ts:36-47` 精心分类的六类错误码在渲染层全退化为无分类。当前渲染层无 `err.code` 消费方故无功能故障。方案A（推荐）抛带 code 的错误对象（`new AppError(result.message, result.code)`）；方案B 修订总纲 §4 文案为"抛 message"，消除声明分歧。

### 💭 C-04 IPC 通道表注释错位
`packages/shared/src/ipc.ts:67`：uploadSecretGet 行尾挂了描述 uploadTest 的"连通性自检"注释。建议移到 uploadTest 上方。

### 💭 C-05 僵尸 env 变量墓碑注释
`packages/shared/src/constants.ts:3`：`不再有 SSHK_TOOLS_ALLOW_SECRET_MIGRATION 开关` 注释是源码内对该 env 文案的唯一残留；总纲 §5.6 要求"应用中不再出现该文案，清理残留"。建议改中性表述"D18 迁移开关已删除，本文件不定义相关常量"。（docs/ 内命中均带"实现已变更"批注，合规不列。）

### 一致性"无发现"项（已回源码核对，质量较高的部分）
D52 vs D55 推翻关系、时间口径、字数口径、`?ak=`、密钥命名空间 `app:upload:<pid>`、工具改名 upload-manager→file-manager/model-console→model-manager、dev 判据三端注入——7 类核心口径全部一致，无需改动。

---

## 七、文档治理（维度 10）

### 🔴 D-01 README 断链（文档门面优先修）
`README.md:51-54` 4 行指向已删除合并的需求文档（实际 `01-requirements/` 只有 `需求沟通记录.md`）；`:56` 指向已归档的 `02-architecture/2026-11-12-模块规范-ESM优先兼容CJS.md`（实际在 `99-archive/`）。建议：4 行需求文档合并为 1 行指向 `需求沟通记录.md`；模块规范行改指 `99-archive/` 路径或删除。

### 🟡 D-02 决策看板编号范围过时
`docs/00-CONVENTIONS.md:6`："D1~D51"，实际已到 D55。改"D1~D55"。

### 🟡 D-03 `03-design/` 空占位反复标"待建"未处置
`docs/00-index.md:54,68`：CR-52、P8-5 均列待删，v1.12 仍未删；文件系统无该目录。建议删清单行或标"不设此目录"。

### 🟡 D-04 verify-sessions JSON 未登记
`docs/verify-sessions/` 下 4 个 JSON（11-17/18/19/21）未进 00-index §一清单；CR-52/交叉合并/P8-5 均指出至今未销账。建议在 §一 增数据目录登记行。

### 🟡 D-05 两份 architecture 薄壳规范未登记
`docs/02-architecture/列表页筛选与操作栏规范.md`、`页面留白与间距规范.md` 已正确改为薄壳重定向（各 4-5 行指向 plans/01），但 00-index §一 清单无独立行。建议补登记标"薄壳重定向防断链"。

### 💭 D-06 06-codereview 文档增长
现有 5 份 codereview 文档（本轮新增本报告），体积已达 290KB+。建议后续按季度做"终审结论蒸馏"（新开薄索引 + 旧报告保留），当前规模尚可不动。

> 无发现项：06-codereview 既有 4 份均在 §一登记；99-archive 5 份遵循"只移不删"；技术选型/数据契约两处门禁强依赖文档保持原位。

---

## 八、分层组织 / 命名 / 大文件 / 目录（维度 6 / 9 / 17 / 18）

### 🟡 O-01 main/ 根目录过度平铺，三能力 root 与 modules/ 双落点
`apps/desktop/src/main/` 约 45 个 .ts 平铺；file 能力 root 有 content.ts/local-res.ts/media-stream.ts/upload.ts，modules/file/ 又有六文件；llm 有 root llm-service.ts + modules/llm/presets.ts。与 §1.3 D53"能力模块归 modules/{file,llm,share}"不一致。建议：域相关 root 文件收进对应 modules/，根目录仅留 index/services/ipc-wrap/logger 等横切基建。

### 🟡 O-02 .vue 文件名 PascalCase 与规范 kebab-case 冲突（规范自相矛盾）
全库约 78 个 .vue 全为 PascalCase，但 §3 写"组件文件/目录 kebab-case、组件名 PascalCase"，而 §1.2 自身又写 `XxxPage.vue`（PascalCase）——**规范内部矛盾**，eslint 无 filename 规则兜底。破坏性重构下二选一并回写 §3：方案A（推荐）明确"*.vue 文件名 PascalCase、目录 kebab-case"（符合现状、改动最小）；方案B 全量 kebab-case 重命名组件文件、保留 Page.vue 例外。

### 🟡 O-03 store.ts 收敛名从未落地（三工具结构不一致根因）
§1.2 要求"state.ts/shared.ts 收敛为 store.ts"，实际全库 store.ts 文件数 **0**：badge 用 `state.ts` 桶 + `stores/` 复数目录、edm 用 state.ts + tool-store.ts 并存、template 用 state.ts、models 用 state.ts。`plans/11:150` 仍引用 state.ts 佐证文档未同步。建议统一 `store.ts`，多域用 `store/` 目录 + 各域文件，禁三套并存。（与 O-05 合并处理）

### 🟡 O-04 三工具包结构显著不一致（违背 D39/D40 对齐）
| 目标项 | edm-studio | badge-studio | template-tool |
|---|---|---|---|
| manifest/icon ✓ | ✓ | ✓ | ✓ |
| main/ipc.ts | ✓ | ✓ | ✗ |
| main/ipc/ 目录 | ✓(7 文件) | ✗ | ✗ |
| src/core/ | ✓(9) | ✓(7) | ✗ |
| store.ts | ✗(state+tool-store) | ✗(state+stores/) | ✗(state) |
| renderer/pages/ | ✓(2) | ✓(2) | ✓(3) |
| renderer/components/ | ✓(8) | ✗ | ✗ |
| renderer/composables/ | ✓(6) | ✗ | ✗ |
| renderer 顶层散落 .ts | 7 | 0 | 1 |
| 展示名 | EDM Studio(英) | Badge Studio(英) | 中文 |

建议定"最小必需（host.ts+store.ts+pages/）+ 可选扩展（components/composables/core/ipc）命名统一"基线，收敛后三者仅剩"能力有无"差异。

### 🟡 O-05 pages/ 混入弹框与纯逻辑
§1.2 要求 pages/ 只放 `XxxPage.vue`，实际 `ContentEditorDialog.vue`、`MountEditDialog.vue`、`ProxyEditDialog.vue` 等弹框及 `content-export.ts` 纯逻辑混入 pages/。建议弹框移同级 components/、纯逻辑移 composables/。另 `settings/`、`verify-guide/` 把 .vue 直接放域根（无 pages/ 包裹），`CloudProfileForm/RemoteProfileForm` 在 files/ 根——建议统一"域/pages + 域/components + 域/composables"三层。

### 💭 O-06 plain-core.ts 落点不统一
`apps/desktop/src/plain/plain-core.ts`（宿主专用共享核心）单列顶层目录，而同性质的 verify-steps.ts 已收进 `apps/desktop/src/shared/`。建议统一到 `shared/plain-core.ts`。

### 💭 O-07 §1.1 "packages 纯逻辑无 UI" 与 §1.3 矛盾
实际 ui-kit/share-core/ui/file-picker/rich-text/code-editor 均含 .vue。建议 §1.1 改"共享层（纯逻辑为主，通用 UI 集中 ui-kit / 领域包 ui 子目录）"。

### 大文件 Top20（维度 17）
| # | 文件（相对仓库根） | 行数 | 需拆 | 建议 |
|---|---|---|---|---|
| 1 | apps/.../files/pages/FileExplorerPage.vue | 1109 | 高 | script 已用 15 composables，剩余大头在 template(386-965)/style(967-1109)，按功能区抽子组件 |
| 2 | apps/.../modules/file/transfer.ts | 903 | 高 | 拆 transfer-store/engine/worker |
| 3 | packages/upload-core/src/providers/fs-cloud.ts | 890 | 高 | download() 单方法 276 行，抽 fs-cloud-download + util |
| 4 | tools/badge-studio/src/renderer/stores/workspace.ts | 737 | 高 | 5 个域混杂，按域拆 5 文件 |
| 5 | tools/badge-studio/src/renderer/pages/GeneratePage.vue | 656 | 低 | style 205 行，定位逻辑抽 composable |
| 6 | packages/shared/src/types.ts | 633 | 否 | 纯类型聚合，内聚 |
| 7 | packages/share-core/src/ui/ShareDialog.vue | 624 | 视情况 | 核是否混入多票据分支 |
| 8 | packages/share-core/src/server.ts | 613 | 视情况 | 按启动/路由/清理拆 |
| 9 | apps/.../files/pages/ProfilesPage.vue | 603 | 低 | 校验/提交抽 composable |
| 10 | packages/file-picker/.../FilePickerDialog.vue | 592 | 否 | 内聚 |
| 11-20 | shared/fs.ts(590)、useUploadPool.ts(552)、RichTextEditor.vue(528)、ToolManifestDialog.vue(511)、SettingsPage.vue(502)、fs-remote.ts(472)、badge ipc.ts(469)、TransferPanel.vue(466)、preload/index.ts(465)、ContentsPage.vue(460) | — | 否/低 | 内聚或低优先 |

> 补充 🟡：`tools/edm-studio/src/renderer/` 根目录散落 7 个 .ts（ai-copy/compose-types/meta-fields/sample-schema/upload-progress/upload/tool-store），违反 §1.2 renderer 目标树。建议按 core/composables 归类、tool-store 并入 store.ts。

---

## 九、页面组件与布局规范（维度 19）

组件提取整体达标：FormHint/FormGrid/EmptyState/ListPageShell/ToolPageLayout/useTablePage/TableOpsColumn/useAction/SecretField 均已落地并被主页面消费；分页统一 `layout="total, sizes, prev, pager, next, jumper"`；留白 token 与 `label-width="auto"` 大多落实。

### 🟡 P-01 UsagePage 筛选栏不符规范
`apps/.../models/pages/UsagePage.vue:121-136`：只有 radio 时间范围且 `@change="refresh"` 即时生效，无查询/重置按钮、非 360px datetimerange。建议：统计页申请豁免并在规范写明，否则补齐 360px datetimerange + 查询/重置 + draft/applied 分离。

### 🟡 P-02 LogsPage 筛选控件绕过"点查询才生效"
`apps/.../share/pages/LogsPage.vue:200-215`：date-picker/statusGroup/toolId 三个控件均 `@change="doSearch"` 即时搜索，虽有查询/重置按钮但草稿/生效未分离。建议：控件只改 draft，移除 @change 的 doSearch，仅查询按钮提交。

### 🟡 P-03 ToolManifestDialog 固定 label-width
`apps/desktop/src/renderer/components/ToolManifestDialog.vue:367,388,415`：`label-width="130px"/"96px"` 三处，违反 §2.2"一律 auto"。建议改 auto。

### 🟡 P-04 MailEditor 固定 label-width
`tools/edm-studio/src/renderer/components/MailEditor.vue:237,253`：`label-width="90px"` 两处，违反 §2.2。建议改 auto（与同工具 SaveAsDialog/FieldSchemaDesigner 的 auto 统一）。

### 💭 P-05 ProfilesPage hint 散写
`apps/.../files/pages/ProfilesPage.vue:417,428,455`：`.hint` span + `el-empty`。配置页 el-empty 可豁免，长说明宜迁 FormHint detail。

### 页面规范符合度清单
| 页面 | 符合度 | 不符点 |
|---|---|---|
| share: Routes/Proxies/Mounts/Service/MountEditDialog/ProxyEditDialog | ✅ 符合 | — |
| share: LogsPage | ⚠️ 部分 | @change 即时搜索（P-02） |
| files: Contents/ContentEditorCore/Dialog/Page、CloudProfileForm、RemoteProfileForm | ✅ 符合 | — |
| files: ProfilesPage | ⚠️ 部分 | hint 散写、el-empty（P-05） |
| files: FileExplorerPage | 豁免（全屏工作台） | — |
| models: ProvidersPage | ✅ 符合 | — |
| models: UsagePage | ⚠️ 部分 | 筛选栏（P-01） |
| models: ChatPage | 豁免（对话页） | — |
| settings 四页 + parts 六 Section、verify-guide、AppAdminPage | ✅/豁免 | — |
| edm: MailsPage/ContentManagePage | ✅ 符合 | — |
| badge: PostersPage/GeneratePage | ✅ 符合 | — |
| template: HomePage | ⚠️ 部分 | "7 项能力"过时 + 空 OCR 注释 |
| template: ConfigPage/RichTextPage | ✅/豁免 | — |
| ToolManifestDialog、MailEditor（组件） | ⚠️ 部分 | 固定 label-width（P-03/P-04） |

---

## 十、优先级处置建议（分批，破坏性、不留兼容补丁）

| 批次 | 主题 | 条目 | 规模 |
|---|---|---|---|
| **R1 功能缺陷批** | 修真 bug | F-01 定时发布恢复、F-02 密钥写异步化、F-03 复制代码、F-04 进度 200%、F-05 secrets 原子写、F-06 续传产物清理 | M |
| **R2 PaddleOCR 一致性专项** | 全量收口 | C-01 表内 14 处（docs 6 + 代码声明/测试 8），一次性清 | S |
| **R3 文档门面批** | 断链与登记 | D-01 README 断链、D-02~D-05 编号/占位/登记、00-index D45 标注 | S |
| **R4 命名/结构统一批** | 规范对齐 | O-02 .vue 口径拍板、O-03/O-04 store.ts + 三工具结构对齐、O-05 pages/ 归位 | L |
| **R5 重复抽象批** | 上收胶水 | J-01 UploadRuntime buildService、J-02/03/04 纯函数上提、J-05 share:resolve 上收 | M |
| **R6 大文件批** | 视图层拆分 | FileExplorerPage.vue、transfer.ts、fs-cloud.ts、workspace.ts 四个高优先 | L |
| **R7 页面规范批** | 补齐标准 | P-01~P-04 筛选栏/label-width | S |
| **R8 一致性收尾批** | 表述校准 | C-02 plans/11 键批注、C-03 preload code、C-04/05 注释、§八 dev mode 文档口径 + isSourceRepo 表述 | S |

> 执行纪律（沿用项目铁律）：每批 verify 全绿（13 门禁 + tsc + eslint + build + 466 测试）→ conventional commit → push main → `git log -1 --format='%h | %s'` 核验 message。**CHANGELOG 由 release 生成，禁手工写**。

---

## 十一、待拍板事项（请按"编号 + 选择"回复）

| # | 决策点 | 选项 | 建议 |
|---|---|---|---|
| **Q-1** | `.vue` 文件名口径（O-02） | A. 明确 PascalCase 为唯一口径（改规范、符合现状）；B. 全量改 kebab-case 保留 Page.vue 例外 | **A**（改动最小、符合全库现状与 §1.2 Page.vue 约定） |
| **Q-2** | 三工具结构统一基线（O-03/O-04） | A. 最小必需+可选扩展（推荐）；B. 三工具完全同构（连空目录都建） | **A**（避免过度设计） |
| **Q-3** | 工具侧 share:resolve 归位（J-05） | A. 上收应用宿主按 toolId 分派；B. share-core 增辅助函数；C. 维持并规范明确工具责任 | **A**（消除重复胶水，符合 D53 单向依赖） |
| **Q-4** | 宿主能力契约异步化（F-02/维度15） | A. 破坏性全组 Promise 化；B. 仅 setToolSecret 异步化；C. 维持并文档说明 | **A**（一次性消除静默失败+竞态，趁未发布） |
| **Q-5** | UsagePage 筛选栏（P-01） | A. 统计页申请豁免并写入规范；B. 补齐 360px datetimerange + 查询/重置 | **A**（统计汇总页 radio 快捷范围合理，省去冗余按钮） |
| **Q-6** | preload IpcErr.code（C-03） | A. 抛带 code 错误对象透传分类；B. 修订总纲 §4 为"抛 message" | **A**（落实既有契约声明，为将来错误码消费留口） |

---

## 十二、主审复核记录（结论可信度说明）

以下发现由主审在收到代理报告后**亲自回源码逐条验证**，确保落档准确、无"失实条目"：

| 发现 | 复核动作 | 结果 |
|---|---|---|
| F-01 定时发布失效 | `grep ensureScheduler` + 读 main/index.ts whenReady + content.ts:120-165 | ✅ 属实：启动链无调用，resolver 只查 published |
| F-03 复制代码缺失 | 读 MailsPage.vue:170-196 moreOps + grep mail:readFinal 消费 | ✅ 属实：四项无复制代码，IPC 死代码 |
| F-04 进度 200% | 读 transfer.ts:868-892 runCross | ✅ 属实：download sample(n)+write sample(size+n) 双计 |
| F-02 密钥静默吞 | 读 services.ts:90-102 | ✅ 属实：`.catch(()=>{})` + handler 无条件 true |
| C-01 runLocalOcr 残留 | grep 全仓 runLocalOcr + 读 shared/types.ts:127-139 ToolHostCapabilities | ✅ 属实：shared 已无该能力，骨架/manifest/测试/注释仍声明 |
| 维度8 dev 判据 | grep developerMode/__SSHK_DEV__/裸拼 + 读 dev-flag.ts、electron.vite.config.ts | ✅ 属实：无裸拼绕过，判据统一 |
| PaddleOCR 文档失实 | grep docs PaddleOCR + 对照 00-index:5 声明"已移除" | ✅ 属实：D45/待办/台账/plans06 仍"活" |
| 危险操作二次确认 | 统计 33 处 ElMessageBox.confirm、49 处双禁 + 读 check-dialogs.mjs:47-58 | ✅ 已由门禁守门（上轮已修，未列入发现） |

> 本轮严格遵循总纲 §5.6"报告结论落代码前必须回源码验证当前态"，上一轮两份报告曾发现多处"当前已修复/失实"条目，本轮已规避。

---

---

## 十三、二次复核与处置结果（2026-11-22，回填）

用户对全部 40 条发现下达"逐项二次复核 + 全部采纳建议 + 复核后开始做"指令后，已按 19 维度拆 4 组并行回源码复核，并按"无异议直改、有方案待敲板"分流执行。

### 13.1 复核结论

- **误报 0 条**：40 条定性全部成立，§十二"主审复核记录"可信。
- **部分属实（细节偏差）6 条**：F-04（渲染层有 `Math.min(100)` clamp，用户可见是"提前假满"非字面 200%）、F-05（catch 有 `console.warn` 非全静默）、C-01（表内 14 处属实但清单远不全）、C-02（行号 :148 应为 :160/:168）、C-05（源码注释已合规、"docs 均带批注"断言失实）、§三 dev 判据（"无违反"属实但文档口径提示不全）。
- **报告自身瑕疵 13 处**：行号偏差 6、交叉引用错指 2（§四表 #7 应见 J-06、#12 应见 J-05）、统计数字偏差 3（.ts 45→50、.vue 78→95、badge core 7→6）、定性表述偏差 2。
- **漏报 14 组（N-1~N-14）**：最重要为 N-1（F-02 静默吞扩散到应用侧 7+ 处）、N-2（examples 的 `runLocalOcr` 真实调用会 TypeError）、N-10~N-13（退出清理/share-hub 落盘/备份导入的 fire-and-forget 与非原子写）。
- 完整逐项判定矩阵、证据与漏报明细见配套 `06-codereview/2026-11-22-第三轮审查逐项复核台账.md`。

### 13.2 已修复并落地（4 次提交，覆盖 R1-a、R1-b+R2、R3/R7/R8 与 R5 批1；均 verify 全绿 466 测试 + commit + push + message 核验）

| 批次 | 覆盖条目 | 提交 |
|---|---|---|
| R1-a | F-01 定时发布重启恢复 + F-02 密钥写全组 Promise 化（含 N-1 扩散面） | `a6421c7` |
| R1-b + R2 | F-03 复制代码（三形态）/F-04 进度双计/F-05 secrets 原子写/F-06 续传产物/F-07~F-09 + N-10~N-14 + 9 条死通道清理 + **PaddleOCR 全量清理**（C-01 + N-2/N-3，含 examples dist 重建与 `.sshktool` 重签） | `1cd3795` |
| R3/R7/R8 | D-01~D-05（README 断链/编号/占位/登记）、P-02~P-05（查询重置分离/label auto/FormHint）、C-02/C-04 + N-7/N-8/N-9 + AGENTS.md dev 判据统一 | `c66276d` |
| R5 批1（⚠️ 提前落地，待追溯确认） | J-01 Provider 装配抽取 / J-02 readAsDataUrl / J-04 expiresAt 存活谓词 / J-07 createSafeHost config 默认映射 | `3643019` |

### 13.3 待敲板（未擅改，落专项待用户确认）

- **Q-4 已按方案 A 直改**（按用户第 8 条"彻底重构、禁止补丁"排除 B/C，无实质异议），供追溯/推翻。
- **Q-1/Q-2/Q-3/Q-5/Q-6/Q-7 + 工具⇄应用升降级专项**：存在真实方案分歧，落 `06-codereview/2026-11-22-工具应用升降级与待敲板专项.md`，待用户按"编号+选择"回复后再执行。
- **R5/R6 大型重构**：J-01/02/04/07 已由并行 agent 提前落地于 `3643019`（门禁全绿，**待用户追溯确认**；若否决可 `git revert`）；剩余 J-03/05/06/08 重复抽象、O-01/05/06 结构归位、4 个大文件拆分因落点与 Q-3/Q-7 交织，留待敲板后统一实施。详见逐项复核台账 §七。
- 用户回复格式与默认执行规则见专项文档第三部分。

- 报告完。处置进度实时更新见逐项复核台账 §七；待敲板项见升降级与待敲板专项。
