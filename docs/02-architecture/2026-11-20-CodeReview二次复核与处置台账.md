# 全仓 Code Review 二次复核与处置台账（2026-11-20）

- 状态：**二次复核完成**（全部条目回源码核验 + 分类处置；待用户拍板项集中于 §六）
- 版本：v1.0
- 日期：2026-11-20（北京时间）
- 仓库根：`D:/workspace/code/sshk-tools`（分支 `main`）
- 复核对象：
  - **报告A** = `2026-11-20-独立全仓深度CodeReview报告.md`（CR-01~60，台账 #148，声明未参照报告B）
  - **报告B** = `2026-11-20-全仓CodeReview与重构建议.md`（H1~H8 / M1~M16 / L1~L12 等，台账 #147）
- 处置原则（用户 2026-11-20 明确）：
  1. 不考虑兼容性、彻底重构、禁止打补丁；
  2. 已确定且无异议的直接改，分批 verify → commit → push → 核验 message；
  3. 多方案/架构/产品意图类**落档待用户逐项拍板，不擅自做主**；
  4. 所有复核必须落档，待决策项统一位置（§六）；
  5. 工具⇄应用升降级专项单独分析（§五）；
  6. 可复用能力留应用层、规划组织结构（§五.3）。

---

## 〇、复核方法与证据口径

- 逐项打开报告点名的文件与行号，确认**当前源码真实状态**，不照抄报告结论。
- 判定分级：✅ 属实 / ⚠️ 部分属实（方向对但计数/范围夸大）/ ❌ 误报（与源码不符或属故意设计）/ 📋 待用户决策。
- 处置分类：`已直接改` / `故意设计暂不动` / `待用户决策` / `误报不改` / `补漏新增`。
- **证据可复算**：每条给出 `文件:行号`，可 `grep`/`sed` 复核。
- 本报告A、B 独立产出、编号不对应，对同一事实的相反结论单列 §四 冲突清单。

---

## 一、复核结论总览

| 分类 | 数量 | 说明 |
|---|---|---|
| ✅ 属实且已直接改 | 14 项 | 文档口径 4 + 纯 bug 3 + 图标 1 + 危险操作漏报 8（其中重叠按项计）|
| ✅ 属实待用户决策 | ~30 项 | 架构/多方案/产品意图，见 §六 |
| ⚠️ 部分属实 | 5 项 | 方向对、计数或范围夸大 |
| ❌ 误报（当前态） | 8 项 | 与源码不符 / 已被修复 / 属故意设计 |
| 🆕 漏报（本次新增） | 4 类 | 报告未点名，本次复核发现 |

---

## 二、已直接改条目（无异议、确定性修复，已提交推送）

| 批次 | 条目 | 判定 | 改动 | 提交 |
|---|---|---|---|---|
| 批1 | CR-09 App.vue 重复挂载 CreateToolWizard | ✅ | 删 `App.vue:580` 重复组件 | `4e879fb` |
| 批1 | CR-06 D18 env 残留注释 | ✅ | `constants.ts:2-3` 改"已删除 env 门控，填口令即加密携带" | `4e879fb` |
| 批1 | CR-07 字数口径矛盾 | ✅ | `verify-steps.ts:212` M2 + `word-count.ts:13,46` 注释统一为"非空白字符数，中西文逐字符计 1" | `4e879fb` |
| 批1 | CR-08 `?key=` 旧参数 | ✅ | `verify-steps.ts:187` S13 `?key=`→`?ak=`、"key"→"访问密钥（ak）" | `4e879fb` |
| 批1 | CR-26 `ToolConfigPage` 漏导出 | ✅ | `shared/index.ts` 的 `export type` 列表补 `ToolConfigPage` | `4e879fb` |
| 批1 | CR-43 contentSave status 无白名单 | ✅ | `content.ts` 加 4 态白名单（`draft/published/retracted/scheduled`）+ `AppError(validation)` | `4e879fb` |
| 批2 | CR-10 share-manager 缺图标 | ✅ | 新建 `tools/share-manager/assets/icon.svg`（与其余工具同风格） | `3a0acf5` |
| 批2 | 🆕 危险操作缺禁遮罩/禁 ESC（漏报） | ✅ | 补 8 处：`App.vue:86` 退出、`SystemTab:148` 降级 /`:222` 清空快照、`ToolsTab:145` 禁用依赖、`UsagePage:104` 清空用量、`ContentManagePage:835/929/1008` 丢弃/覆盖/删除 | `3a0acf5` |

> 两批均 `pnpm verify` 全绿（13 门禁 + typecheck + lint + build + 70 files / 467 tests），commit 后已 `git log -1` 核验 message，并 `git push origin main` 成功（`7c55f32..3a0acf5`）。

---

## 三、逐条判定明细（报告A CR-01~60）

### 3.1 🔴 阻断级

| 条目 | 判定 | 证据 / 理由 | 处置 |
|---|---|---|---|
| CR-01 conflict 被 success 覆盖 | ✅ 属实 | `fs.ts:706-709` 冲突 `setStatus('conflict')` 后普通 `return`；`:672` execute 无条件 `setStatus('success')` 覆盖 | 📋 待决策 Q-01（A 抛信号 / B 返回枚举两方案）|
| CR-02 密钥写竞态 + fire-and-forget | ✅ 属实 | `services.ts:117-125` `saveSecrets` 在 await 后才更新 cache；写入口无 `.catch`、无串行化；启动 `loadSecrets` 并发 | 📋 待决策 Q-02（SecretsStore 收敛）|
| CR-03 dev 判据双源 | ✅ 属实 | main `!app.isPackaged` vs renderer `import.meta.env.DEV`；`package.json:10` `pnpm start` = preview → 分裂态 | 📋 待决策 Q-05 + Q-06 |
| CR-04 fs.ts 越界只服务 file-manager | ⚠️ 部分属实 | `fs.ts` 2047 行属实；`window.api.fs` renderer 零命中、仅 file-manager 两文件命中属实；但"39 个 IPC"夸大（唯一通道约 30 个，handler 36） | 📋 待决策 Q-03（用户第10条重点）|
| CR-05 全主进程违反 AppError 铁律 | ✅ 属实（范围扩大） | apps main 裸 throw 121 处属实；**本次新发现 tools main 另有 66 处**（edm ipc 49 + badge ipc 17），报告漏扫 | 📋 待决策 Q-15（治理范围）|
| CR-06 D18 env 残留 | ✅ 属实 | `index.ts:317` 明确记载删除门控；全仓 grep 该变量只命中注释/文档、零代码读取 | ✅ 已改（constants）+ 文档残留见 §三.4 |
| CR-07 字数口径矛盾 | ✅ 属实 | 实现=非空白字符数（`word-count.ts:5-6,52-57`）；注释 + 验收写旧口径 | ✅ 已改 |
| CR-08 `?key=` 旧参数 | ✅ 属实 | `verify-steps.ts:187`；内核只认 `?ak=` | ✅ 已改 |
| CR-09 重复组件 | ✅ 属实 | `App.vue:578` 与 `:580` 完全相同 | ✅ 已改 |
| CR-10 缺图标 | ✅ 属实 | manifest `"icon":"auto"` 但无 assets 目录；其余 5 工具均有 | ✅ 已改 |
| CR-11 edm 三死代码页 | ✅ 属实（零引用） | `BrandsPage`/`FragmentsPage`/`TemplatesPage` 全仓零引用 | 📋 待决策 Q-09（删 vs 归档）|

### 3.2 🟡 重要问题

| 条目 | 判定 | 证据 / 理由 | 处置 |
|---|---|---|---|
| CR-20 CI env 烤入丢失 | ✅ 属实 | `electron.vite.config.ts` 只遍历 `.env` 键，`process.env(SSHK_*)` 被丢 | 📋 待决策 Q-17 |
| CR-21 Overridable 白名单自锁失效 | ❌ 误报 | `baked-env.ts:43` 已有 `key !== 'SSHK_APP_OVERRIDABLE' && ...` 自身锁死，报告描述与源码不符 | 不改（报告应撤条）|
| CR-22 TLS 默认放行与注释矛盾 | ✅ 属实 | `.env.example:32-34` 写"未设置=拒绝"，`build-local.mjs:32`/`release.mjs:310` 默认注入 `'0'` | 📋 待决策 Q-17 |
| CR-23 8 个僵尸常量 | ✅ 属实 | `constants.ts` 8 常量全仓零引用；真实值在 `repository/paths.ts:105` 等硬编码 | 📋 待决策 Q-16（A 改硬编码点 import / B 删常量）|
| CR-24 useSelection 零使用 | ✅ 属实 | 全仓仅定义与 barrel 导出，零消费（本次 grep 复核） | 📋 待决策 Q-19（删 vs 推广）|
| CR-25 四处重复定义 | ✅ 属实 | ID_PREFIX 两份、logFront 4 份、configKey 2 份、verify-steps 工具 id 字面量 100+ | 📋 待决策（抽象收敛批次）|
| CR-26 漏导出 | ✅ 属实 | 见批1 | ✅ 已改 |
| CR-30 列表页模式重复 11+ 页 | ✅ 属实 | el-pagination 10 文件、相同 currentPage/pageSize/paged 模式 | 📋 待决策（useTablePage 抽象）|
| CR-31 两个 ProfileForm 重复 | ✅ 属实 | props/emits、FormHint detail 长文案逐字重复 | 📋 待决策（抽 SecretField）|
| CR-32 时间口径绕过 12+ 处 | ✅ 属实（范围可补充） | `toLocaleString('sv-SE')`/`Date.parse` 多处；**补充 `content.ts:60,128` 的 Date.parse** | 📋 待决策（时间统一专项）|
| CR-33 分享逻辑散落 5 处 | ✅ 属实 | TTL 一个算分钟一个出中文文案 | 📋 待决策（收敛 share-core）|
| CR-34 错误提示样板重复 10+ 页 | ✅ 属实 | `catch(err){ElMessage.error(...)}` 重复 | 📋 待决策（useAction）|
| CR-35 ToolPageLayout 覆盖不均 | ✅ 属实 | 仅 6 处使用，file-manager/share-manager 自建三段式 | 📋 待决策（需豁免条款）|
| CR-36 app.llm.health 归属 | ✅ 属实 | 单工具 UI 缓存写应用级命名空间 | 📋 待决策（下沉工具层）|
| CR-37 app.content.editorMode 残留 | ✅ 属实 | `repository/config.ts:177` 仍写 DEFAULT_SETTINGS、`ContentsPage.vue` 回落读旧键 | 📋 待决策（彻底清双轨）|
| CR-38 更新并发竞态 | ✅ 属实 | `main/index.ts` checkForUpdates 单例并发、两条下载路径、catch push error 覆盖 downloading | 📋 待决策 Q-20 |
| CR-39 分片 gate 唤醒丢失 | ✅ 属实 | `fs.ts:756-772` 等待中任务取消/暂停后 return 未传递名额 | 📋 待决策 Q-20 |
| CR-40 事件订阅无退订 | ⚠️ 部分属实 | `onTransferEvent`/`config.onChanged`/`llm.onDelta`/`update.onState` 无退订属实；但报告"全项目 onUnmounted 仅 1 处"失实——实测多个页面有 onUnmounted + clearInterval（ShareTab/Routes/Proxies/Mounts/Service 等均正确清理） | 📋 待决策 Q-20（范围应收窄到事件订阅）|
| CR-41 媒体会话 Map 只增不减 | ✅ 属实 | `media-stream.ts` finishMediaDownload 只置 done 不删；removeMediaDownload 零调用 | 📋 待决策 Q-20 |
| CR-42 App.vue 上帝组件 583 行 | ✅ 属实 | script 348 行混合 7 类职责 | 📋 待决策（拆分）|
| CR-43 status 无白名单 | ✅ 属实 | 见批1 | ✅ 已改 |
| CR-44 分享路由软鉴权 | ✅ 属实（故意设计） | `share-hub.ts` 采信渲染层 toolId；**plans/12 §六① 明确列为已知未做、本轮零改动** | 📋 待决策 Q-13（是否本轮纳入）|
| CR-45 shareHubLogs 全表加载后 slice | ✅ 属实 | `share-hub.ts:312-325` 全表读入内存再切片，limit 钳 1000 形同虚设 | 📋 待决策 Q-20 |
| CR-46 developerModeOn 一次性读取 | ✅ 属实 | `App.vue:258-260` 无 config.onChanged 监听，打包版切换需重载 | 📋 待决策（订阅改写）|
| CR-47 `SSHK_DEV_*` 被烤入 | ✅ 属实 | `electron.vite.config.ts` denylist 只挡签名键 | 📋 待决策 Q-17 |
| CR-48 isDev/devFeatures 混用 | ✅ 属实 | `ToolsTab.vue:272` 图标字段用 isDev 而非 devFeatures | 📋 待决策 Q-12 |
| CR-49 manifest name 中英混杂 | ✅ 属实 | 3 英 3 中 | 📋 待决策 Q-07 关联（展示名）|
| CR-50 composable 文件名两套风格 | ⚠️ 部分属实 | camelCase 6 个属实，但报告自己定为"建议写入例外而非违规"，非真问题 | 故意设计暂不动 |
| CR-51 00-index 断链 + 写死测试数 | ❌ 误报（当前态已修复） | 复核时 `00-index.md:3` 已指向正确的 `99-archive/...`，测试数已改"以最近 verify 输出为准" | 不改（已修复）|
| CR-52 00-index 元信息过时 | ⚠️ 部分属实 | 版本已更 v1.4、已收录 11-20 文档；但 `03-design/` 空占位仍在（`:50`）| 📋 待决策 Q-18 关联（清占位）|
| CR-53 archive 优化建议文档 | ❌ 处置错误 | 报告建议"确认吸收后删除"，但项目铁律 `00-index.md:52` 明确 `99-archive/` **只移不删**；文件已在 archive | 不改（保持归档）|
| CR-54 EDM v5/v6 主从 | ❌ 伪分歧 | 报告A判"v6 权威、勿删 v6"；`00-index.md:38-39` 已标 v6 权威、v5 已归档——三方一致，无冲突 | 不改 |
| CR-55 Provider 补齐"部分实现" | ⚠️ 报告低估 | `packages/upload-core/src/providers/cloud-sdk.ts`/`cloud.ts` 已有 cos/七牛/S3 真实 SDK；仅差真实账号验证 V7 | 📋 待决策 Q-14（仅需确认验证范围）|
| CR-56 内容管理双实现 | ✅ 属实（有意分离） | file-manager/ContentsPage（通用文章）vs edm/ContentManagePage（EDM 领域树）是 plans/11 明确职责分离 | 故意设计暂不动（文档明确集合归属即可）|
| CR-57 旧称 upload-manager 残留 | ✅ 属实 | 9+ 文档以旧名作当前名称；**但迁移兼容代码（`services.ts:333-366`）、IPC 通道 `uploadManagerGet/Set`、`shared/upload-manager.ts` 文件名必须保留** | 文档批量替换（待执行），代码兼容保留 |
| CR-58 工具目录组织散乱 | ✅ 属实 | edm 6 组件平铺根、file-manager 组件位置分裂、pages/ 混入弹框 | 📋 待决策（目录规范对齐）|
| CR-59 core/ 覆盖不均 | ✅ 属实 | 仅 2/6 工具有 core/；state.ts 命名位置无统一 | 📋 待决策（含 N6）|
| CR-60 ProvidersPage/UsagePage 违规 | ⚠️ 部分属实 | UsagePage 清空确认缺禁遮罩属实（已修）；但报告"FormHint 工具 0 使用"失实——实测 6 文件在用；手写 .form-hint / gap 写死等属实 | 部分已改 + 余项待决策 |

### 3.3 💭 建议级

| 条目 | 判定 | 处置 |
|---|---|---|
| CR-25 P2 补充（yes 见 §3.2） | — | — |
| E4/E5/E6（报告A :214 的 P2） | ✅ 属实 | 归入 Q-17 env 契约批次 |
| R1~R6 环境/死代码补充（报告B） | 部分误报 | R5（FormHint 0 使用）、R6（isUploadCloudVendor 两份）误报；其余归对应条目 |
| D6~D11、N1~N7、G1~G6、S1~S6、B1~B6、F1~F10、T1~T4、C1~C7 | 见报告B明细 | 逐条处置见 §六与"报告B逐条" |

---

## 四、两份报告的结论冲突清单（待用户裁决）

| # | 冲突点 | 报告A | 报告B | 复核者判断 |
|---|---|---|---|---|
| C1 | D18 env 开关处置 | CR-06：门控已删，清理残留注释/文档 | E1：变量 5 处使用，补登记 `.env.example` | **A 对**：已 grep 证实零代码读取，补登记=给僵尸变量立契约 |
| C2 | EDM v5/v6 主从 | CR-54：v6 权威、勿删 v6 | G4：v5 应移 99-archive | **不冲突**：都认 v6 权威；00-index 已标 v5 归档，文件已在 archive，无需再动 |
| C3 | 三能力是否上提 | 专题A：骨架合理、无需上提，待办集中在下沉 | S1/T1/T2/H3：配置 UI 藏在可禁用工具=高危，必须升应用 | **判据不同**：A 看"数据所在层"，B 看"配置入口可达性"。数据已在应用层但入口在工具（模型/上传；分享已在应用设置 ShareTab）——需用户定优先级，见 Q-04 |
| C4 | 危险操作确认弹框收敛 | CR-60 💭：统一 `ConfirmDialog` | C4/P5：`ElMessageBox.confirm` 单轨（推荐），ConfirmDialog 降级/删除 | **直接相反**，必须裁决 Q-07 |
| C5 | `pnpm start` preview 归属 | CR-03/P-9：倾向 dev | O1/P1：`__SSHK_DEV__` define 注入，preview 归 build | **相反倾向**，需统一 Q-06 |
| C6 | ShareDialog 定位 | 专题C.3：625 行内聚、保持 | X1/S3/M3：业务组件错放 ui-kit，应迁出 | **直接相反**，必须裁决 Q-08 |
| C7 | 工具 id 存量命名 | CR-49：manifest name 统一中文名 | N1/P9：保留存量 id + 指南立规 | 部分重叠（name 展示名 vs id），一起定 Q-07 |

---

## 五、工具⇄应用升降级专项（用户第 10 条：问题/原因/全部方案/建议，待决策）

> 全部待用户拍板，不擅自做主。请逐项回复"编号 + 选择"。

### 5.1 应用能力下沉为工具（降级）

**D-1：`fs.ts` FsRuntime（2047 行 + 约 30 个 `fs:*` 通道）下沉**
- 问题：文件浏览/传输运行时整块常驻应用主进程，但渲染层宿主零消费，仅 `file-manager` 两文件用 `window.api.fs`。
- 根因：早期"上传管理"演进为应用级共享能力时，文件浏览后端被留在宿主，界线划错（plans/12 全篇未覆盖，属设计文档盲区）。
- 方案：A（激进/推荐）整体下沉 `tools/file-manager/src/main/fs-runtime/` + 扩展 `ToolHostCapabilities` 注入密钥/config；B（折中）抽 `packages/fs-core` 纯逻辑包、壳留应用；C（保守）维持 + 文档标注例外。
- 建议：**A**（符合 D39 工具自包含 + 用户"彻底重构不打补丁"）；最大手术，需专项设计后执行 → Q-03。

**D-2：`local-res.ts` + `local-res-rules.ts` 归属（报告B T5）**
- 问题：本地资源流式服务（206 渐进下载）当前只服务 file-manager 媒体播放。
- 方案：①仅 file-manager 消费→随 D-1 下沉；②多消费者→抽 `packages/local-res`。
- 建议：先 grep 确认消费者数，倾向随 D-1 下沉（单一消费者场景）。

### 5.2 工具配置上提为应用（升级）

**U-1：三大能力配置入口从"可禁用工具"升到应用设置中心**
- 问题：模型 Provider（`model-console/ProvidersPage`）、上传通道（`file-manager/ProfilesPage`）配置 UI 在工具里，工具禁用后其它工具能力照常工作但无入口改配置。**分享服务配置已在应用设置（ShareTab.vue），是正面范例。**
- 根因：配置**数据**早已应用级（D32 正确），但配置**入口 UI** 没跟着上移。
- 关键澄清：这不是"数据分层错"（数据已对），是"入口可达性错"；A 报告"无需上提"从数据层看，B 报告"高危必须升"从入口看，两者都对。
- 方案：A 全升（配置+服务开关）；B 只读镜像+跳转（本质没解决）；C 按能力分治（=A 的落地路径，模型/上传升应用、分享已就位）。
- 建议：**C** → Q-04。

**U-2：`ShareDialog.vue`(625)/`share-ticket.ts` 是否迁出 ui-kit**
- 问题：分享业务组件放"纯通用 UI 库"，与 ui-kit 定位冲突。
- 方案：①迁 `share-core` 渲染子入口；②迁宿主组件；③保持（6 工具复用、内聚）。
- 冲突：A 判"内聚保持"、B 判"错位迁出"——见 C6 → Q-08。

**U-3：`presets.ts` + `seedDefaultProviders()` 归属（报告B T4/D7）**
- 问题：预设是 model-console manifest 自带设计（D47），播种逻辑却住宿主。
- 方案：①预设归应用级配置、播种收敛宿主单一播种器；②改 D47 表述对齐实现。
- 建议：①，与 provider 配置位置对齐 → 归入 Q-04 一并决策。

### 5.3 复用能力归属（用户第 11 条：可复用留应用层、规划组织结构、该建包建包）

| 能力 | 现状 | 消费者数 | 建议 |
|---|---|---|---|
| llm-gateway | 应用层 packages | 全工具（宿主注入） | ✅ 保持应用层 |
| upload-core | 应用层 packages | 4 工具 | ✅ 保持应用层 |
| share-core | 应用层 packages | 全工具 | ✅ 保持应用层 |
| FsRuntime | **应用主进程** | **仅 1 工具** | ❌ 下沉（D-1）——单一消费者不该常驻应用层 |
| local-res | 应用主进程 | 待确认（疑似 1） | 随 D-1 下沉或抽包 |
| ShareDialog | **ui-kit** | 多工具 | 待裁决（U-2）|

> 建议写入规范（见《代码规范总纲》§归属判据）：**≥2 工具复用→留应用层 `packages/`；仅 1 工具消费→下沉该工具 `src/`；通用无业务 UI→ui-kit，含业务语义→领域包或宿主。**

---

## 六、待用户逐项拍板清单（集中位置，请逐项回复"编号 + 选择"）

| 编号 | 决策点 | 选项 | 复核者建议 |
|---|---|---|---|
| Q-01 | CR-01 conflict 修复方案 | A 抛专用信号（同 `__fs_paused__` 机制）/ B 返回枚举 | A |
| Q-02 | CR-02 密钥竞态方案 | ①Promise 链串行化 ②统一 SecretsStore 类 | ②（彻底，不打补丁）|
| Q-03 | CR-04 FsRuntime 下沉（D-1） | A 整体下沉工具层 / B 先抽 fs-core / C 维持 | A（需专项设计）|
| Q-04 | 三能力配置升层（U-1/U-3） | A 全升 / B 只读镜像 / C 分能力分批 | C |
| Q-05 | dev 判据统一（CR-03/O1） | A `__SSHK_DEV__` define 注入 / B NODE_ENV 判断 | A |
| Q-06 | `pnpm start` preview 归属（C5） | 归 dev / 归 build | 归 dev（守 AGENTS 铁律）|
| Q-07 | 危险操作确认弹框（C4） | ConfirmDialog 组件化 / ElMessageBox 单轨 | ElMessageBox 单轨（已是主流 49 处）|
| Q-08 | ShareDialog 去留（C6/U-2） | 迁出 ui-kit / 保持 | 迁出 |
| Q-09 | CR-11 edm 三死代码页 | 直接删 / 移 99-archive | 直接删 |
| Q-10 | CR-54 EDM v5 | 无需动（已归档） / 删 | 无需动（只移不删）|
| Q-11 | CR-53 archive 优化建议文档 | 保持归档 / 删 | 保持归档（铁律只移不删）|
| Q-12 | CR-48 build+developerMode 图标字段 | 可改（devFeatures）/ 仅 dev 可改 | 按产品意图定 |
| Q-13 | CR-44 分享路由硬鉴权 | 本轮纳入 / 另立安全项（plans/12 原定） | 本轮纳入（用户接受破坏性改动）|
| Q-14 | CR-55 COS/七牛 Provider | 补齐真实账号验证 V7 / 只读范围已满足 | 需用户确认业务只读范围 |
| Q-15 | CR-05 AppError 治理范围 | 仅 apps main / apps + tools main（含 L1 的 66 处） | apps + tools main |
| Q-16 | CR-23 8 僵尸常量 | A 逐点改 import 常量 / B 删常量 | A（产物名是路径契约）|
| Q-17 | env 烤入契约（CR-20/22/47） | 逐项确认 3 个方案 | 待细化 |
| Q-18 | 文档规整收尾（CR-52 空占位/台账登记） | 本轮清 / 下一轮 | 本轮 |
| Q-19 | CR-24 useSelection | 删 / 推广落地 | 删（YAGNI）|
| Q-20 | 健壮性批次（CR-38~41/45） | 本轮全做 / 分批 | 分批（更新竞态优先）|
| Q-21 | 门禁补强：`check-dialogs` 纳入 ElMessageBox.confirm 选项检查 | 做 / 不做 | 做（防 8 处漏报回潮）|

---

## 七、进度跟踪

- [x] 通读两份报告 + 建任务清单
- [x] 全部条目回源码核验（P0 关键项 + 文档口径 + 图标/死代码/导出/白名单 + 误报/漏报交叉）
- [x] 待用户拍板项集中落档（§六）
- [x] 直接改清单分批执行 + 提交 + 推送（批1 `4e879fb`、批2 `3a0acf5`）
- [x] 工具⇄应用升降级专项落档（§五）
- [ ] 同步更新两份审查文档处理结果
- [ ] 落档《代码规范与铁律总纲》（新设备 WorkBuddy 优先读取）
- [ ] 台账登记 #149 + 00-index 更新
