# EDM 系统内容页改造与内容管理统一规划（R12–R18）

- 日期：2026-11-15
- 关联：`EDM目录结构与模板片段维护规划.md`（R1–R11 已全部落地）、台账 #26
- 背景：以「系统内容」页为 EDM 开发主阵地改造；完成后删除品牌/模板/片段三个管理菜单，统一为一个内容管理菜单
- 状态：**需求落档待评审**（与用户多轮沟通后逐项实现）

---

## 一、总览

| 编号 | 名称 | 一句话 | 依赖 | 状态 |
|---|---|---|---|---|
| R12 | dev/build 权限门控 | dev 系统内容页全权增删改（直接开发模板/片段+实时预览）；build 纯只读 | — | 📋 待实现 |
| R13 | 左树文件系统化 + 右键菜单 | 按真实目录/文件结构展示，右键菜单按类型分层（文件管理器机制） | R12 | 📋 待实现 |
| R14 | 「复制为」向导 | 弹框向导：选目标类型/归属/命名，拷贝新建或另存为 | R13 | 📋 待实现 |
| R15 | 示例数据表单化 | meta.yaml 声明字段 schema → 表单渲染器（多控件类型、分组、动态列表、图片上传） | R12 | 📋 待实现 |
| R16 | 模板↔片段调试联动 | 模板示例中片段可重复引用多次；片段预览需选宿主模板 | R15 | 📋 待实现 |
| R17 | 元数据表单化 | 常见信息 + 黑白名单的简易表单（替代纯 YAML 文本） | R15 | 📋 待实现 |
| R18 | 统一内容管理菜单 | 删除品牌/模板/片段三个管理菜单，合并为一个自定义内容管理页 | R12–R17 全部完成 | 📋 待实现（收官） |
| — | R11 打包路径验证 | `pnpm dist` 后 assets/edm 是否随包 | 用户实现完成后统一验证 | ⏳ 已记录，延后 |

---

## 二、R12 dev/build 权限门控

| 模式 | 系统内容页 | 说明 |
|---|---|---|
| dev（`pnpm dev`） | **全权限**：增删改、文件级操作、表单编辑、实时预览 | 直接编辑 `tools/edm-studio/assets/edm/` 源文件，保存即生效（开发模板/片段的主工作台） |
| build（安装版） | **纯只读**：只能浏览与预览 | 资产位于 `resourcesPath/edm-studio/assets/edm`（asar 外）；不设编辑后门 |

- 门控实现走既有铁律：dev 判定用 `import.meta.env.DEV`（renderer）/ main 端等价判定；**不引入新的开关变量**。
- ⚠️ 待确认 Q2：安装版 `developerMode` 打开时是否解锁系统内容编辑？**默认：否**（始终只读，编辑能力仅 dev 存在）。

## 三、R13 左树文件系统化 + 右键菜单

### 3.1 树结构（按磁盘真实结构）

```
assets/edm/
├─ css/                      # 全局 css（base-reset / uno）
├─ elabscience/
│  ├─ meta.yaml              # 品牌元数据
│  ├─ css/brand.css
│  ├─ fragment/banner/       # 片段族
│  │  ├─ meta.yaml           # 族元数据（含黑白名单 policy）
│  │  ├─ default/            # 版本目录
│  │  │  ├─ fragment.njk     # 源文件
│  │  │  ├─ meta.yaml        # 版本元数据
│  │  │  └─ sample.yaml      # 示例数据
│  │  └─ v1/ ...
│  └─ template/standard/ ... # 模板族同构
└─ procell/ ...
```

- 树节点 = 真实目录/文件（品牌目录、meta.yaml、brand.css、族目录、版本目录、njk/sample 文件级粒度），不再是纯实体抽象。
- 新增 FS IPC（白名单动作集）：`fs:list / fs:read / fs:write / fs:createDir / fs:copy / fs:rename / fs:delete`，路径一律限制在 `assets/edm` 根内（防目录穿越）；build 模式下写类动作直接拒绝。

### 3.2 右键菜单（按节点类型分层）

| 节点类型 | 菜单项 |
|---|---|
| 品牌目录 | 新建目录、新建文件、复制、复制为、重命名、删除※ |
| 片段族/模板族目录 | 新建版本目录、复制、复制为、重命名、删除※ |
| 版本目录 | 复制、复制为（→新版本/其他族/自定义库）、重命名、删除※ |
| 普通目录（css/ 等） | 新建目录、新建文件、复制、粘贴、重命名、删除※ |
| 文件（njk/yaml/css） | 复制、粘贴、复制为、重命名、删除※ |
| 树空白区 | 新建目录、粘贴 |

- 用户明列六类：**新建目录、新建文件、复制为、复制、粘贴、重命名**；※ **删除待确认 Q1**（dev 全权限语义下建议补上，文件管理器机制没有删除不完整）。
- 复制/粘贴：内部剪贴板（内存态记录源路径），粘贴时校验目标层级合法性（njk 只能进版本目录等）。

## 四、R14 「复制为」向导

单弹框分步（或一屏分区）向导：

| 步骤 | 内容 |
|---|---|
| 1 目标类型 | 品牌 / 片段族 / 模板族 / 版本 / 自定义库实体（按源节点类型过滤可选项） |
| 2 目标归属 | 选目标品牌（系统内复制）或「自定义内容库」（派生为 origin=custom 实体，落 NeDB） |
| 3 命名 | 新 code（目录名/实体 id slug）+ 显示名；冲突实时校验 |
| 4 执行 | 系统内 → FS 拷贝（css 就近链一并处理）；到自定义库 → 走既有 saveAsNew 播种式派生 |

- 即用户所说的「拷贝新建 / 另存为」双语义；系统实体在 build 下经此向导**只可派生到自定义库**（不可系统内复制，保持只读）。

## 五、R15 示例数据表单化（字段 schema）

### 5.1 schema 声明（meta.yaml 新增 `fields:` 块）

```yaml
fields:
  - key: title          # 对应 sample.yaml 的键
    label: 标题
    type: input         # 控件类型
    required: true
    group: 基础信息      # 分组
  - key: desc
    label: 描述
    type: textarea
  - key: align
    label: 对齐
    type: radio         # radio / checkbox / select / select-multi
    options: [left, center, right]
  - key: bg
    label: 背景图
    type: image         # image / image-list
  - key: items
    label: 卡片列表
    type: list          # 动态新增行，行内字段由 itemFields 声明
    itemFields:
      - { key: name, label: 名称, type: input }
      - { key: icon, label: 图标, type: image }
```

- 控件类型首期清单：`input / textarea / richtext / radio / checkbox / select / select-multi / image / image-list / list（动态行，支持嵌套 itemFields）`。
- **无 `fields:` 声明时回退现有 YAML 文本编辑**（兼容存量）；schema 本身可在 dev 下用 Monaco 编辑（YAML）。
- 新组件 `SampleForm.vue`：分组折叠渲染、sample.yaml ↔ 表单双向同步、必填/类型校验。

### 5.2 待确认项

| # | 问题 | 建议 |
|---|---|---|
| Q4 | 富文本编辑器选型 | wangEditor v5（国产、输出 HTML、适合邮件场景、成熟第三方包）；备选 tiptap |
| Q5 | 图片上传落盘位置 | 系统内容 dev：`assets/edm/<品牌>/assets/`；自定义库：NeDB 产物目录；预览用相对路径 |
| Q6 | schema 放 meta.yaml 是否认可 | 是（与内容同目录、随复制/派生一起走） |

## 六、R16 模板↔片段调试联动

| 场景 | 设计 |
|---|---|
| 模板选片段（可重复） | 模板 sample.yaml 中片段引用为**列表**，同一片段可添加多行（不同区块/位置），每行 = `{ fragment: banner, version: v1, block: header }`（block 为区块标识，njk 内按 block 渲染对应片段实例）；表单化后为「可重复选择的片段选择器 + 排序」 |
| 片段选宿主模板 | 片段版本预览页新增「宿主模板」选择器（选某品牌下某模板版本），以该模板 sample 为底、把当前片段注入预览，调试整体效果 |
| njk 侧契约 | 片段实例化按 block 输出；模板 njk 中 `{% for inst in fragments %}{% include inst.path %}` 按序渲染（与现有渲染器对齐，落地时细化为确切数据结构） |

## 七、R17 元数据表单化

- 表单字段（非 YAML 文本）：显示名、code、描述、排序/图标等常见信息 + **黑白名单 policy**（blacklist/whitelist 各自 tags 输入，沿用「逗号分隔、标签内可含空格」规则）。
- 仍落 meta.yaml；表单与 YAML 视图可切换（表单为主、源码为辅）。

## 八、R18 统一内容管理菜单（收官）

- **前置：R12–R17 全部完成并验证**。
- 删除「品牌管理 / 模板管理 / 片段管理」三个菜单，合并为一个菜单；「系统内容」保留（build 下只读浏览 + 派生源；dev 下即源码开发台）。
- 新页面职责：用户自定义品牌/模板/片段 CRUD（NeDB、origin=custom），支持基于系统内容或自定义内容「复制为/派生」；沿用 #25 表格/操作/弹框约定。

### 菜单命名候选（待用户拍板）

| 候选 | 语义 | 备注 |
|---|---|---|
| **自定义内容** ⭐ | 与「系统内容」成对：系统=只读源，自定义=可编辑库 | 直白、零歧义 |
| 内容管理 | 大气但泛 | 与「系统内容」对仗弱 |
| 我的内容 | 亲切、个人库语义 | 偏 C 端口吻 |
| 自定义内容库 | 强调库属性 | 略长 |
| EDM 内容 | 域明确 | 工具内多 EDM 语境时冗余 |

## 九、待确认问题汇总（多轮沟通用）

| # | 问题 | 默认方案 |
|---|---|---|
| Q1 | 右键菜单是否补「删除」（用户未列） | 建议补，dev 专属 |
| Q2 | 安装版 developerMode 是否解锁系统内容编辑 | 否，build 恒只读 |
| Q3 | 复制为的目标含「派生到自定义内容库」 | 是（双语义：系统内复制 / 派生入库） |
| Q4 | 富文本选型 | wangEditor v5 |
| Q5 | 图片上传落盘位置 | 系统 → assets/edm/<品牌>/assets/；自定义 → 产物目录 |
| Q6 | fields schema 放 meta.yaml | 是 |
