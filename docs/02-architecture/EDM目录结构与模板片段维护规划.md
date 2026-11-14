# EDM 目录结构与模板/片段维护规划

- 状态：实施中（R1/R2/R3解析与浏览/R4/R5/R6/R9 已完成，R10 策略层完成；R7/R8/R11 待开发；黑白名单已收敛为仅 fragment 侧）
- 最后更新：2026-11-15
- 关联：D8（版本不可变）/ D14（名单粒度=版本 ID）/ D29（品牌管理独立页）/ 需求 5（系统只读+复制、自定义 CRUD）/ 数据契约 §2（领域模型）/ 选型稿 L71 / 工具包开发打包分发工作流 / D49（优先第三方包）/ D50（UI 视觉铁律）
- 参考结构：`D:\workspace\code\juice-cli\edm`（仅参考**目录形态**与「每目录自带元数据+示例」，语法按本项目约定）
- 冲突裁决：本文与 `docs/00-index.md` 决策看板冲突时以看板为准；与 `../requirement.txt` 冲突时以快照为准。

---

## 一、目标与边界

1. **EDM 是独立工具**（`tools/edm-studio/`），不是应用的子资源。可**内建**（构建期自动发现，D40），也可**单独打包成 `.sshktool` 分发**给他人安装（见工具包开发打包分发工作流）。
2. **系统自带内容**（开发时维护的品牌/模板/片段）随**工具包**走，位于 `tools/edm-studio/assets/edm/`，不在 `apps/desktop/resources/` 下。
3. **用户自定义内容**（用工具内置编辑器保存）按**相同格式**组织，落在**应用数据目录**（可写），与系统内容物理隔离。
4. 系统内容运行时**只读**：用户只能「使用 / 复制派生」，不能改系统文件；复制即生成 `custom` 记录 + 文件副本。
5. 内置**代码编辑器**需支持语法高亮 + 实时检测，用第三方包 **Monaco**（详见第七节，不自研）。
6. **品牌隔离铁律**：同一品牌下的片段**只能被同品牌模板使用**，由黑白名单机制实现，**禁止跨品牌**（见第四节）。
7. **元数据是一等公民**：元数据文件名为 `meta.yaml`（**不带下划线前缀**），与源文件 `*.njk`、示例 `sample.yaml` 平级。

> 纠错记录：初版误将 EDM 系统内容放在 `apps/desktop/resources/edm/`。已更正为 `tools/edm-studio/assets/edm/`。

---

## 二、目录结构（系统自带，随工具包发布）

基座：`tools/edm-studio/assets/edm/`（开发期维护；构建/打包后变为只读的系统内容）。

```
tools/edm-studio/assets/edm/                ← 系统内容根（随工具包发布，运行时只读，origin:system）
├── css/                                    # 跨品牌公共样式（最顶层共享）
│   └── base-reset.css / uno.css / *.css
├── <brandCode>/                            # 品牌目录，目录名=品牌 code（如 elabscience / procell）
│   ├── meta.yaml                           # 品牌元数据（name/description/logo/policy…）
│   ├── logo/                               # 品牌 logo（可选）
│   │   └── logo.png
│   ├── css/                                # 品牌级共享样式（可选，就近）
│   │   └── *.css
│   ├── fragment/                           # 片段（= juice-cli 的 series）
│   │   └── <fragmentFamily>/               # 片段族
│   │       ├── meta.yaml                   # 族元数据（type / policy 黑白名单 / dataSchema，族内共享）
│   │       ├── css/                        # 族级共享样式（可选）
│   │       │   └── *.css
│   │       ├── default/                    # 默认版本目录（不可变）
│   │       │   ├── meta.yaml               # 该版本元数据（必）
│   │       │   ├── fragment.njk            # 源（必）
│   │       │   ├── sample.yaml             # 示例数据（必）
│   │       │   └── css/                    # 该版本自有样式（可选）
│   │       └── v1/ …                       # 具名版本（同结构：meta.yaml + 源 + sample.yaml + 可选 css/）
│   └── template/                           # 模板（邮件整体骨架）
│       └── <templateFamily>/               # 模板族（如 standard）
│           ├── meta.yaml                   # 族元数据（slots / dataSchema / policy，族内共享）
│           ├── css/                        # 族级共享样式（可选）
│           │   └── *.css
│           ├── default/                    # 默认版本
│           │   ├── meta.yaml               # 该版本元数据（必）
│           │   ├── template.njk            # 源（必）
│           │   ├── sample.yaml             # 示例数据（必）
│           │   └── css/                    # 可选
│           └── v1/ …
```

### 图例与强制项

| 目录 | 必含 | 可选 |
|---|---|---|
| `<brandCode>/` | `meta.yaml` | `logo/`、`css/` |
| `<family>/`（族） | `meta.yaml`（共享元数据） | `css/`、`sample.yaml`（单版本折叠时） |
| `<version>/`（`default`/`v1`/`v2`） | `meta.yaml` + 源 `.njk` + `sample.yaml` | `css/` |

- **每个具体版本目录必有自己的元数据（`meta.yaml`）+ 示例数据（`sample.yaml`）+ 源；可有自己的 `css/`**——与 juice-cli 一致（每目录自带元数据+示例）。元数据文件名为 `meta.yaml`（一等公民，不带下划线）。
- **单版本族可折叠**：若某族不打算多版本，内容可直接放 `<family>/`（`meta.yaml` + `template.njk` + `sample.yaml` + 可选 `css/`），此时 `<family>/` 即默认版本；多版本时改放 `<family>/<version>/`。
- 版本目录内容**不可变**（D8）：改 = 新开 `vN/` 目录，绝不原地覆盖。
- 元数据用 **YAML**（用户决定，比 JSON 宽松；引 `js-yaml` 解析）。

---

## 三、css 就近提升规则

> 核心：**css 放在「被引用文件的最近公共祖先目录」的 `css/` 下**；每个目录「可能但不一定有」`css/`。

1. 仅**单文件**引用 → 内联（inline）或就近放该版本目录 `css/`。
2. **同一版本目录内多文件**引用 → 放该版本目录 `css/`。
3. **同一族内多版本**引用 → 提至 `<family>/css/`。
4. **同一品牌内多族/多片段**引用 → 提至 `<brandCode>/css/`。
5. **跨品牌全共享** → 放最顶层 `edm/css/`。
6. 汇集顺序（assembled 阶段统一注入 head）：`base-reset.css → uno.css → 品牌/模板 css → 模板内联 style → juice 内联下沉 style 属性`。

---

## 四、元数据、示例数据与黑白名单（含品牌隔离）

每类实体除代码（njk/css）外，都有**元数据（`meta.yaml`）+ 示例数据（`sample.yaml`）**。字段对齐数据契约 §2：

| 实体 | 文件 | 关键字段（YAML） |
|---|---|---|
| 品牌 | `<brandCode>/meta.yaml` | `code`（=目录名）、`name`、`description`、`logo`（相对引用）、`defaultTemplateFamily`、`policy`（品牌级可选总闸）、`tags` |
| 模板族 | `<brand>/template/<family>/meta.yaml` | `code`、`name`、`description`、`slots`（D7 槽位声明式）、`dataSchema`、`tags` |
| 模板版本 | `<family>/<version>/meta.yaml` | `version`、`changelog`、覆盖/补充族级字段 |
| 片段族 | `<brand>/fragment/<family>/meta.yaml` | `code`、`name`、`description`、`type`（header/product-card/footer/cta…）、`policy:{blacklist,whitelist}`（D14 粒度=版本 ID，可族批量）、`dataSchema`、`tags` |
| 片段版本 | `<family>/<version>/meta.yaml` | `version`、`changelog`、补充族级字段 |

### 黑白名单与品牌隔离

- **品牌隔离铁律（用户规则 #2）**：同一品牌下的片段**只能被该品牌下的模板使用**，**禁止跨品牌**。跨品牌使用不被允许。
- **黑白名单仅片段侧持有**（用户裁定 2026-11-14）：写在**片段族 / 片段版本**的 `meta.yaml` 的 `policy` 上，语义为「本片段适用于哪些模板」，模板侧**不反向列黑白名单**（冗余，已废弃）。
  - `policy.whitelist`：本片段可服务的**模板族 / 版本 ID**；为空 = 本品牌内全部模板可用。
  - `policy.blacklist`：本片段排除的**模板族 / 版本 ID**；**优先于白名单**。
  - 列表项为**版本 ID 或族 ID**（D14）。
- 品牌级 `policy` 作为总闸（可选，先支持片段级，品牌级可选——Q6）。

> 实现提示：解析时天然按 `brandCode` 分区；模板下拉片段候选仅从同品牌 `fragment/` 取（硬性隔离），再按片段侧 `policy` 黑白名单过滤（黑名单优先，见 `repository.listCandidateFragmentVersions` → `policyAllows`）。

---

## 五、系统 vs 用户自定义（双轨 + 双模解析）

| 维度 | 系统内容（origin:system） | 用户自定义（origin:custom） |
|---|---|---|
| 物理位置 | `tools/edm-studio/assets/edm/`（开发期）→ 打包后随工具包（见下表双模） | 应用用户数据目录（随 `app.outputDir`，D21/D28），如 `<userData>/edm/...` |
| 可写性 | 只读（运行时） | 可读写 |
| 操作 | 仅「使用 / 复制派生」 | 增删改 + 复制 |
| 组织格式 | 本文第二节结构（YAML 元数据） | **完全相同格式**（同目录层级、同 `meta.yaml`/`sample.yaml`） |
| 复制派生 | 用户「复制」→ 在用户数据目录生成 `custom` 副本，系统文件不动 | — |

### 系统内容双模解析（builtin + external，自动切换）

**现有机制已能区分模式，无需单独配置**：`tool.manifest.json` 的 `plugin.source` 字段为 `'builtin' | 'external'`（`types.ts` L48–49）；宿主在「发现 / 安装」时本就为每个工具确定好 `baseDir`，EDM 解析器统一用 `path.join(baseDir, 'assets', 'edm')` 即可。

| 模式 | `plugin.source` | 系统内容根（`baseDir`，即 `assets/edm` 的父级） | 依据 |
|---|---|---|---|
| 内建 | `builtin` | 构建期从 `tools/<id>/` 发现；运行时解析为应用内工具目录（开发=`tools/edm-studio/`，打包=resources/extraResources 下对应目录） | `discovery.ts`（`import.meta.glob('../../../../tools/*/tool.manifest.json')`） |
| 独立安装 | `external` | `<userData>/runtime-tools/packages/<id>/<version>/` | `runtime-installer.ts` L226（解压落点）；`readRenderer` L264 已用同模式拼路径读文件 |

> 解析流程：宿主发现内建工具（glob）或安装外部包（`installPackage`）后，得到该工具的 `baseDir` → EDM 解析器 `resolveEdmRoot(manifest) = path.join(baseDir, 'assets', 'edm')`。`manifest.plugin.source` 仅用于确认走哪条 `baseDir` 计算路径，**不引入新的配置项**。
>
> 注意（内建专属）：`discovery.ts` 当前只 glob 了 `tool.manifest.json` 与 `src/main/index.ts`，**`assets/` 静态文件需额外随包发布**（electron-builder `extraResources` 或构建期 copy 步骤），否则打包后 `assets/edm` 不在运行时目录。此点列入 R11。

- **备份/迁移**（数据契约 §4.1）：系统内容本体随安装包自带，备份只导出**引用关系**；自定义内容随 `assets/` 迁移。
- **源真相**：文件为源真相，NeDB 仅作查询索引（Q3 确认）。

---

## 六、与既有决策对齐

| 决策 | 本文落地 |
|---|---|
| D8 版本不可变 | 版本目录 `default/`、`vN/` 内容不可变，改=新目录 |
| D14 名单粒度=版本 ID | 黑白名单列表项为版本 ID / 族 ID，支持族批量 |
| D29 品牌管理独立页 | 品牌 CRUD 基于 `meta.yaml` + 品牌目录 |
| 需求 5 | 系统只读+复制、自定义 CRUD，复制派生新版本/新模板/新片段 |
| 数据契约 §2 | 领域模型映射为文件结构（YAML 元数据 + 版本目录） |
| 选型稿 L71 | 原 `resources/system/` 误置；更正为 `tools/edm-studio/assets/edm/` |
| D4 模板引擎 | 源文件用 `.njk`（Nunjucks），非参考项目的 `.html` |
| D49 优先第三方包 | 编辑器用 Monaco、YAML 解析用 js-yaml、校验用 ajv/monaco-yaml，不自研 |
| 品牌隔离（用户规则 #2） | 片段仅本品牌可用，黑白名单同品牌内细控 |
| 元数据一等公民（用户修正） | 元数据文件 `meta.yaml`（不带下划线） |

---

## 七、代码编辑器：Monaco（语法高亮 + 检测）

内置编辑器编辑 `*.njk` / `*.css` / `*.yaml`（元数据、示例数据）。要求：语法高亮 + 实时检测（HTML/Nunjucks/CSS/YAML 语法、JSON Schema、Nunjucks 编译错误）。**用户选 Monaco**（功能更强更全，利于后续扩展其他功能/工具）。

| 包 | 用途 |
|---|---|
| `@guolao/vue-monaco-editor` + `monaco-editor` | 编辑器内核（VS Code 同款，多语言、诊断、可扩展） |
| `monaco-yaml` | YAML 语言服务 + JSON Schema 校验（用于 `meta.yaml` / `sample.yaml` 实时报错） |
| `js-yaml` | 运行时解析 YAML 元数据（读取/写入） |
| `ajv` | JSON Schema 校验（yaml→js 后校验，可选；monaco-yaml 已含 schema 能力） |
| `nunjucks`（已有 `template-engine`） | 模板编译期检测（复用，捕获 Nunjucks 语法错误） |

实现要点（R9）：
- Monaco worker 在 Vite/Electron 需配置（`editor.worker` + 各语言 worker，用 `?worker` 或 `vite-plugin-monaco-editor`）。
- Nunjucks 标签（`{{ }}` / `{% %}`）Monaco 原生 HTML 模式不识别；高亮叠加 HTML 模式，检测统一用 `nunjucks.compile()` 捕获语法错误（复用现有 `template-engine`，不重复造轮子）。
- 备选仍保留 CodeMirror 6（轻量），但主选 Monaco。

---

## 八、需求拆解（实现阶段用，当前均未启动）

| # | 需求 / 任务 | 归类 | 状态 |
|---|---|---|---|
| R1 | 落定 `tools/edm-studio/assets/edm/` 目录规范，补齐示例品牌(procell/elabscience)最小骨架（YAML 元数据 + css 就近规则） | 结构落地 | ✅ 已完成（batch3：26 文件，含 css/base-reset、品牌 brand.css、fragment/template 族与版本） |
| R2 | 定义元数据 schema（`meta.yaml`）+ 黑白名单字段，写 JSON Schema 校验（ajv / monaco-yaml） | 数据模型 | ✅ 已完成（batch2：`meta-schema.ts` + `validateMeta`；黑白名单字段仅在 fragment 侧 `policy`） |
| R3 | 文件解析层：扫描 `assets/edm/` 树 → 构造 Brand→Family→Version 内存模型；**文件为源真相，NeDB 作查询索引**（Q3） | 解析/索引 | 🟢 解析+浏览已完成（`edm-manifest.ts` 扫描构造模型；`SystemPage.vue` 只读树+预览）；NeDB 索引见 R8 |
| R4 | 代码编辑器：Monaco 集成，支持 `.njk/.css/.yaml` 语法高亮 + 实时检测；自定义内容按同格式写用户数据目录；系统只读 + 复制派生 | 编辑器 | ✅ 已完成（batch4+5：`MonacoEditor.vue` + `monaco-setup.ts`，worker 路径修复后打包通过） |
| R5 | css 就近解析与汇集（assembled 阶段 head 注入顺序按第三节） | 渲染管线 | ✅ 已完成（batch2：`system-css.ts` `collectSystemCss` 顶层→品牌→族→版本顺序汇集） |
| R6 | 系统内容双模解析：`resolveEdmRoot(manifest)=baseDir+'assets/edm'`，按 `plugin.source` 自动切换 builtin / external（无需额外配置） | 运行时解析 | ✅ 已完成（batch2：`ipc.ts` `resolveEdmRoot` packed→`process.resourcesPath/edm-studio/assets/edm`，dev→源码 `tools/edm-studio/assets/edm`） |
| R7 | 备份/迁移：系统内容只导出引用关系；自定义内容随 `assets/` 迁移（数据契约 §4.1） | 备份 | ⏳ 未开始 |
| R8 | 首次运行播种（catalog 或目录扫描）将系统内容注册进 NeDB 查询索引 | 初始化 | ⏳ 未开始 |
| R9 | 编辑器选型集成：Monaco + monaco-yaml + js-yaml + nunjucks 检测，配 worker（不自研内核，D49） | 编辑器/依赖 | ✅ 已完成（batch4：依赖 `@guolao/vue-monaco-editor`/`monaco-editor`/`monaco-yaml`/`ajv`/`js-yaml`，worker 经 `?worker` 注入） |
| R10 | 品牌隔离：模板片段候选仅限同品牌，黑白名单同品牌内细控（用户规则 #2） | 约束/策略 | 🟢 策略层已完成（运行时 `repository.policyAllows` 读 `fv.policy` 已按 fragment 侧黑白名单过滤）；UI 暴露片段 policy 字段待做 |
| R11 | 内建工具 `assets/edm` 随包发布：electron-builder `extraResources` 或构建期 copy，确保打包后 `assets/edm` 在运行时目录（discovery.ts 当前仅 glob 清单+入口） | 打包/构建 | ⏳ 未开始 |

---

## 九、相对你已建结构的微调（供审核）

你已建好 `tools/edm-studio/assets/edm/` 目录骨架（顶层 `css/`、品牌 `elabscience` 含 `fragment/{default,v1}` 与 `template/{standard/css,v1}`、`procell` 空目录），与本文第二节一致。本轮按你反馈补全：

1. **每版本目录强制带元数据+示例**：`default/`/`v1/`/`v2/` 每个都含 `meta.yaml` + 源 `.njk` + `sample.yaml` + 可选 `css/`；族目录 `<family>/` 含族级 `meta.yaml`（+可选 css/sample）。对齐 juice-cli「每目录自带元数据+示例」。
2. **元数据改 YAML**：`meta.yaml` / `sample.yaml`（你选 YAML，比 JSON 宽松；引 `js-yaml`）。
3. **版本命名统一** `<family>/<version>/`：`default` 作默认版本别名，`v1/v2` 作具名版本（Q2）。
4. **品牌隔离铁律**：片段仅本品牌模板可用，黑白名单同品牌内细控，禁止跨品牌（用户规则 #2）。
5. **编辑器定 Monaco**（Q7，功能更全、利于扩展）；`fragment/` 沿用你的命名。
6. **元数据去下划线**：用户修正「元数据是一等公民」→ 文件名 `meta.yaml`（非 `_meta.yaml`，与 juice-cli 不同；juice-cli 用 `_meta.yaml` 仅作参考形态）。
7. **双模解析自动切换**：系统内容按 `plugin.source`（`builtin`/`external`）自动解析 `baseDir+'assets/edm'`，无需单独配置（依据现有 `discovery.ts` / `runtime-installer.ts`）。

---

## 十、决策确认（本轮用户答复，待最终审核）

| # | 问题 | 用户裁定 |
|---|---|---|
| Q1 | 元数据格式 | **YAML**（`meta.yaml` / `sample.yaml`），引 `js-yaml` 解析；非 JSON |
| Q2 | 版本目录命名 | 统一 `<family>/<version>/`；`default` 作默认版本别名，`v1/v2` 作具名版本 |
| Q3 | 源真相 | **文件为源真相 + NeDB 作查询索引** |
| Q4 | 顶层 `edm/css/` 跨品牌公共样式 | **保留** |
| Q5 | 运行时系统内容解析路径 | **两种都实现，按 `plugin.source` 自动切换，无需单独配置**（依据 `discovery.ts` / `runtime-installer.ts` 现有机制） |
| Q6 | 品牌级 policy | 先支持模板/片段级，品牌级可选 |
| Q7 | 编辑器内核 | **Monaco**（功能更强更全，利于后续扩展） |
| Q8 | 元数据文件名 | **`meta.yaml`**（一等公民，不带下划线） |

> 上述为当前裁定，待你最终审核通过后，再就启动项**二次确认**、分步实施。本文件仅为规划，**未创建任何目录或代码**。
