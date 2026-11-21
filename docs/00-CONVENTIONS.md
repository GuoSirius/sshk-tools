# 项目规范与铁律总纲（新设备必读）

- 状态：**权威汇总 · 唯一入口**。本文件是所有开发规范、设计约定、文件/命名/使用/契约规范、铁律的**统一汇总**，供人及 WorkBuddy 等 AI 工具在本机或**新设备拉取代码后第一时间读取并严格落实**。
- 版本：v1.0
- 日期：2026-11-20（北京时间）
- 配套：仓库根 `AGENTS.md`（IDE AI 必读铁律，本文件是其完整展开）；`docs/00-index.md`（文档索引与决策看板 D1~D51）。
- 更新纪律：新增/修改规范**先改本文件**再同步到专项文档；专项文档与本文冲突时以本文为准，除非对应决策编号明确推翻。

---

## 0. 新设备开工第一步（AI 工具必做）

1. 读 `AGENTS.md` → 本文件 → `docs/00-index.md`。
2. 跑 `pnpm install` → `pnpm verify`（13 门禁 + typecheck + lint + build + vitest）全绿才算环境就绪。
3. 任何新需求/新 bug：先看本文 §铁律与 §契约，确认不违反再动手；涉及待决策项先查 `06-codereview/2026-11-21-CodeReview敲板裁决与重构实施总计划.md` §三/§四（CodeReview 敲板裁决入口；2026-11-21 起全部 CodeReview 文档统一落 `docs/06-codereview/`）。
4. 破坏性改动不需要兼容性兜底（应用未正式大批量发布），但**危险操作必须二次确认**、**每批 verify 全绿后立即 commit + push + 核验 message**。

---

## 1. 目录结构与规划规范

### 1.1 仓库顶层

```
sshk-tools/
├── apps/desktop/          # 应用层：main / preload / renderer 三层
├── packages/              # 共享层：@sshk/* 纯逻辑包（无 UI）
│   ├── shared/            # 纯契约 + 裁决 + 机制（time/ipc-result/baked-env/trust）
│   ├── llm-gateway/       # 模型内核（纯函数）
│   ├── upload-core/       # 上传内核
│   ├── share-core/        # 分享内核
│   ├── repository/ backup/ ui-kit/ file-picker/ rich-text/ code-editor/
├── tools/<id>/            # 工具层：每个工具自包含（见 1.2）
├── docs/                  # 沟通文档（唯一入口 docs/00-index.md）
├── scripts/               # 门禁校验脚本（check-*.mjs / verify-structure.mjs）
└── requirement.txt        # 用户原始输入快照，只读
```

### 1.2 工具包目标目录（所有工具对齐，D39/D40）

```
tools/<id>/
├── tool.manifest.json          # 清单（工具元数据唯一真相源）
├── assets/icon.svg             # 必备！icon:"auto" 必须有此文件（CR-10 教训）
├── package.json / tsconfig.json
└── src/
    ├── index.ts                # 渲染入口
    ├── main/                   # 仅"有主进程能力"的工具才有；默认注册入口 export default（D41）
    │   ├── index.ts
    │   └── ipc.ts              # 可再拆 ipc/ 目录
    └── renderer/
        ├── host.ts             # 宿主能力声明（全部工具统一用 createSafeHost）
        ├── store.ts            # 响应式状态（原 state.ts/shared.ts 收敛名）
        ├── pages/              # 只放页面 XxxPage.vue（禁放弹框/组件/纯逻辑）
        ├── components/         # 组件 + 弹框（弹框也是组件）
        └── composables/        # use* 组合式
```

- **唯一 `*Page.vue` 入口**：renderer 顶层只能有一个 `XxxPage.vue`（discovery 单层 glob 依赖）。
- **分层铁律**：renderer 禁引 `electron`/`node:fs`/`BrowserWindow`；main 禁引 `.vue`/`element-plus`/`window.api`。`check-boundaries.mjs` 强制。
- **工具 id 单一来源**：renderer 一律 `provideToolId(() => props.toolId)` + `useToolId()` 注入，**禁止任何工具 id 字面量或本地 TOOL_ID 常量**；主进程/跨进程/改名迁移链静态引用走 `@sshk/shared` 的 `TOOL_IDS`；manifest id 是最终真相源。

### 1.3 能力归属判据（本次复核定版，用户第 11 条）

| 消费者数 | 归属 | 例 |
|---|---|---|
| ≥2 工具复用 | 留应用层 `packages/` | llm-gateway / upload-core / share-core / ui-kit |
| 仅 1 工具消费 | 下沉该工具 `src/` | FsRuntime（当前错留在应用主进程，待决策 Q-03）|
| 通用无业务 UI | `ui-kit` | ToolPageLayout / EmptyState / FormHint |
| 含业务语义的 UI | 领域包或宿主 | ShareDialog（争议中，Q-08）|

> 密钥一律进 safeStorage（`secrets.bin`），settings 只存 sha256 摘要；上传通道密钥命名空间 `app:upload:<pid>`（勿回退 `getToolSecret('file-manager',...)`）。

### 1.4 docs 目录

```
docs/
├── 00-CONVENTIONS.md    ← 本文件，规范总纲（新设备首读）
├── 00-index.md          ← 文档索引与决策看板
├── 01-requirements/     ← 需求与快照
├── 02-architecture/     ← 架构、专项规划、台账、CodeReview 报告
├── 03-design/           ← UI 稿（占位）
├── 04-api/              ← 数据契约（门禁强依赖勿删）
├── 05-release/          ← 发布流程
├── 06-codereview/       ← CodeReview 报告/复核台账/交叉合并/敲板处置计划（2026-11-21 起，唯一存放地）
├── plans/               ← 分类计划 00~12
└── 99-archive/          ← 归档，**只移不删**
```

命名：一次性 `YYYY-MM-DD-主题.md`；长期维护 `NN-主题.md`。元信息头写 `状态/版本/最后更新/关联需求`。状态机 `草稿→讨论中→已定稿→已归档`。

---

## 2. UI / 页面设计规范

### 2.1 留白与间距（token 在 theme.css `:root`）

- `--sshk-page-padding:20px`（页面根）、`--sshk-gap-sm:8px`/`md:12px`/`lg:16px`。
- 用 `ToolPageLayout` 的页面由全局 `.tool-page-body{padding:var(--sshk-page-padding)}` 提供留白，**页面自身勿再写 padding**；自管根容器页须显式 `padding:var(--sshk-page-padding); box-sizing:border-box`。
- 禁止内容贴边；区块间必须有间距。详见 `02-architecture/页面留白与间距规范.md`。

### 2.2 表单

- **label 一律 `label-width="auto"`**（自动取最宽右对齐），禁固定 px。
- 开关控件文字与开关同排；行内注释只一两个词；长说明放 `FormHint` 的 detail（❓悬浮）。
- 校验**双层铁律**：前端表单校验 + 后端（IPC/入库前）校验都要有；表单校验失败停留、不发 IPC、控件下红字（`color: var(--el-color-danger)`，参照 `ContentEditorCore` 的 tip）；后端业务校验失败 `throw new AppError(msg, 'validation')`（warn 落盘，勿裸 throw Error 刷堆栈）。

### 2.3 列表页（详见 `02-architecture/列表页筛选与操作栏规范.md`）

1. 筛选控件「label + 控件」且包 `.f-item`（inline-flex + nowrap）整体换行；placeholder 只写短词。
2. 控件宽 180px；时间范围 360px、`datetimerange` 精确到时分秒（value-format `YYYY-MM-DD HH:mm:ss`，default-time `[00:00, 23:59:59]`），闭区间过滤走 shared `inMsRange`。
3. 筛选栏末尾统一「查询」(primary) +「重置」（草稿/生效分离，点查询才生效；重置清空立即生效）。
4. 操作按钮**单独一行居右**、紧凑口径（gap 4px + 归零 EP 兄弟 margin + padding 8px）。
5. 顺序固定：筛选栏 → 操作栏 → 表格 → 分页。分页 `layout="total, sizes, prev, pager, next, jumper"`。
6. 统一组件：`ToolPageLayout` / `EmptyState` / `FormHint` / `FormGrid`。

### 2.4 弹框口径

- `.el-dialog` 唯一内缩层 `padding:12px 16px 0`；body 归零；header `0 0 10px`；footer `12px 0 16px`。
- 自动聚焦走 `focus-on-dialog-open.ts`（`[data-autofocus]`），勿用 EP 原生 autofocus（二次打开失效）。
- **EP dialog 陷阱**：afterLeave 会回发 `update:modelValue=false`（use-dialog.mjs:85），程序性隐藏也回发——v-model 绑 computed 时 setter 必须 no-op，关闭入口直调 doClose。
- Teleport 到 body 的覆盖样式必须放**非 scoped 全局块**（`:deep()` 打不进）。
- 全屏/最小化四态口径见台账 #129 系列；最小化手柄停靠工具页主体右下角 + ResizeObserver 跟随。

### 2.5 按钮语义配色与图标

- primary=查看/新建、success=上传/下载/统计、warning=复制/移动/清理/导出、danger=删除。
- 常用操作外置工具栏，次要项进「更多▾」。
- 图标优先级：`@element-plus/icons-vue` → FontAwesome（`fa-solid/fa-regular` 类名全局可用）→ 自定义 SVG。能用图标处尽量用图标（D50），禁裸 `↓`/`▾`。

---

## 3. 文件 / 命名规范

- 组件文件/目录 kebab-case，组件名 PascalCase；IPC channel `namespace:action`（全走 `IPC_CHANNELS` 常量，无裸字符串）。
- 包名 `@sshk/*` 前缀零例外；工具 id kebab-case 且与目录名一致。
- composable 文件 `useXxx.ts` 允许 camelCase（约定例外，CR-50）。
- 禁 `shared.ts` 做工具内文件名（易与 packages/shared 混淆），用 `store.ts` 或按域命名。
- manifest `name`（展示名）倾向中文统一；`id` 存量不改（toolId 记账/鉴权依赖）。

---

## 4. 契约规范

- **IPC**：`IpcResult`/`AppError` + `check-ipc` 门禁；主进程 handler 一律 `handleOk`/`wrapIpcHandler`，永不 reject；preload 统一解包且保留 code 分类。业务校验失败 `AppError(msg,'validation'|'permission'|'io')`。
- **preload**：产物必须 `.cjs`（sandbox）；裸 `ipcRenderer.invoke` 只允许 1 处（统一包装）。
- **时间**：一律北京时间，走 `@sshk/shared` time.ts：`format()`/`toMs()`/`inMsRange()`/`toFileName()`；禁散写 `Date.parse` 比较、`toLocaleString('sv-SE')`、`toISOString`。
- **字数**：`countText().words` = 非空白字符数（中西文逐字符计 1），不是西文按词计。
- **访问密钥**：参数 `?ak=`（勿回退 `?key=`）；每路由独立、未设继承同 root 最近祖先；内核每请求必校、子链接全程透传。
- **分享**：ShareDialog 按 toolId+label+root+entry 复用票据，仅过期/撤销/清空/明确重新生成才新建。
- **env**：`.env.example` 是唯一真相源，`check-env.mjs` 双向契约；`SSHK_APP_OVERRIDABLE` 自身锁死；被删的僵尸变量（如 `SSHK_TOOLS_ALLOW_SECRET_MIGRATION`）不得补登记、应清理残留。
- **路径**：内部统一 `/a/b/c`（根=`/`），normalizeRootRel 输出恒带前导 `/`；本地绝对路径用 main/fs.ts 的 localBasename。
- **localres**：本地资源预览唯一协议 `localres://`（渲染层无 file://）；readMedia 返回 pathToFileURL 换前缀。

---

## 5. 铁律（违反过的事故，勿再犯）

### 5.1 开发模式（最高优先级，AGENTS.md）

凡 `pnpm dev`（`import.meta.env.DEV===true`）：所有功能/表单项/配置项/工具入口**全量展示全量可编辑**，不受任何配置变量控制。`app.developerMode` 只作用于打包版。新增门控走 `devFeatures = isDev || cfg.developerMode`。主进程辅助通道可用性只由"是否源码仓库"决定。

### 5.2 危险操作二次确认

所有撤销/删除/重新生成/覆盖/清空/禁用/降级/退出等高风险动作，必须 `ElMessageBox.confirm` 且 `closeOnClickModal:false` + `closeOnPressEscape:false`。**本次复核发现 `check-dialogs.mjs` 不检查 ElMessageBox.confirm 选项**（只扫 el-dialog 标签），故需人工保证 + 门禁待补强（Q-21）。按钮条件不符直接 return 必须给 toast，禁止静默。

### 5.3 Git 提交

- `pnpm verify` 全绿才准提交；conventional commits；推送 main。
- **commit 后必须 `git log -1 --format='%h | %s'` 核验 message 非空正确**（用户两次看到 GUI 只显示作者名无 message，严厉纠正过）。
- bash 下禁用 PowerShell 风格 `@'...'@` heredoc（@ 会混进 message 首行）；用 `-m` 单行 subject 或写临时文件 `git commit -F`。
- CHANGELOG.md 由 release 流程生成，AI 禁止手工写。

### 5.4 时间 / 字数 / 工具 id

见 §4 契约。三条都是"声明了真相源却被消费侧绕过"的历史事故高发区。

### 5.5 技术坑速查（详见 `02-architecture/工具插件化需求台账.md` 与工作记忆）

- EP cascader：根 label 置 `''` + `separator='/'`；节点显式 `leaf` 字段钉死；挂载即触发根懒加载勿 resolve([])；`:deep()` 打不进 teleport popper。
- el-dropdown 裸用禁忌：menu/item 脱离 dropdown 会 inject 抛错；自管右键菜单用原生 ul/li + data-command 委托。
- 管理员拖放：Windows UIPI 拦普通→提权进程拖放，代码无法绕过，用 isElevated + 黄条引导。
- S3 指令必须 `new (cmd('X'))(...)`；ali-oss listParts XML 字段大写开头防御性双读。
- 主进程禁引 `@sshk/rich-text` 根入口（会 JSX parser 解析 .vue 报错），纯函数走 `@sshk/rich-text/pure`。
- 检查更新判定一律 `checkForUpdates().isUpdateAvailable`，禁字符串比版本。
- grid 列错位根治=单容器 + `subgrid`；CSS 截断只对自身文本生效，溢出量用 scrollWidth 量。
- 多会话同仓提交竞态：并发期避免 git add，用路径限定提交；撞车后先查 `git show --stat HEAD`，勿盲目 retry。

### 5.6 一致性口径（本次复核新增）

- 报告/文档中"已被删除/改名"的东西（D18 env 开关、`?key=`、旧工具名 upload-manager），处置方向是**清理残留**，不是补登记/补兼容；但历史设计稿加"实现已变更"批注而非改写历史结论。
- 迁移兼容代码、IPC 通道名、文件名即使"旧"也必须保留（改名迁移链 first-wins）。
- 任何"报告结论"落到代码前必须回源码验证当前态——两份 CodeReview 报告已发现多处"当前已修复/失实"条目（CR-21/CR-51/R5/R6）。
