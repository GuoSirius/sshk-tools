# 独立全仓深度 Code Review 报告（2026-11-20）

- 状态：**审查完成，待逐项拍板处理**。本报告为二轮独立审查产出。
- 版本：v1.0
- 日期：2026-11-20（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`（分支 `main`，基准提交 `7c55f32`）
- 审查范围：263 个 TS/TSX + 73 个 Vue + 103 个 Markdown；6 个工具包 + 10 个基础包 + apps/desktop 三层。
- 审查方式：9 个维度并行深读 + 对全部 🔴 级结论逐条回源码交叉验证（验证结果见各条"证据"）。
- **独立性声明**：本次审查**未读取、未参照** `02-architecture/2026-11-20-全仓CodeReview与重构建议.md`（台账 #147）。所有结论、编号、分级、矩阵均为独立产出；两份报告的条目不构成对应关系，请勿按序号对照。
- **适用前提**（用户明确）：应用尚未正式、大批量使用，所有破坏性改动一律可接受；本次建议以"彻底重构、单一真相源"为目标，**禁止打兼容补丁、禁止双轨兜底**。

---

## 〇、执行摘要

### 0.1 总体判断

架构骨架是健康的：三端分层清爽（渲染层零 Node、主进程零 UI）、`@sshk/*` 包命名统一、`createSafeHost`/`useToolId`/`shared/time.ts` 等核心抽象设计优秀且落地彻底、门禁体系（13 道 + 双向 env 契约）工程质量高。**未发现"使用未声明符号"、密钥硬编码、`.env` 误提交。**

问题集中在四类：①**少数真实数据正确性缺陷**（传输冲突状态被覆盖、密钥写竞态）；②**三处"文档/注释口径与已变更实现相反"**（D18 env、字数口径、`?key=`），会直接误导开发和验收；③**一个结构性错配**（文件浏览运行时整块驻留应用主进程，只服务单个工具）；④**大量"声明了真相源却被消费侧绕过"的口径漂移**（常量、时间、工具 id、列表页布局）。

### 0.2 TOP 必修（建议优先处理，含证据状态）

| 编号 | 一句话 | 维度 | 已回源码验证 |
|---|---|---|---|
| **CR-01** | 传输引擎 `conflict`（冲突待确认）状态被无条件覆盖为 `success`，覆盖确认机制完全失效 | 5/13 | ✅ |
| **CR-02** | 密钥写入竞态 + fire-and-forget，快速连续设置可丢密钥、写盘失败静默 | 5/7 | ✅（逻辑确认） |
| **CR-03** | dev 判据双源：主进程 `!app.isPackaged` vs 渲染层 `import.meta.env.DEV`，preview 模式分裂 | 8 | ✅ |
| **CR-04** | `fs.ts`（2047 行 + 39 个 `fs:*` IPC）只服务 file-manager 一个工具却常驻应用主进程 | 4/11/17 | ✅ |
| **CR-05** | 全主进程普遍违反"业务校验失败 `throw new AppError(msg,'validation')`"铁律，终端刷堆栈 | 7/12 | ✅ |
| **CR-06** | D18 env 门控已删除，但源码注释 + 6+ 文档仍称其为"唯一真相源" | 16 | ✅ |
| **CR-07** | 字数口径验收步骤/注释与实现相反（实现=非空白字符数，文档写"西文串 1"） | 16 | ✅ |
| **CR-08** | 访问密钥参数验收步骤仍用失效的 `?key=`（内核已只认 `?ak=`） | 16 | ✅ |

### 0.3 19 维度审查覆盖矩阵

| # | 维度 | 结论 | 主要条目 | 严重度 |
|---|---|---|---|---|
| 1 | 环境变量声明/使用 | 无死变量、无未声明读取、无泄露；3 处机制缺口 | CR-20~22 | 🟡 |
| 2 | 声明/使用、死代码 | 门禁盲区导致 export 死代码成片 | CR-23~26 | 🟡 |
| 3 | 重复代码/抽象 | 6 类高价值抽取点，已抽取部分合理 | CR-30~35 | 🟡 |
| 4 | 工具⇄应用升降级 | 1 处结构性下沉偏差 + 2 处上提机会 | CR-04/36/37 | 🔴 |
| 5 | 代码缺陷 | conflict 失效、密钥竞态、更新/分片竞态、订阅泄漏 | CR-01/02/38~41 | 🔴 |
| 6 | 应用层分层 | App.vue 上帝组件 + 重复挂载 | CR-09/42 | 🟡 |
| 7 | 健壮性/可靠性 | AppError 铁律系统性违背 + 若干校验缺口 | CR-05/43~45 | 🔴 |
| 8 | dev/build/developerMode | 铁律本体未被违反，但判据双源 + 3 处行为不一致 | CR-03/46~48 | 🔴 |
| 9 | 命名规范 | manifest 展示名中英混杂、composable 文件名两套风格 | CR-49/50 | 💭 |
| 10 | 文档规整 | 索引断链、版本过时、plans 漏登、归档决策 | CR-51~54 | 🟡 |
| 11 | 三能力分层 | 骨架合理；下沉 fs、归位两处配置，无能力需上提 | 见专题 A | 🔴 |
| 12 | 规范一致性 | 常量/时间/工具id 声明与消费脱节 | CR-25/26/33 | 🟡 |
| 13 | 功能遗漏 | 主体已实现；conflict 属"实现但 broken"比遗漏更重 | CR-01/55 | 🔴 |
| 14 | 工具与应用边界 | 边界清晰；分享路由软鉴权是已知未做安全项 | CR-44/56 | 🟡 |
| 15 | 破坏性改动态度 | 全文建议均按"不考虑兼容、彻底重构"给出 | 贯穿全文 | — |
| 16 | 注释/文档/代码一致 | 3 处口径相反（必改）+ 多处旧称残留 | CR-06/07/08/57 | 🔴 |
| 17 | 大文件拆分 | Top15 清单，2 个真·上帝文件 | 见专题 C | 🔴 |
| 18 | 目录组织结构 | share-manager 缺图标（违反硬约定）、3 工具结构散乱 | CR-10/58/59 | 🔴 |
| 19 | 页面组件/布局规范 | 主流列表页高度合规；edm 三个死代码页成片违规 | CR-11/60 | 🔴 |

> 说明：严重度 🔴 表示"影响数据正确性 / 安全边界 / 项目硬约定 / 核心契约"，不代表实现难度；CR 编号全局唯一，后文专题只引用编号、不重复描述。

---

## 一、🔴 阻断级问题（P0：建议优先彻底修）

### CR-01 · 传输引擎冲突状态被 success 覆盖，覆盖确认机制完全失效
**维度** 5/13 · **严重度** 🔴 · **验证** ✅ 已回源码

**证据**（`apps/desktop/src/main/fs.ts`）：
```ts
// :705-709 runUpload 检测冲突后是普通 return，不抛异常
if (stat.exists && !stat.isDir && !this.overwrite.has(t.id)) {
  this.setStatus(t, 'conflict', { error: '目标目录已有同名文件：任务已暂停…' })
  return
}
// :666-673 execute 在 runUpload 正常返回后无条件置 success
if (t.kind === 'upload') await this.runUpload(t, driver)
...
this.setStatus(t, 'success', { speed: undefined })
return
```
同样模式见 `runDownload`（:891-894）、`runCross`（:1023-1026）。

**为什么是问题**：冲突任务永远不会停留在 `conflict`。渲染层 `TransferPanel.vue:368` 的「覆盖」按钮（`v-if="t.status === 'conflict'"`）几乎不出现；120ms 节流全量推送使中间态来不及下发。用户看到"成功"，实际一个字节都没传（`transferred=0`）。这直接摧毁 plans/10 §4「conflict→覆盖/停止」语义与危险操作二次确认。

**建议**（多方案）：
- **方案 A（推荐）**：冲突分支抛专用信号 `throw new Error('__fs_conflict__:'+msg)`，在 `execute` 的 `catch` 中识别并 `setStatus('conflict')`，与既有 `__fs_paused__`/`__fs_canceled__` 同一套机制，天然不落 success。
- **方案 B**：`runXxx` 返回 `'done'|'conflict'` 枚举，`execute` 依返回值决定是否置 success。
- 无论哪案，**必须补单测**：`main/fs.ts` 2047 行零单测（`main/` 下无 `fs.test.ts`）是该类状态机 bug 逃逸的根因。

### CR-02 · 密钥写入竞态 + fire-and-forget
**维度** 5/7 · 🔴 · 验证 ✅（逻辑确认）

**证据**（`apps/desktop/src/main/services.ts`）：
```ts
// :117-125 异步写盘，缓存更新在 await 之后
async function saveSecrets(secrets) {
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(secrets))
  await writeFile(secretsPath, encrypted)
  secretsCache = secrets
}
// :398-404 所有写入口同步 fire-and-forget，无 .catch
setApiKey: (providerId, apiKey) => {
  const secrets = currentSecrets()   // 旧 cache 引用
  secrets[providerId] = apiKey
  saveSecrets(secrets)               // 未 await
}
```
同 `setUploadSecret`/`setAccessKey`。启动期 `void loadSecrets().then(migrateToolRenames)`（:380）与写入并发。

**为什么是问题**：①连续两次设置密钥，两次 `encryptStringAsync`+`writeFile` 并发，后写可能被先完成的覆盖；②启动预载完成前写密钥，`currentSecrets()` 返回 `{}`，随后 `loadSecrets` 用磁盘内容覆盖内存，本次写入丢失；③写盘失败无反馈，仅靠 `unhandledRejection` 落日志，用户重启后才发现密钥没了。

**建议**：写入口改 `async` + Promise 链串行化（`writeQueue = writeQueue.then(...)`），IPC handler 相应 `await`；`saveSecrets` 内先同步更新 `secretsCache` 再排队落盘；失败 `logger.error` + 向渲染层推错误事件。彻底方案：密钥写入统一收口到单一 `SecretsStore` 类，杜绝散落直写。

### CR-03 · dev 判据双源：`!app.isPackaged` vs `import.meta.env.DEV`
**维度** 8 · 🔴 · 验证 ✅

**证据**：
```ts
// main/index.ts:61 / update-dev-fake.ts:16
const isDev = !app.isPackaged
// renderer/App.vue:253
const isDev = import.meta.env.DEV
// tools/edm-studio/src/main/ipc.ts:62,100 第三套字面表达式
app.isPackaged / !app.isPackaged
```
`package.json:10` 的 `pnpm start`（`electron-vite preview`）使渲染层是 production 构建（`DEV=false`）而进程未打包（`isPackaged=false`）。

**为什么是问题**：同一运行时主进程认为 dev（DevTools 免密、提权闸门跳过、更新走 dev phase）、渲染层认为 build（创建工具隐藏、配置按钮退回 developerMode、devOnly 字段隐藏）。形成"半开发半发布"，既违背 AGENTS.md 铁律，也造成安全边界不一致。

**建议**：单一判据——构建期注入 `__SSHK_DEV__` 到 main + renderer，主进程弃用 `!app.isPackaged` 表示 dev，把"是否源码仓库"（dev-tools 用）拆为独立 `isSourceRepo` 概念。在 AGENTS.md 补 `pnpm start` 归属口径。注意：铁律本体（dev 下功能不被 `developerMode` 关掉）经全项目扫描**未被违反**，`ToolsTab.vue:116` 的 `devFeatures = isDev || appConfig.developerMode` 是标准范例；本条是判据来源问题，不是门控逻辑问题。详见专题 B。

### CR-04 · `fs.ts` 越界：文件浏览运行时整块驻留应用主进程
**维度** 4/11/17 · 🔴 · 验证 ✅

**证据**：`apps/desktop/src/main/fs.ts` 2047 行 `FsRuntime`，在 `index.ts:736-798` 注册 39 个 `fs:*` IPC。交叉验证消费面：`apps/desktop/src/renderer/` 全目录 `window.api.fs` **零命中**；`tools/` 下全部命中仅在 `file-manager/`。

**为什么是问题**：只服务一个工具的代码随应用启动、算入应用体积、无法独立测试/启停。对比：上传服务（upload-core + upload.ts）被 4 个工具消费，留应用层天经地义；文件浏览只被 1 个工具消费却同样留应用层，界线划错。且 plans/12 全篇未覆盖此项——是设计文档盲区，非落地偏差。

**建议**：三方案（A 整体下沉工具层 + 扩展 ToolHostCapabilities 注入密钥；B 逻辑下沉 `packages/fs-core`、壳留应用；C 维持并标注）。**推荐 A**，若担心风险先做 B 再 A。详见专题 A。

### CR-05 · 全主进程违反 `AppError(msg,'validation')` 铁律
**维度** 7/12 · 🔴 · 验证 ✅

**证据**：裸 `throw new Error` 计数——`main/fs.ts` 77 处、`index.ts` 22、`upload.ts` 10、`share-hub.ts` 8、`services.ts` 4；全仓 `new AppError(...,'validation')` 仅 `content.ts:53,61` 两处。`ipc-wrap.ts:45-48` 的 `classifyExpected` 只认 AppError 或少量 SDK 关键词，其余归 `code='unknown'` 并 `console.error` 刷堆栈；`preload/index.ts:21` 又统一 `throw new Error(result.message)` 丢失 code 分类。

**为什么是问题**：plans/03 H1 明确"业务校验失败=预期内、warn 落盘、不刷堆栈"，当前绝大多数是用户输入/配置缺失类预期失败却刷堆栈、UI 无法按 code 分级提示，契约名存实亡。

**建议**：主进程所有面向用户的校验/未找到/权限类错误改 `AppError(msg, 'validation'|'permission'|'io')`；`classifyExpected` 与 preload `invoke` 保留 code；`check:ipc` 增加"IPC 直达路径禁裸 throw new Error"扫描。彻底方案：统一错误工厂，禁止业务代码直接 `new Error`。

### CR-06 · D18 env 门控已删除，注释与文档仍称"唯一真相源"
**维度** 16 · 🔴 · 验证 ✅

**证据**：`main/index.ts:317-318` 明确记载"删除 SSHK_TOOLS_ALLOW_SECRET_MIGRATION env 门控——填口令=加密携带"；全项目 grep 该变量**只命中注释、零读取**，`.env.example` 无此键。但仍称其有效的位置：
- `packages/shared/src/constants.ts:2-3`（"D18 的开关是环境变量 … 唯一真相源见 .env.example"，双重错误：开关已删 + .env.example 并未声明，违反 check-env 契约）
- `packages/backup/src/{crypto.ts:7,export.ts:21,manifest.ts:32}`
- `README.md:73`、`docs/00-index.md:118`、`docs/04-api/2026-11-12-数据契约.md:222-223`、`工具插件化需求台账.md:828,838,846,847`、`2026-11-12-技术选型与任务拆分.md:210-211,232,575`

**为什么是问题**：开发者按文档去设置不存在的开关，功能不会生效；`constants.ts` 的注释还指向一个 check-env 契约外的变量，自相矛盾。

**建议**：统一改为"填迁移口令即加密携带密钥，无 env 开关"；历史设计稿（选型稿/数据契约）加"实现已变更，见 index.ts:317"批注而非改写历史结论。⚠️ 注意：这**不是**"给 .env.example 补登记"的处理方向——开关本体已删除，补登记等于给僵尸变量立契约。

### CR-07 · 字数口径：验收步骤/注释与实现相反
**维度** 16 · 🔴 · 验证 ✅

**证据**：
- 实现（新口径，非空白字符数）：`rich-text/src/word-count.ts:5-6,52-57`（`words = visible.replace(/\s/g,'').length`）、单测 `:48`、入库 `main/content.ts:72`；
- 矛盾方：`packages/shared/src/verify-steps.ts:212` M2 guide "字数与 Word 口径近似（CJK 每字 1、**西文串 1**）"——"西文串 1"正是被实现否定的旧口径；`word-count.ts:13,46` 注释仍写"Word 口径近似"，与同文件 `:5-6,56` 自相矛盾。

**建议**：M2 改为"字数＝非空白字符数（中西文逐字符计 1）"并给可复算例子；`word-count.ts:13,46` 改"中文写作口径（非空白字符数）"；连带 CR-25 核对主进程状态栏"已选 X 字"（`RichTextEditor.vue:258/328` 含空格）与"字数"（不含空格）两个口径。

### CR-08 · 访问密钥参数验收步骤仍用失效的 `?key=`
**维度** 16 · 🔴 · 验证 ✅

**证据**：`packages/shared/src/verify-steps.ts:187` S13 guide "不带 `?key=` 访问 403，带正确 key 可访问"；实现已只认 `?ak=`（`badge-studio/state.ts:875-880` 注释明确"旧 `?key=` 被内核忽略导致 403"，`plans/09:13` 有改名记录）。

**建议**：S13 全文 `?key=` → `?ak=`、"key" → "访问密钥（ak）"。彻底方案：验收步骤中涉及参数名的描述改为引用常量/类型而非硬编码字面量。

### CR-09 · App.vue 重复挂载同一组件
**维度** 6 · 🔴 · 验证 ✅

**证据**：`apps/desktop/src/renderer/App.vue:578` 与 `:580` 两次渲染：
```
578: <CreateToolWizard v-model="createToolOpen" @created="onToolCreated" />
580: <CreateToolWizard v-model="createToolOpen" @created="onToolCreated" />
```
**建议**：删除第 580 行。零风险、纯复制粘贴遗漏。

### CR-10 · share-manager 缺 `assets/icon.svg`（违反项目硬约定）
**维度** 18 · 🔴 · 验证 ✅

**证据**：`tools/share-manager/tool.manifest.json:12` 声明 `"icon": "auto"`，但 `tools/share-manager/` 无 `assets/` 目录；其余 5 个工具均有 `assets/icon.svg`。约定来源 `main/discovery.ts:15`「图标固定 assets/icon.svg」、`renderer/discovery.ts:8-12` 的 glob 扫描——该工具收不到图标，是 6 个工具中唯一无专属图标的。

**建议**：补 `tools/share-manager/assets/icon.svg`（按其他工具 SVG 规范）。若确认为系统能力工具刻意不显示图标，则改 manifest `"icon"` 为显式路径并注明豁免理由，不可放任声明与发现机制脱节。

### CR-11 · edm-studio 三个列表页成片违规且为死代码
**维度** 19 · 🔴 · 验证 ✅（零引用）

**证据**：`tools/edm-studio/src/renderer/pages/{BrandsPage,FragmentsPage,TemplatesPage}.vue` 的品牌/模板/片段功能已并入 `ContentManagePage`，`EdmStudioPage.vue:23-26` 的 pages 映射只保留 `content/mails`，全仓 grep 三文件零引用。三页同时违反：无筛选栏、根容器无留白且写死 `margin-top:8px`、操作栏 `gap:8px` 不居右无归零、表格内 `gap:6px`、危险确认缺 `closeOnClickModal:false/closeOnPressEscape:false`、分页缺 jumper。

**建议**：**首选直接删除三个死文件**（根治全部 6 项违规）；若因追溯需保留则移入 `99-archive/` 并标注"历史、无引用"。不建议按样板改造已死代码。

---

## 二、🟡 重要问题（P1：建议本轮处理）

### 2.1 环境变量（维度 1）

| 编号 | 问题 | 证据 | 建议 |
|---|---|---|---|
| CR-20 | CI 纯环境变量注入 `SSHK_APP_*` 被烤入机制丢弃 | `electron.vite.config.ts:76-86` 只遍历 `.env` 文件的键；`AUTO_UPDATE_DEFINE`(:60-64) 却直读 `process.env`，同文件两路径行为不一 | 烤入键集合取 `envFile ∪ process.env(SSHK_*)`；或在 `.env.example` 明确"CI 必须先落地 .env"；或 check-env 增警告 |
| CR-21 | `SSHK_APP_OVERRIDABLE` 白名单自锁默认失效 | `baked-env.ts:43`；`.env.example:115` 该行默认注释 → 不烤入 → 穿透 process.env，本机可给自己开覆盖权 | 硬编码兜底 `if key==='SSHK_APP_OVERRIDABLE' return BAKED[key]`，或加入必烤入集合 |
| CR-22 | TLS 校验默认关闭 + 注释矛盾 | `.env.example:32-34` 写"未设置=拒绝"，但 `build-local.mjs:32`、`release.mjs:310` 均默认注入 `'0'`（放行） | 修正注释为"local/release 子进程均默认放行，生产 CI 建议显式设 1"；或安全优先默认改 `'1'` |

> 💭 P2：`E4` 注释键名拼写 `SSHK_BUILTIN_TOOLS`/`SSHK_AUTO_UPDATE`（`electron.vite.config.ts:31,57`，被 check-env 刻意剥离注释所以长期存活）；`E5` `.env.example:5` 称 `SSHK_DEV_*` "不烤入"但实际会被烤入（denylist 只挡两个签名键），建议把前缀加入 denylist；`E6` check-env 对动态 `process.env[key]` 是盲点、renderer 冗余注入 `__SSHK_AUTO_UPDATE_DISABLED__`。
> ✅ 敏感信息全通过：`.env` 未入库、模板无真实值、无硬编码密钥、签名私钥不烤入。

### 2.2 死代码 / 声明-使用一致性（维度 2/12）

**门禁盲区**：`tsconfig.base.json:9-10` 的 `noUnusedLocals` **从不报告带 `export` 的符号**；`eslint.config.js` 未配 `no-unused-vars`。故以下 export 死代码门禁零覆盖。

- **CR-23** `shared/constants.ts` 8 个僵尸常量（`DEFAULT_BADGE_ATTR`/`DEFAULT_CLICKS_FIELD`/`DEFAULT_POSTER_WIDTH`/`DEFAULT_CAPTURE_SEGMENT_HEIGHT`/`CONFIG_NAMESPACE`/`OUTPUT_SUBDIRS`/`EDM_OUTPUT_FILES`/`POSTER_OUTPUT_FILES`）全仓零引用，真实值在工具里硬编码（如 `repository/paths.ts:105` 硬编码 `'poster.png'`、`edm-studio/main/ipc.ts:488-490` 硬编码 `'final.html'`）。产物文件名是备份/快照/分享读写路径契约，改一处漏多处。**方案 A（推荐）**：逐一把硬编码点改为 import 常量，加门禁禁 `'final.html'`/`'poster.png'` 字面量；方案 B：删除无人用的常量。
- **CR-24** `packages/ui-kit/src/composables/useSelection.ts`（函数 + `Selection` 类型）全仓零使用，典型 YAGNI 预留。建议删除文件与两行 barrel 导出（或落地到至少一个列表页并登记台账）。
- **CR-25** 重复定义四处：①`ID_PREFIX` 在 `shared/constants.ts:11-20`（死）与 `repository/db.ts:13-26`（活）两份且含义不同——删 shared 版或上收统一；②`FrontLogLevel` 类型 + `logFront` 在 `apps/renderer/front-log.ts`、`ui-kit/front-log.ts` 各一份，加 IPC 边界内联共 4 份——上收 `@sshk/shared`；③`configKey()` 在 `badge-studio/state.ts:19-21`、`model-console/state.ts:15-17` 逐字重复——上收 `toolConfigKey(toolId,key)`；④`verify-steps.ts` 100+ 处工具 id 字面量——改引用 `TOOL_IDS` 或加门禁校验 target 合法性。
- **CR-26** `ToolConfigPage` 类型（`shared/types.ts:50`）被 `ToolDescriptor`/`ToolRuntimeState` 引用，却遗漏在 `shared/index.ts` 的 `export type` 列表外，外部无法从 `@sshk/shared` 导入——补导出。
- 💭 P2：`isImageFileName`（upload-core，零调用）、apps 侧 `logFront` 导出（零 import）、`IpcOk/IpcErr` 公共面大于消费面、`preload/index.ts:17` `Promise<any>` 与 `ipc-wrap.ts:14` `any[]` 可收紧 `unknown`、`ContentManagePage.vue` 8+ 处 `any`、`monaco-setup.ts` 5 处 `@ts-ignore` 建议改 `@ts-expect-error` + `.d.ts`。

### 2.3 重复代码 / 大文件（维度 3/17）

- **CR-30** 列表页「筛选栏+分页+空态+工具栏」整段模式在 11+ 页逐字重复（`RoutesPage`/`ProxiesPage`/`MountsPage`/`PostersPage`/`LogsPage`/`ContentsPage`/`MailsPage` 等：相同 `currentPage/pageSize/paged` computed、相同 `el-pagination` 模板、相同 7 段 CSS）。改一处规范要同步 11 文件。**方案 A（推荐）**：ui-kit 增 `useTablePage<T>()` composable + `ListPageShell.vue`（四个 slot），把 CSS 提到 theme.css；方案 B：最小改动仅提 CSS。
- **CR-31** `CloudProfileForm.vue` / `RemoteProfileForm.vue` 大段逐字重复（props/emits、签名 URL 的 `FormHint detail` 长文案一字不差、密钥 combo、连通性区块、CSS）。**建议**：抽 `SecretField.vue` + `ConnectivityField.vue` + 共享 `SIGN_URL_HINT` 常量。
- **CR-32** 时间抽象已被 `shared/time.ts` 建立，却被 12+ 处绕过：`toLocaleString('sv-SE')`（`badge-studio/state.ts:208,486`、`model-console/ProvidersPage.vue:192,194` 等）、`Date.parse`（`main/content.ts:60,128`、`upload-core/fs-cloud.ts:150,720,745`）、`toLocaleTimeString`（`template-tool/state.ts:25`）。`sv-SE` locale trick 与 dayjs、zh-CN 三口径并存，`toFileName()` 已存在却无人用于导出文件名。**建议**：全量替换 `format()`/`toFileName()`/`toMs()`，扩展 ESLint `no-restricted-syntax` 禁 `toLocale*`（当前门禁只禁 `toISOString`，这是盲区）。
- **CR-33** 分享能力散落 5 处且口径分裂：`ui-kit/share-ticket.ts`、`share-manager/share-util.ts:7-24`（`ttlLeft` 中文文案）、`share-core/index.ts:846`（`ttlMinutesLeft` 数值）、`badge-studio/state.ts:861,877,926`（`findAliveRoute`/`buildShareUrl`）、`file-manager/FileExplorerPage.vue:1119+`（`normSharePath`/`shareMarkOf`）。TTL 一个算分钟一个出文案。**建议**：peer 逻辑收敛 `share-core`，TTL 统一"数值函数 + 展示函数"两层。
- **CR-34** 错误提示样板 `catch(err){ElMessage.error((err as Error).message)}` 在 10+ 页重复。**建议**：ui-kit 增 `useAction().runWithToast(fn,{success,fail})` 统一 try/catch + loading + message（与 CR-05 错误 code 打通）。
- **CR-35** `ToolPageLayout` 覆盖不均：仅 6 处使用，file-manager 全部页 + share-manager 全部页自建 `.page-wrap` 三段式（即 CR-30）。**建议**：规范写明"全屏工作台豁免条款"并统一改走 ToolPageLayout。
- 💭 P2：分享 `shareHubControl` 四方法映射同一通道靠首参区分、契约不透明（`share-manager/host.ts:20-25`），建议显式绑定 action；空态覆盖不均（10+ 手写空态 vs 已抽 `EmptyState`）；host.ts 注释样板重复。

### 2.4 健壮性 / 校验 / 功能完整性（维度 5/7/13/14）

- **CR-38** 自动更新并发竞态：`setupAutoUpdate` 启动时 `checkForUpdates` 与顶栏手动 `updateCheck` 并发同一单例；`autoDownload=true` 与手动 `downloadUpdate()` 两条下载路径并存；`catch` 里 `pushUpdate({phase:'error'})` 可覆盖正常 downloading（`main/index.ts:549-581,1005-1077`）。建议加互斥闸门、统一下载单路径。
- **CR-39** 分片 gate 唤醒丢失：`fs.ts:756-772` `acquireMultipartSlot` 等待中任务被取消/暂停后 `return` 未传递唤醒名额，可致并发饥饿/取消卡住。建议 `release` 时 while 跳过已取消 waiter + 等待取消主动移除自身 + 超时兜底。
- **CR-40** 事件订阅无退订：`onTransferEvent`（preload:350-352）是少数不返回退订函数的订阅，`FileExplorerPage.vue:2026-2031,2052-2062` 挂载订阅但卸载不清理；全项目 `onUnmounted` 仅 1 处。`config.onChanged`/`llm.onDelta`/`update.onState` 均常驻无清理，组件反复挂载后监听器+请求累积。建议订阅统一返回 `removeListener`，卸载清理。
- **CR-41** 媒体会话 Map 只增不减：`media-stream.ts:55-72` `finishMediaDownload` 只置 `done=true` 不删除，`removeMediaDownload` 生产路径零调用，`cleanMediaTemp` 只删临时文件不删 Map 会话（`fs.ts:1075-1085`）。建议完成 60s 后自动移除 + 流 cancel 时移除。连带：`readMedia` 每次预览新建临时文件，建议按路径 hash 复用。
- **CR-43** `contentSave` status 无白名单（`main/content.ts:50-63`）：`const status = input.status ?? 'draft'` 直接信任渲染层任意字符串入库，`types.ts:479` 明明有 4 态定义。非法 status 污染列表过滤（C 公用列表只认 published）。建议 4 态白名单校验 + `AppError(validation)`。
- **CR-44** 分享路由鉴权为"自报身份"软约束（`share-hub.ts:39-42,264-284` 直接采信渲染层传入 toolId），plans/12 §六① 明确"硬校验另立安全项、本轮零改动"——属**已知未做**。既然用户接受破坏性改动，建议本轮纳入：按 `webContents` 绑定可信 toolId，不信任参数。
- **CR-45** `shareHubLogs` 分页全表加载后 slice（`share-hub.ts:312-325`）：`logMaxCount` 上限 10 万，每次分页把全部匹配读入内存再切片，`limit` 钳到 1000 形同虚设；导出无条件全量。建议 NeDB `skip/limit` 游标分页 + 导出流式。
- **CR-55** plans/05 X1 上传 Provider 补齐仅落地 OSS/S3 写能力，COS/七牛仅有元数据（"部分实现"，需二次确认只读范围）；X2 共享能力注册表、X3 工具分类治理未见落地（规划状态 P1/P2 待排期，非 bug）。H6 compact 已落地 ✅，H5 备份冒烟脚本存在性需核对。
- **CR-56** 内容管理双实现：`file-manager/ContentsPage.vue`（496 行通用文章）与 `edm-studio/ContentManagePage.vue`（1484 行 EDM 领域树）是**有意职责分离**（plans/11 明确区分），非错误重叠，但名称相似 + 规模悬殊有维护认知负担。建议文档明确二者数据集合归属（contents vs mail/template），并确认二者共享 `@sshk/file-picker` 单一图片库注入。
- 💭 P2：定时发布 `setInterval` 无句柄不清理且捕获旧 repo（`content.ts:117-142`）；图片库 60 张并发内联无总字节/并发上限（`badge-studio/main/ipc.ts:55-70`）；`TransferPanel.loadMultipart` catch 静默致碎片入口凭空消失。

### 2.5 配置归属与三能力（维度 11，详见专题 A）

- **CR-36** `app.llm.health`（`model-console/state.ts:68-70`）是单工具 UI 缓存却写应用级命名空间 → 下沉 `tools.model-console.health`。
- **CR-37** `app.content.editorMode` 已迁 `tools.file-manager.editorMode`（manifest 已声明），但 `repository/config.ts:177` 仍写 `DEFAULT_SETTINGS`、`ContentsPage.vue:100-102` 仍回落读旧键 → 按 plans/12 总原则"不做双轨"彻底清除默认值与回落读取。

### 2.6 文档规整（维度 10/16，详见专题 D）

- **CR-51** `00-index.md:3` 断链：指向 `02-architecture/优化建议与开发计划.md`，实际文件在 `99-archive/2026-11-16-优化建议与开发计划（已被plans接管）.md`；同行还写死"224 tests / 41 files"违反该行自己声明的"勿手写测试数字"。
- **CR-52** `00-index.md` 元信息过时（v1.3 / 11-17，却已收录 11-20 文档）、`plans/00` 漏登 10/11/12、`docs/verify-sessions/*.json` 3 个未登记、`:49` 空占位 `03-design/`。
- **CR-53** `99-archive/2026-11-16-优化建议与开发计划（已被plans接管）.md` 的 H1-H6/X1-X4/M1 已被 plans/03/05/07 逐条接管，建议确认吸收后删除（用户点名"已被plans接管的该删"）。
- **CR-54** EDM 规划双版本需**复核用户预设**：任务预设 `_v6` 为过时版本，但代码证据相反——`_v6.md:1,3,7` 自称"唯一权威、R12-R24 已落地"，`00-index.md:37-38` 同样定 v6 权威、v5 归档（v5 状态多为"待实现"）。**建议保留 v6，删除/归档 v5**（或把 v5 的 R12-R18 字段级规格并入 v6 附录后删原件）。请勿按预设误删 v6。
- **CR-57** 旧称残留（工具已于 11-19 改名 file-manager）：`文件管理操作行为清单.md:3` 仍写"权威代码 `tools/upload-manager/…`"（路径已不存在）；`上传能力规划.md`、`EDM待收尾与验证清单.md`、`R26-R27协同开工方案.md`、`遗留事项与收尾总账.md`、台账、plans/03/04/08/09/10 多处仍以"上传配置/upload-manager"为当前名称。建议统一写"文件管理（原上传配置/上传管理）"，仅追溯历史时保留旧名。⚠️ 迁移兼容代码（`services.ts:333-366` 等）、IPC 通道 `uploadManagerGet/Set`、`shared/upload-manager.ts` 文件名**必须保留**，不要误改。
- 💭 P2：`SSHK_DEVTOOLS_KEY` vs 实际 `SSHK_APP_DEVTOOLS_KEY` 在台账两处漂移；plans/11 通篇 `app.content.editorMode` 旧键残留；`electron.vite.config.ts:67-71` 注释重复两句。

### 2.7 页面组件与布局规范（维度 19，详见专题 E）

- **CR-60** `ProvidersPage.vue` 手写 `.form-hint`（全仓唯一，其余均用 `<FormHint>`）、写死 `margin-bottom:10px`/`gap:6px`、无筛选栏/分页；`UsagePage.vue` 手写 `.usage-empty`（应用 `EmptyState`）、清空确认缺禁遮罩/ESC、写死 gap、按日筛选例外未注释。建议按样板页统一。
- 💭 P2：全列表页危险操作统一 `ConfirmDialog`（当前散用 `ElMessageBox.confirm` 是 edm 老页漏配禁遮罩的根因）；`TimeText` 未统一（share 系用 `share-util.fmtDateTime`、UsagePage 裸渲染）；弹框局部 padding 覆盖补例外注释。

### 2.8 分层与组织（维度 6/18，详见专题 F）

- **CR-42** `App.vue` 583 行上帝组件，`<script setup>` 348 行混合 7 类职责（主题/时钟/自动更新/运行时组件加载/新工具扫描/关闭确认/侧栏路由）。建议抽 `useRuntimeComponent`/`useNewToolScan`/`useUpdateBanner` + `AppHeader.vue`/`StatusBar.vue`；`main.ts:36` import 位置异常且唯一双引号，上移统一。
- **CR-58** `edm-studio` 渲染层根散落 6 个 `.vue` 组件 + 8 个逻辑 `.ts`，无 `components/`；`file-manager` 组件位置分裂（根 2 个表单 + `components/` 1 个）；`pages/` 混入非菜单页（`*Dialog.vue`/`*Core.vue`/`content-export.ts`）。建议以 `badge-studio` 为样板：组件进 `components/`、纯逻辑进 `core/`、渲染态进 `composables/`、`pages/` 只留 `*Page.vue`。
- **CR-59** `src/core/` 只有 2/6 工具有；`state.ts` 命名/位置无统一约定。建议定"与 UI 无关的纯函数 → `core/`；渲染态 → `renderer/composables/`"，并在 AGENTS.md 写明判据。
- 💭 P2：`discovery.ts` 两层同名但语义不同（建议改 `plugin-discovery.ts`）；类型声明三处分散（建议收敛 `src/types/`）；`@sshk/shared` 已成杂物包（建议按域建子目录或拆包）。

---

## 三、专题 A · 三个基础能力分层（维度 11）

### A.1 代码分布矩阵

| 能力 | 应用层 `apps/desktop` | 共享层 `packages/*` | 工具层 `tools/<id>` |
|---|---|---|---|
| **模型** | `services.ts`（Provider/密钥/宿主能力 L127-143,277-296）、`index.ts`（`llm.*` 7 IPC L584-684）、`usage.ts` | `llm-gateway/`（gateway.ts 纯函数内核）、`shared/types.ts`（LlmProvider/ToolHostCapabilities） | `model-console/`（纯 UI、src/index.ts 空、host.ts 消费 config/llm/usage/os） |
| **分享** | `share-hub.ts`（375 行生命周期 + 全部 IPC + 日志持久化）、`index.ts` 装配/resolver 注入 | `share-core/`（851 行注入式 HTTP 内核）、`shared/types.ts`（ShareRoute* 等）、`repository shareLogs` | `share-manager/`（纯 UI、src/index.ts 空、6 个 pages） |
| **上传/文件管理** | `upload.ts`（365 行）、**`fs.ts`（2047 行 + 39 IPC）**、`services.ts`（密钥迁移链）、`index.ts`（upload.* + fs.*） | `upload-core/`（service.ts 112 行）、`shared/`（upload-vendors/file-kinds）、`file-picker/upload-dedupe` | `file-manager/`（纯 UI，host.ts 无 fs:*，FileExplorerPage 50+ 处 `window.api.fs.*` 裸调） |

### A.2 结论：骨架合理，偏差在「下沉」不在「上提」

✅ **合理的骨架**：三内核（llm-gateway/share-core/upload-core）都在共享层、密钥一律应用层 safeStorage、UI 全在工具层、plans/12 的 23 项拍板经代码复核**全部落地无虚报**。模型是标杆：Provider + 密钥在应用层，所有工具经 `host.chatByProvider` 复用，工具零接触密钥。

🔴 **需下沉**：CR-04（fs.ts → file-manager 工具层）。这是唯一结构性错配，也是用户问题的直接答案。

🟡 **配置归位（下沉）**：CR-36（`app.llm.health` → `tools.model-console.health`）、CR-37（清 `app.content.editorMode` 残留）。

❌ **无能力需要"上提到应用层"**：该在应用层的（模型 Provider/密钥、上传 profile/密钥 `app:upload:*`、分享内核/服务参数）都已在，plans/12 阶段该上提的（密钥命名空间提升、日志持久化）也已完成。当前待办集中在下沉方向。

💭 **抽象统一机会**：三能力对外暴露不一致——模型既有 `ToolHostCapabilities`（chatByProvider/listProviders）又有 `llm.*` IPC 双轨，上传/分享仅 IPC（`ToolHostCapabilities` 无 upload/shareHub 条目）。建议补齐 capabilities，让新工具像消费模型一样消费上传/分享，并顺势收敛 `window.api.*` 裸调（也是 CR-04 方案 A 的前置）。

### A.3 三能力「上提 / 下沉 / 维持」总表

| 能力 | 建议上提 | 建议下沉 | 维持现状 |
|---|---|---|---|
| 模型 | 无 | 🟡 `app.llm.health` → 工具层 | llm-gateway 内核、`app.llm.*` 权威配置与密钥、`host.chatByProvider`、model-console UI |
| 分享 | 💭 日志查询/CSV 纯逻辑可抽 share-core 便于测试 | 无（UI 已在工具层）；路由硬校验另立安全项 | share-core 内核、`shareHub:*` IPC、`app.shareHub.*` 服务参数、share-manager UI |
| 上传/文件管理 | 无（密钥已提升到位） | 🔴 fs.ts + 39 `fs:*` IPC → file-manager；🟡 `app.content.editorMode` 残留清除 | upload-core 内核、UploadRuntime、`app.upload`+`app:upload:*`、`tools.<id>.upload` 覆盖 |

---

## 四、专题 B · dev / build / developerMode 三态（维度 8）

### B.1 三态行为矩阵

| 功能 | dev (`pnpm dev`) | build 普通用户 | build + developerMode | 证据 |
|---|---|---|---|---|
| 创建工具/分发白名单/devOnly 字段 | ✅ | ❌ | ❌ | `App.vue:417`、`ToolsTab.vue:210,231`、`SettingsPage.vue:59` |
| 开发者模式开关 | ✅ 免口令 | ✅ 需口令 | ✅ 可关闭 | `GeneralTab.vue:26`、`index.ts:349-350` |
| 工具全量列表 + 配置按钮 | ✅ | ❌ 仅 manageableTools | ✅ | `ToolsTab.vue:116-118,242` |
| 展示定制→图标字段 | ✅ | ❌ | ⚠️ 隐藏（疑点） | `ToolsTab.vue:272` 用 `isDev` 而非 `devFeatures` |
| 验证引导顶栏入口 | ✅ | ❌ | ⚠️ 显示但切换开关后需重载 | `App.vue:259-260,410`（CR-46） |
| DevTools 打开 | ✅ 免密 | ✅ 需口令 | ✅ 会话缓存 | `index.ts:399-413` |
| EDM 系统内容编辑 | ✅ 全权 | ❌ 只读 | ✅ 可编辑 | `edm-studio/main/ipc.ts:99-104` |
| dev 辅助通道（清单/构建/打包） | ✅ 由源码仓库探测 | ❌ | ❌ | `dev-tools.ts:34-45,92-101` |

> 注：`pnpm start`（preview）会落"主进程 dev / 渲染层 build"分裂态（CR-03），矩阵无法覆盖。

### B.2 其余发现

- **CR-46** `App.vue:258-260` `developerModeOn` 一次性读取，主进程已推送 `configChanged`（`index.ts:365`）、preload 已暴露 `onChanged`（`preload/index.ts:31-33`），但**全项目无渲染层监听**。打包版开关开发者模式后"验证引导"按钮不即时变化，需重载；而 ToolsTab 走 `useAppConfig` 单例能刷新，两入口行为不一。建议订阅 `config.onChanged` 或复用 `useAppConfig` 同源。
- **CR-47** `SSHK_DEV_*` 被无条件烤入产物（`electron.vite.config.ts:75-86` 只挡签名键），与 `.env.example:5`"不烤入"契约矛盾。功能上靠 `isDev` 兜底 inert，但契约破坏——今后任何打包版代码漏写 isDev 守卫即意外生效。建议把 `SSHK_DEV_` 前缀加入 denylist（与 E5 同一修复）。
- **CR-48** `ToolsTab.vue` `isDev` 与 `devFeatures` 语义交错且无分节注释：`:272` 图标字段在 build+developerMode 下隐藏属"应显示却隐藏"疑点——若 developerMode 应能改图标则改 `v-if="devFeatures"`，否则加注释说明图标涉及源码只允许 dev 改。`dev-tools.ts:4-6` 注释称"打包版自动禁用"实为路径探测副作用，建议 `findRepoRoot()` 入口加 `if (app.isPackaged) return null`。
- 💭 P2：缺统一三态裁决入口（5 处各自手写，建议 shared 纯函数 `isDevFeatureEnabled(isDev, developerMode)` + 主进程单一注入 dev 标志）；`devOnly` 字段 build+developerMode 隐藏属刻意设计，建议字段旁提示避免困惑；`SSHK_APP_*`/`SSHK_DEV_*` 构建旋钮是否受铁律约束建议在 AGENTS.md 明确（当前更新测试在 dev 分支下套 env 条件，属测试脚手架，倾向合规）。

### B.3 铁律符合性结论

✅ **dev 下功能被配置变量关掉**：未发现。所有 `developerMode` 业务读取点均有 `isDev ||` 兜底或只在打包分支生效。
✅ **主进程读用户配置决定 dev 通道可用性**：未发现。`dev-tools.ts` 纯仓库探测，不读配置。
✅ **正面范例**：`ToolsTab.vue:115-118`（标准总开关）、`GeneralTab.vue:26`（dev 直过）、`main/index.ts:349-350,399-413`（dev 闸门跳过）、`edm ipc.ts:99-104`（dev-first 门控）。

---

## 五、专题 C · 重复代码与大文件（维度 3/17）

### C.1 大文件 Top15（wc -l 实测）

| # | 行数 | 文件 | 判断 |
|---|---|---|---|
| 1 | 3039 | `tools/file-manager/src/renderer/pages/FileExplorerPage.vue` | 🔴 真·上帝组件 |
| 2 | 2047 | `apps/desktop/src/main/fs.ts` | 🔴 越界 + 应下沉后拆（CR-04） |
| 3 | 1549 | `packages/file-picker/src/components/FilePickerDialog.vue` | 🟡 三个 tab 天然可拆 |
| 4 | 1484 | `tools/edm-studio/src/renderer/pages/ContentManagePage.vue` | 🟡 script 占 1185 行 |
| 5 | 1131 | `apps/desktop/src/main/index.ts` | 🟡 注册中心，按域拆 |
| 6 | 1088 | `tools/badge-studio/src/renderer/state.ts` | 🟡 按职责簇拆 |
| 7 | 890 | `packages/upload-core/src/providers/fs-cloud.ts` | ✅ 单一云驱动，不建议强拆 |
| 8 | 851 | `packages/share-core/src/index.ts` | 🟡 ShareHub 单类约 700 行 |
| 9 | 778 | `tools/edm-studio/src/main/ipc.ts` | ✅ 主进程 handler 聚合，可接受 |
| 10 | 660 | `tools/badge-studio/src/renderer/pages/GeneratePage.vue` | 🟡 可拆 |
| 11 | 629 | `packages/shared/src/types.ts` | ✅ 纯类型聚合 |
| 12 | 625 | `packages/ui-kit/src/components/ShareDialog.vue` | ✅ 内聚 |
| 13 | 603 | `tools/file-manager/src/renderer/pages/ProfilesPage.vue` | ✅ 内聚 |
| 14 | 590 | `packages/shared/src/fs.ts` | ✅ 纯函数聚合 |
| 15 | 582 | `apps/desktop/src/renderer/App.vue` | 🟡 上帝组件（CR-42） |

> 澄清：任务预设点名的 `ContentEditorCore.vue`（191 行）、`ComposeEditor.vue`（167 行）**并非大文件**；真正的大头是上表前 6 名。

### C.2 拆分建议（先逻辑后模板）

- **FileExplorerPage.vue（3039）**：script 1-2080 含 11 类职责簇（导航/选择/视图列/目录操作/预览/搜索/用量/压缩转码/上传重名/分享/下载/权限属性/传输）。抽 composables：`useFsNavigation`/`useFsSelection`/`useFsView`/`useFsSearch`/`useFsUpload`/`useFsShare`/`useFsTransfer`/`useFsConfig`；抽组件：`FileTable.vue`/`PathBar.vue`/`FilterBar.vue`/`PreviewPane.vue`/`FsDialogs.vue`。已有 `TransferPanel.vue` 是正确范例。
- **fs.ts（2047）**：先按 CR-04 下沉工具层，再拆 `FsBrowser`/`FsTransferQueue`/`FsArchive`/`FsMetadata`。
- **FilePickerDialog.vue（1549）**：三个 tab（upload/gallery/selected）是天然边界，拆三个 Tab 组件 + `useUploadPool`（:263-305）+ `useDirPicker`（:317-438）。
- **ContentManagePage.vue（1484）**：拆 `useContentTree`/`ContentEditors`/`useCssTabs`/`useContextMenu`/`SaveAsDialog`。
- **index.ts（1131）**：已有 `handleOk` 抽象，按域拆 `registerFs/registerContent/registerUpload/registerShareHub/registerUpdater`，主入口只装配。

### C.3 值得肯定的抽取（保持）

`createSafeHost`（`ui-kit/safe-host.ts:29-57`，双层 Proxy + 三层兜底，6 个 host.ts 仅声明通道表）、`useToolId`、`FormGrid`/`FormHint`、`ToolPageLayout:16-32`（useSlots 条件渲染）、`shared/time.ts`、`share-util.ts:27-29`。

---

## 六、专题 D · 文档规整与一致性（维度 10/16）

### D.1 规整清单

| 决策 | 文档 | 理由 |
|---|---|---|
| 🗑 删除 | `99-archive/2026-11-16-优化建议与开发计划（已被plans接管）.md` | H1-H6/X1-X4/M1 已被 plans/03/05/07 逐条接管，确认吸收后删（CR-53） |
| 🗑 删除/归档 | `EDM系统内容页改造与内容管理统一规划.md`（v5） | v6 才是权威，v5 状态多为"待实现"（CR-54，⚠️与任务预设相反，请勿删 v6） |
| ✏️ 更新 | `00-index.md` | 修断链、删写死测试数、版本→v1.4、补登 11-20 文档 + plans/10~12 + verify-sessions、删 `03-design/` 占位（CR-51/52） |
| ✏️ 更新 | `plans/00-规划总览.md`、`plans/11`、`plans/12` | 补登 10/11/12；plans/11 旧键加批注；plans/12 §6 总原则澄清适用范围（仅本档新设计，否则与全局迁移策略矛盾） |
| ⏸ 暂不动 | `2026-11-20-全仓CodeReview与重构建议.md` | 台账 #147 状态"待逐项拍板"未闭环；拍板结论落定后再整体移入 99-archive 并更新索引（本报告不读其内容） |
| ✅ 保留（门禁强依赖） | `2026-11-12-技术选型与任务拆分.md`、`04-api/2026-11-12-数据契约.md` | `verify-structure.mjs:67-68` 路径硬编码，勿删 |

**CHANGELOG 检查**：历史事故确凿（`0e76abe` 曾手工写入后被还原，台账 #66），但当前对 `^\*[^\]]*$`（无 commit 链接条目）零命中，**现状干净**。建议 release 前置门禁加"CHANGELOG 必须由 release.mjs 生成"的结构校验防复发。

### D.2 一致性问题（用户重点强调项）

| 编号 | 问题 | 性质 |
|---|---|---|
| CR-06 | D18 env 门控已删，注释 + 6 文档仍称"唯一真相源" | 🔴 必改 |
| CR-07 | 字数口径：验收 M2 + word-count 注释与实现相反 | 🔴 必改 |
| CR-08 | `?key=` 旧参数残留验收 S13 | 🔴 必改 |
| CR-57 | "上传配置/upload-manager"作为当前名称在 9+ 文档残留 | 🟡 批量替换 |
| — | `SSHK_DEVTOOLS_KEY` 漂移为 `SSHK_APP_DEVTOOLS_KEY`（台账 2 处） | 💭 |
| — | plans/11 通篇 `app.content.editorMode` 旧键（新键见 verify-steps M14 ✅） | 🟡 |
| — | dev 铁律"dev 两种模式全量可切"与 `ContentsPage.vue:92-105` dev 下仍读配置决定 pageMode 口径不一 | 🟡 需澄清措辞 |

✅ **一致性通过的规范**：留白规范（`页面留白与间距规范.md` 4 token 与 `theme.css:17-20,406` 完全一致，`ContentsPage.vue:475` 落地无写死覆盖）、列表页规范（`列表页筛选与操作栏规范.md` 与 `ContentsPage.vue:314-357,475-487` 逐条对齐）。

---

## 七、专题 E · 页面组件与布局规范（维度 19）

### E.1 列表页规范符合度对照

| 页面 | label+.f-item | 180/360 宽 | 秒级时间+inMsRange | 查询+重置 | 操作栏居右紧凑 | 顺序 | 留白+token | 组件统一 |
|---|---|---|---|---|---|---|---|---|
| ContentsPage（样板） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅自管 | ✅ |
| LogsPage（样板） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅自管 | 💭fmtDateTime |
| Routes/Proxies/MountsPage | ✅ | ✅ | 💭无筛选 | ✅ | ✅ | ✅ | ✅自管 | 💭fmtDateTime |
| MailsPage | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ToolPage | ✅ |
| PostersPage | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ToolPage | ✅ |
| **Brands/Fragments/TemplatesPage** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌确认未禁遮罩（CR-11 死代码，建议删） |
| ProvidersPage | ❌ | ⚠️ | 💭 | ❌ | ⚠️ | ❌ | ⚠️写死px | ❌手写 FormHint（CR-60） |
| UsagePage | ❌ | 💭 | 💭按日例外 | ❌ | ⚠️ | ❌ | ⚠️写死gap | ❌手写空态（CR-60） |

### E.2 结论

主流列表页（7 个）规范度很高，`ContentsPage`/`LogsPage` 可作复制样板。问题集中在 edm 三个死代码页（CR-11，删即根治）与 ProvidersPage/UsagePage 两个统计/配置型页（CR-60）。**全项目合规项**：`label-width="auto"` 全面合格（固定 px 仅隐藏挂载例外）、开关文字同排、弹框口径（`theme.css:628-631`）基本统一、无"用 ToolPageLayout 又重复写 padding"的页面、自管根容器页均已显式 padding+box-sizing。

---

## 八、专题 F · 目录组织与命名（维度 9/18）

### F.1 六个工具包组织结构横向对比

| 工具 | 目录名=id | 唯一 `*Page.vue` | `pages/` | host.ts | main 入口 | assets/icon.svg | 评价 |
|---|---|---|---|---|---|---|---|
| badge-studio | ✅ | ✅ | 2 全 `*Page.vue` | ✅ | ✅ 有 | ✅ | **最佳样板** |
| template-tool | ✅ | ✅ | 3 全 `*Page.vue` | ✅ | ✅ 有 | ✅ | 良好 |
| model-console | ✅ | ✅ | 3 全 `*Page.vue` | ✅ | ⬜ 空（一致） | ✅ | 良好，逻辑散落 |
| share-manager | ✅ | ✅ | 7 含 2 `*Dialog.vue` | ✅ | ⬜ 空（一致） | 🔴 **缺失**（CR-10） | 唯一硬约定违规 |
| file-manager | ✅ | ✅ | 7 含 2 组件+1 `.ts` | ✅ | ⬜ 空（一致） | ✅ | 组件位置分裂（CR-58） |
| edm-studio | ✅ | ✅ | 5 全 `*Page.vue` | ✅ | ✅ 有 | ✅ | **最散乱**（CR-58） |

> 样板排序：badge-studio → template-tool → model-console → share-manager → file-manager → edm-studio。

### F.2 命名规范

- 🟡 **CR-49** manifest `name` 中英混杂：badge/edm/model 英文、file/share 中文、template 带括号说明（3 英 3 中）。建议统一中文名（英文品牌可保留副标题）。
- 💭 **CR-50** composable 文件名 camelCase（`useToolId.ts`/`useUpdater.ts` 等 6 个）与全项目其余 kebab-case 并存。建议写入规范作为例外，而非视为违规。
- ✅ 工具 id 6 个全 kebab-case 且与目录名一致（`main/discovery.ts:41-44` 强校验）、菜单 id kebab-case、常量 UPPER_SNAKE_CASE、`@sshk/*` 前缀 17 处零例外。

### F.3 分层结论

✅ 零越界：renderer 全目录无 `electron`/`node:fs`/`BrowserWindow` 引用，main 无 `.vue`/`element-plus`/`document.`/`window.api` 引用。preload 桥接与脱壳分离设计合理。
🟡 其余见 CR-42（App.vue）、CR-58/59（工具组织）、CR-26（shared 杂物包，建议按域建子目录）。

---

## 九、环境变量声明 ↔ 使用对照（维度 1）

26 个模板声明变量全部有读取点、无死变量；框架/外部注入 7 键经 `EXTERNAL_KEYS` 放行；子进程写入 3 键不读取（符合预期）。完整 26 行对照见审查原始记录，此处列关键风险项：

| 变量 | 读取点 | 状态 |
|---|---|---|
| `SSHK_APP_DEVTOOLS_KEY` | `dev-access.ts:23`、`diagnostics.ts:95` | ⚠️ CR-20/21 |
| `SSHK_APP_OVERRIDABLE` | `baked-env.ts:25` | ⚠️ CR-21（自锁失效） |
| `SSHK_APP_AUTO_UPDATE` | `electron.vite.config.ts:62`、`index.ts:69` | ⚠️ CR-20 + E4 注释错名 |
| `SSHK_BUILD_TOOLS` | `electron.vite.config.ts:38` | ⚠️ E4 注释写错为 `SSHK_BUILTIN_TOOLS` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `build-local.mjs:32`、`release.mjs:310` | ⚠️ CR-22（默认放行） |
| `SSHK_DEV_*`（5 个） | `update-dev-fake.ts` 等 | ⚠️ CR-47/E5（实际被烤入） |

**机制层面做得好的**：`check-env.mjs` 双向契约 + `stripComments()` 边界处理、`baked-env.ts:43` 的 `&&` 短路递归防护、签名键 denylist、类型声明覆盖完整。

---

## 十、做得好的地方（应保持）

1. **三端分层与包命名**：零越界、`@sshk/*` 全统一、`index.ts` barrel 规范。
2. **核心抽象**：`createSafeHost` + 6 个 host.ts（零裸调样板，file-manager 的 fs:* 是成片例外待收敛）、`useToolId`（21 处调用，彻底消除工具 id 字面量）、`FormGrid`/`FormHint`/`ToolPageLayout`、`shared/time.ts` + 双门禁。
3. **字数统计单一实现**：`countText`/`countHtmlWords` 集中在 rich-text，主进程经 `/pure` 复用，无第二份（仅注释/验收口径需修，CR-07）。
4. **env 体系**：双向契约门禁、无死变量、无泄露、烤入/覆盖两层语义清晰。
5. **IPC 契约**：`IpcResult`/`AppError` + `check-ipc` 门禁，声明/实现/门禁三者一致（CR-05 是消费端未遵守，非契约设计问题）。
6. **工具 id 改名迁移链**：`services.ts:333-378` 幂等 first-wins 迁移（upload-config → upload-manager → file-manager）、密钥命名空间 `app:upload:*` 提升，已落地。
7. **plans/12 全量落地**：23 项拍板经代码复核无虚报，唯一偏差（configLayout=single + 菜单承载）文档如实记录。
8. **列表页主流规范度**：7 个列表页高度合规，样板清晰。

---

## 十一、待拍板事项（请逐项确认后我再执行）

| 编号 | 待拍板 | 我的建议 |
|---|---|---|
| P-1 | CR-04 下沉方案选 A（整体下沉工具层 + 扩 capabilities）还是 B（先抽 fs-core） | 选 A；若求稳先 B 再 A |
| P-2 | CR-11 edm 三个死代码页：直接删除还是归档 | 直接删除 |
| P-3 | CR-54 EDM v5/v6 主从：确认 v6 权威、删 v5（与任务预设相反） | 保留 v6，删/归档 v5 |
| P-4 | CR-53 `99-archive` 优化建议文档：确认已被 plans 吸收后删除 | 删除 |
| P-5 | CR-48 build+developerMode 下"图标字段"应否可改 | 按产品意图定，倾向可改（`devFeatures`） |
| P-6 | CR-44 分享路由硬鉴权是否本轮纳入（plans/12 原定另立安全项） | 既然接受破坏性改动，建议纳入 |
| P-7 | CR-55 COS/七牛 Provider 写能力是否补齐 | 需确认只读范围是否已满足业务 |
| P-8 | CR-05 错误工厂/CR-34 runWithToast 是否一并引入（涉及面广） | 建议与 AppError 治理同批做 |
| P-9 | CR-03 `pnpm start`（preview）归入 dev 还是 build | 倾向归入 dev（源码运行即 dev） |
| P-10 | 本报告是否登记入台账 #147 之后作为 #148，并是否登记 00-index | 建议都登记（项目铁律要求） |

---

## 十二、建议重构批次（均不考虑兼容）

| 批次 | 内容 | 条目 | 风险 |
|---|---|---|---|
| **第 1 批·正确性修复** | conflict 失效、密钥竞态、重复组件、缺图标、三处一致性口径（D18/字数/`?ak=`）、contentSave status | CR-01/02/09/10/06/07/08/43 | 低-中，建议立即做并补单测 |
| **第 2 批·契约与判据统一** | AppError 治理 + 错误工厂、dev 判据单一源、env 烤入契约、配置变更订阅 | CR-05/03/20~22/46/47 | 中，涉及面广但纯重构 |
| **第 3 批·结构性下沉** | fs.ts 下沉工具层 + capabilities 扩展 + fs 裸调收敛 + fs.ts 拆分 | CR-04/39 + C.2 | 高，需专项设计后执行 |
| **第 4 批·抽象收敛** | 列表页 shell + useTablePage、SecretField、时间口径、分享 TTL、错误提示 | CR-30~35 | 中 |
| **第 5 批·健壮性** | 更新竞态、订阅退订、媒体会话、日志分页、路由鉴权 | CR-38/40/41/44/45 | 中 |
| **第 6 批·组织与文档治理** | 工具包结构统一、App.vue 拆分、大文件拆分、文档规整、旧称替换 | CR-42/58/59/51~54/57 + 专题 C | 低-中，可按文件逐步 |

---

## 附录 · 审查方法说明

- 9 个维度并行深读：环境变量、声明/使用一致性、重复抽象与边界、分层组织命名、dev/build/developerMode、缺陷健壮性完整性、三能力分层、文档规整一致性、页面组件布局规范。
- 全部 🔴 级结论均回源码交叉验证（本报告各条"验证"列标注 ✅）；标注"需二次确认"的条目（CR-55 只读范围、CR-56 图片库注入共享、H5 脚本存在性）未下最终结论。
- 门禁脚本（check-env/boundaries/ipc/contract/structure 等）作为约束参考，但重点发现其覆盖盲区：export 死代码、动态 env 读取、时间 locale 写法、工具 id 数据表字面量、裸 `throw new Error`。
- 本次为只读审查 + 落档，**未修改任何源码、未修改禁读文档 #147**；后续处理待用户按第十一节拍板。
