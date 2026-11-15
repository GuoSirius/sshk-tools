# EDM 系统内容页改造与内容管理统一规划 v5（R12–R18）

- 日期：2026-11-15（v5：css 目录下探「片段/模板类目」级；EDM 根仅留粘贴、类目节点给重命名/删除/粘贴；css 另存为目标覆盖全部层级；所有控件补校验机制）
- 关联：`EDM目录结构与模板片段维护规划.md`（R1–R11 已落地）、台账 #26
- 背景：以「系统内容」页为 EDM 开发主阵地；完成后删除品牌/模板/片段三菜单，统一为**自定义内容**页（命名已拍板）

> **设计总纲（v2 收敛）**：EDM 是目标明确、结构固定的领域树，**不做通用文件系统管理**。
> 左树保持实体结构（EDM → 品牌 → 片段/模板（类目）→ 族 → 版本），仅在可能含 css 的层级多展示一级
> 「css 目录」；文件名除 css 文件外全部固定（meta.yaml / sample.yaml / fragment.njk / template.njk）。
> css 目录可出现在 **EDM / 品牌 / 类目(片段、模板) / 族 / 版本** 任一层（越往下就近优先级越高）。
> 好处：结构不易搞乱、开发者注意力集中。

---

## 一、总览

| 编号 | 名称 | 状态 |
|---|---|---|
| R12 | 编辑权限门控（dev / developerMode 解锁，否则只读） | 📋 待实现 |
| R13 | 左树实体结构 + css 目录级 + 分层右键菜单 | 📋 待实现 |
| R14 | 「另存为」向导（简化版） | 📋 待实现 |
| R15 | 示例数据表单化 + 表单↔数据切换 + 图片上传通道（本地/云） | 📋 待实现 |
| R16 | 模板↔片段调试联动 | 📋 待实现 |
| R17 | 元数据表单化 + 表单↔数据切换 | 📋 待实现 |
| R18 | 统一「自定义内容」菜单（收官，前置 R12–R17） | ✅ 已实现（R22b，左树形态与系统内容页一致） |
| — | R11 打包路径验证（`pnpm dist` assets/edm 随包） | ⏳ 用户实现完成后统一验证 |

---

## 二、R12 编辑权限门控

| 场景 | 系统内容页 |
|---|---|
| dev（`import.meta.env.DEV`） | 全权限编辑（直改 `tools/edm-studio/assets/edm/` 源文件，保存即生效） |
| build + `developerMode` 开 | **解锁编辑**（2026-11-15 拍板） |
| build 普通 | 纯只读：浏览、预览、**另存为派生到自定义库**（只读不等于不可派生） |

- 门控统一走既有铁律：`devFeatures = isDev || cfg.developerMode`，不新增开关变量。
- main 端写类 IPC 同步校验该门控（双保险，renderer 隐藏菜单 ≠ 安全边界）。

## 三、R13 左树结构 + css 目录级 + 右键菜单

### 3.1 树结构（v5：EDM → 品牌 → 片段/模板（类目）→ 族 → 版本 五层链，css 目录下探到类目级）

完整层级链：**EDM → 品牌 → 片段/模板（类目）→ 族 → 版本**，css 目录按需挂在 EDM / 品牌 / 类目 / 族 / 版本 各层（v5：类目级补 css 目录）：

```
EDM                                  # 顶层根（assets/edm）
├─ 🎨 css/                          # 全局 css（base-reset.css、uno.css）
├─ Elabscience（elabscience）        # 品牌
│  ├─ 🎨 css/                       # 品牌 css 目录
│  ├─ 📦 片段                        # 片段类目节点（分组层，v5：可挂 css）
│  │  ├─ 🎨 css/                    # 类目级 css 目录（v5 新增层级）
│  │  └─ 顶部横幅（banner）           # 族
│  │     ├─ 🎨 css/                 # 族级 css 目录（可能 0 个文件）
│  │     ├─ 🕐 default              # 版本
│  │     │  └─ 🎨 css/              # 版本级 css 目录（外置、就近引入）
│  │     └─ 🕐 v1
│  │        └─ 🎨 css/
│  └─ 🧩 模板                        # 模板类目节点（分组层，v5：可挂 css）
│     ├─ 🎨 css/                    # 类目级 css 目录（v5 新增层级）
│     └─ 标准邮件模板（standard）      # 族
│        ├─ 🎨 css/
│        ├─ 🕐 default
│        │  └─ 🎨 css/
│        └─ 🕐 v1
│           └─ 🎨 css/
└─ ProCell（procell）...
```

- css 目录可出现在 **EDM / 品牌 / 片段类目 / 模板类目 / 族 / 版本** 六处（v5 把片段、模板类目级补齐）；css 文件数量与命名不限。
- 类目级 css 作用域覆盖该类的全部族/版本（介于品牌级与族级之间）。
- 类目节点（片段/模板）**有自身 meta.yaml**（name/description/tags，2026-11-15 效果版用户拍板），右键 = 重命名/删除/粘贴，**无「另存为」**（分组层不浅拷贝）。
- 其余文件全部固定命名，不在树中展开（编辑入口在右侧 tab）。

### 3.2 两种 css 的区分（关键）

| 类型 | 位置 | 引入方式 | 编辑入口 |
|---|---|---|---|
| **外置 css** | EDM/品牌/类目/族/版本下的 `css/` 目录文件 | 渲染时 `<link>` 引入（就近链，越深优先级越高） | 左树 css 文件节点 → 多 tab 编辑 |
| **内联 css** | 版本级 `<verDir>/style.css`（效果版落定，文件名固定） | 渲染时 `<style>` 注入且**最后追加 = 优先级最高** | 版本详情「样式」tab（Monaco） |

- 版本详情 tab 命名（2026-11-15 用户拍板，按序）：**元数据、示例数据、预览、源码、样式**。

### 3.3 右键菜单（分层，v5 落定）

| 节点 | 菜单项 |
|---|---|
| **EDM（顶层根）** | 粘贴 ※1（v5：仅留粘贴；重命名/删除影响整个 assets/edm 与播种源，已移除） |
| 品牌 / 族 / 版本 | 另存为、重命名、删除、粘贴 ※1 |
| 片段 / 模板（类目） | 重命名、删除、粘贴 ※1（v5：补重命名/删除；无本层元数据故**无「另存为」**） |
| css 目录 | 另存为、复制、粘贴 ※2、新建文件、重命名、删除 |
| css 文件 | 另存为、复制、重命名、删除 |

- ※1 非 css 节点的「粘贴」按剪贴板内容**自动分流**（v3 规则保留）：
  - 剪贴板是 **css 目录** → 在该节点下整体粘贴生成 `css/` 目录及文件（版本节点下生成版本级 css/、类目节点下生成类目级 css/）；
  - 剪贴板是**单个 css 文件** → 自动粘贴进该节点对应的 css 目录，**目录不存在时自动创建**（用户#2/#3 需求，避免出错）。
- ※2 css 目录的「粘贴」：剪贴板是 css 目录 → 粘贴其所含的 css 文件（**目录不能粘进目录**）；剪贴板是单个 css 文件 → 直接粘贴该文件（按 #2/#3 同规则处理）。
- 冲突检测：**粘贴 / 重命名**遇同名必弹冲突框，用户抉择：`覆盖 / 自动改名保留两者 / 取消`。
- 危险操作（删除等）一律二次确认（ConfirmDialog 约定）。
- 编辑能力受 R12 门控：只读模式下右键菜单仅剩「另存为（派生到自定义库）」等非破坏项。

## 四、R14 「另存为」语义（v4：按层浅拷贝，只带本层内容）

### 4.1 各层另存为携带范围

| 源层 | 另存为携带内容 | 不携带 |
|---|---|---|
| **品牌** | 仅品牌元数据（品牌 meta.yaml） | 下属 css、片段、模板 |
| **族** | 仅族元数据（族 meta.yaml，含黑白名单 policy） | 下属 css、版本 |
| **版本** | **版本内所有文件 + 版本级 css 目录**（meta.yaml / sample.yaml / fragment.njk / template.njk / css/ 整体） | 品牌级/族级 css 与元数据 |

- EDM 顶层根**无「另存为」**（v5：EDM 仅留粘贴），故不在本表。
- 类目（片段/模板）**无「另存为」**：无本层元数据可浅拷贝，仅提供重命名/删除/粘贴。
- 浅拷贝原则：另存为只复制**该层自身**的内容，子层一概不跟（品牌另存为≠复制整个品牌）。
- 另存为产物去向：`系统内容（新副本）`〔仅 dev/developerMode〕 / `自定义内容库`〔任何模式可用，派生 origin=custom〕。

### 4.2 弹框（简化版，一屏）

| 字段 | 说明 |
|---|---|
| 新名称 / code | 默认带「副本」后缀；冲突实时校验 |
| 保存目标 | `系统内容（新副本）` / `自定义内容库` |

### 4.3 css 目录 / css 文件另存为（v3 规则保留：必须选目标）

- 目标为**树中任意一个 css 目录**：EDM / 品牌 / 类目(片段、模板) / 族 / 版本 各层 css 目录，含自身所在目录（同级复制为新名）。
- 弹框字段：目标 css 目录（树形下拉选择）+ 新名称（css 文件可改文件名；css 目录改目录名）；冲突实时校验。
- 剪贴板记忆：另存为不改动剪贴板；「复制」才写入剪贴板。

## 五、R15 示例数据表单化 + 数据切换 + 图片上传

### 5.1 fields schema（放 meta.yaml，已拍板）

```yaml
fields:
  - { key: title, label: 标题, type: input, required: true, group: 基础信息 }
  - { key: desc,  label: 描述, type: textarea }
  - { key: align, label: 对齐, type: radio, options: [left, center, right] }
  - { key: bg,    label: 背景图, type: image, upload: cloud:aliyun-main }  # 默认上传通道
  - { key: gallery, label: 图集, type: image-list, max: 6, upload: cloud:aliyun-main }  # 多图限数量（v4）
  - { key: items, label: 卡片列表, type: list, itemFields:
      - { key: name, label: 名称, type: input }
      - { key: icon, label: 图标, type: image-list } }
```

- 控件类型：`input / textarea / richtext / radio / checkbox / select / select-multi / image / image-list / list`（动态行、嵌套 itemFields、分组折叠）；**image-list 支持 `max` 限定上传数量**（v4）。
- **R15 已落地**（2026-11-15 效果版）：schema 归一化/默认值/校验纯函数层 `renderer/sample-schema.ts`（含单测）+ 递归渲染器 `renderer/SampleForm.vue`（嵌套 ≤3 层、校验标红、未通过阻止保存）；示例 tab `表单|数据` 切换，schema 取版本 meta `fields:` 优先、族 meta 兜底，无 schema 仅数据模式。当前 richtext 以多行文本兜底、image 以 URL 直填，wangEditor 与上传通道接入后替换（依赖 `@wangeditor/editor`、`@wangeditor/editor-for-vue` 已声明）。
- 富文本：**wangEditor 最新版**（已拍板；输出 HTML，契合邮件场景；依赖进 edm-studio package.json，用户安装）。
- **表单 ↔ 数据切换**（已拍板）：编辑区顶部 `表单 | 数据` 切换，「数据」即 schema 生成后的真实 sample.yaml，可查看/微调；无 `fields:` 的版本回退纯 YAML。

### 5.2 控件校验机制（v5 新增：所有控件类型必须有校验）

schema 每项可声明校验规则，表单实时校验（失焦/提交触发），不满足则字段标红 + 提示文案，阻止保存/导出：

| 控件 | 校验项（schema 字段） | 说明 |
|---|---|---|
| `input` | `required`、`minLength`、`maxLength`、`pattern`（正则串） | 文本长度与格式 |
| `textarea` | `required`、`minLength`、`maxLength` | 多行文本 |
| `richtext` | `required`、`maxLength`（纯文本计长，去 HTML 标签） | 富文本必填/限长 |
| `radio` | `required`（必须选一项） | 单选 |
| `checkbox` | `required`（至少 1 项）、`maxChecked`（最多 N 项） | 多选 |
| `select` | `required` | 下拉单选 |
| `select-multi` | `required`、`maxSelected`（最多 N 项） | 下拉多选 |
| `image` | `required`、`allowedTypes`（mime，如 `image/png,image/jpeg`）、`maxSize`（字节） | 单图上传 |
| `image-list` | `required`、`max`（数量上限，v4）、`allowedTypes`、`maxSize` | 多图上传 |
| `list` | `required`（最少行数 `minRows`）、`maxRows`（最多行数）、`itemFields` 递归校验 | 动态列表 |

- 校验时机：字段失焦即时校验；点击「保存/复制/导出」时整体校验，未过则聚焦首个错误并阻断。
- 分组（group）仅作视觉折叠，不参与校验；`required` 缺省为 false。
- 无 schema 的版本（回退 YAML）不跑控件校验，按 YAML 合法性校验（为空/格式错提示）。

### 5.3 图片上传通道（工具配置一次性配好）

| 通道 | 配置 | 说明 |
|---|---|---|
| 本地上传 | 上传目录位置（可配置） | 多用于开发/测试；产物 URL 为本地/相对路径 |
| 云上传（可多朵） | 阿里云 OSS 等，各云的 bucket/AccessKey 等在**工具配置**一次性配置 | 生产首选（邮件外链可访问） |

- 字段级选择：示例数据上传时可按板块（字段）选 本地 / 某朵云；schema `upload:` 声明默认通道。
- 首期云 Provider：阿里云 OSS（`ali-oss` 官方包）；抽象 Provider 接口便于后期加腾讯云 COS 等。

## 六、R16 模板↔片段调试联动（v1 结论保留）

| 场景 | 设计 |
|---|---|
| 模板选片段（可重复） | 模板 sample 的片段引用为列表，同一片段可添加多行（不同区块），行 = `{ fragment, version, block }`；表单化为「可重复片段选择器 + 排序」 |
| 片段选宿主模板 | 片段版本预览选宿主模板版本，以模板 sample 为底注入当前片段调试整体效果 |

## 七、R17 元数据表单化 + 数据切换

- 表单字段：显示名、code、描述等常见信息 + **黑白名单 policy**（逗号分隔、标签内可含空格）。
- 同样提供 `表单 | 数据` 切换查看真实 meta.yaml。
- 仍落 meta.yaml；品牌/族级节点右侧 = 元数据编辑/展示。

## 八、R18 统一「自定义内容」菜单（收官）

- 前置：R12–R17 完成。
- 删除品牌/模板/片段三管理菜单 → 合并为 **「自定义内容」**（命名已拍板）。
- 职责：自定义品牌/模板/片段 CRUD（NeDB、origin=custom），支持基于系统内容或自定义内容「另存为/派生」；沿用 #25 表格约定。
- 「系统内容」保留：dev/developerMode = 源码开发台；普通 build = 只读浏览 + 派生源。
- ✅ **2026-11-15 落地（R22b/R23）**：`pages/CustomLibraryPage.vue`，与系统内容页**同构**——左树（品牌 → 片段/模板类目 → 族 → 版本）+ 右侧五 tab 与系统内容页同序同功能（§3.2）：**元数据**（表单↔数据双向同步）/ **示例数据**（设计↔表单↔数据，fields schema 存版本）/ **预览**（单渲）/ **源码**（njk）/ **样式**（css inline）。**左树仅列 origin=custom 实体**（系统内容只作派生源，不在本页展示）；custom 全权直编（版本原地保存生效，D8 仅约束系统内容），版本可「复制为新族」派生。菜单顺序：邮件管理 → 系统内容 → 自定义内容 → 工具配置，默认进入邮件管理。新增 `frgv:update`/`tplv:update`（label/policy/type/description/fields/sampleData/source）/`frgv:remove`/`tplv:remove`/`version:render` 通道。
- ⚠️ 与系统内容页的结构差异（数据域不同，非偏差）：自定义库无文件域，css 全部 inline 随版本存储（无 css 目录层级、无 style.css 外置文件）；外置 css 仅系统内容域适用。

## 九、遗留确认

| # | 问题 | 状态 |
|---|---|---|
| Q1 | 删除操作已纳入各节点右键 | ✅ 已定 |
| Q2 | developerMode 解锁编辑 | ✅ 已拍板：解锁 |
| Q3 | 另存为双语义（系统内副本 / 派生自定义库） | ✅ 已定 |
| Q4 | 富文本 = wangEditor 最新版 | ✅ 已拍板 |
| Q5 | 图片上传 = 本地（可配目录）+ 多云（工具配置），字段级选择 | ✅ 已拍板 |
| Q6 | schema 放 meta.yaml | ✅ 已拍板 |
| Q7 | css 文件补「复制」 | ✅ 已拍板：补充 |
| Q8 | EDM 根节点的重命名/删除（影响整个 assets/edm 目录与播种源） | ✅ v5 落定：EDM 根**仅保留「粘贴」**，移除重命名/删除/另存为，彻底规避误伤播种源 |
| Q9 | EDM 层另存为携带「EDM 元数据」，但当前顶层无元数据文件 | ✅ v5 落定：随 Q8 一并移除 EDM 另存为，无需顶层 meta.yaml |
| Q10 | 片段/模板类目节点的右键形态（仅分组导航，无元数据无 css） | ✅ v5 落定：类目节点 = 重命名、删除、粘贴（无「另存为」，因无本层元数据） |
