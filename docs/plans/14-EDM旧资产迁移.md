# EDM 旧资产迁移计划（juice-cli/edm → 系统自带内容库）

- 状态：**已定稿并落地（2026-11-24 全批次 0~7 执行完毕，verify 全绿并已推送 main）**
- 版本：v0.2（v0.1 → v0.2：敲板裁决落档；activity/video 不迁移；母版残留块与占位表改判迁移；版本目录统一 default；css 链路统一为「显式 link 优先 + 就近回退」单路径；uno 直用结论；richtext 插值链路确认）
- 最后更新：2026-11-24（北京时间；全批次落地，实施记录见 §九）
- 关联需求：台账登记于执行批次 0；关联文档 `02-architecture/EDM系统内容页改造与内容管理统一规划_v6.md`（EDM 唯一权威）、`00-CONVENTIONS.md` §5.8 迁移兼容克制原则
- 旧资产源：`D:\workspace\code\juice-cli\edm\`（外部目录，不进本仓库；只读参照）

---

## 〇、敲板裁决记录（2026-11-24 用户反馈 17 条 → 结论）

| # | 反馈 | 结论（落档） |
|---|---|---|
| 1 | njk 能否直接用 unocss + juice 正确内联 | **可以**（依赖已装、链路已内建，见 §1.4）；批次 0 统一链路后预览/生成一致 |
| 2 | 两模板公用 css 提取放系统根 css/，link 引入 | 采纳：交集部分上提 `assets/edm/css/`（= @shared），njk 显式 `<link href="@shared/…">` 引入 |
| 3 | activity、video 片段不迁移 | 采纳：两族弃用；连带 needSearch 搜索框、四平台 iframe 问题一并消失 |
| 4 | css 双链路理解不对，应只走「显式 link + 无 link 回退就近链」一条路径，预览与生成不区分 | **核实属实需改造**：现状预览与生成确实是两条分叉链路（见 §1.3），批次 0 统一为用户口径单路径 |
| 5 / 9 | 迁移版本统一放 `default/`，v1 预留下一版 | 采纳：全部迁移内容落 default/；现有 v1 目录原样保留不动 |
| 6 | 变量插值需支持句中局部 HTML（加粗/标红/sup/sub） | **链路已满足**：fields 声明 `type: richtext`（wangEditor 图文混排）→ HTML 值入库 → njk `{{ key \| safe }}` → juice 内联；迁移规范强制富文本字段走此链（§4.1） |
| 7 | 跨品牌复制残留块需要迁移 | 改判：属正常布局，迁移（图片上传错位顺带修正为正确品牌资源） |
| 8 | 空 href 占位表需要迁移 | 改判：占位模板本就如此，迁移（链接做可选字段，填了才渲染 href） |
| 10 | 优先显式写 link 引入 | 采纳：迁移资产一律显式 `<link>`；就近链仅作无 link 时回退 |
| 11 | 通用片段尽量都提取，尤其是可重复项 | 采纳扩充版（≈原方案③口径去死代码）：母版结构块全部模式化提取（§3.3 族清单） |
| 12 | D-B 母版大 HTML 处置 | 采纳原推荐：不整体迁移，standard 重建为骨架；母版内容以片段族形式承接（配合 #11） |
| 13 | D-C 先保真迁移、后邮件兼容整改 | 采纳：批次 6 独立做兼容整改 |
| 14 | D-D / D-E | 随 #3 失效（activity/video 不迁移） |
| 15 | D-F fields schema | 采纳原推荐：全部迁移版本一次性声明到位 |
| 16 | D-G 演示资产 | 直接覆盖 default，保留 v1 |
| 17 | D-H 前置代码改造 | 采纳：播种刷新对齐 custom 语义 + css 源去重 + **css 链路统一**（并入 #4） |

---

## 一、背景与承接契约

### 1.1 旧实现现状（juice-cli/edm）

| 维度 | 现状 |
|---|---|
| 品牌 | elabscience（伊莱瑞特）、procell（普诺赛）两棵树 |
| 模板 | `<brand>/templates/standard/template.html`：**纯静态整封邮件 HTML**（elab 4851 行 / procell 3350 行），零模板语法，历期邮件拼盘母版，每次整封复制手工删减 |
| 样式 | 全部内联在模板顶部约 900 行单一 `<style>`：重置区 + 公用组件类（标题/表格/按钮/图标列表/bg 色板）+ 手写原子类（`pb-8`/`text-center`/`text-size-[14px]` 等 UnoCSS 风格）；两品牌同源复制，差异 = 色板映射 + 各自少数组件类 |
| 片段 | `<brand>/series/<name>/default/snippet.html`：Mustache 局部模板（无 Handlebars helper/partial/三括号），配 `juice.yaml`（示例数据）与四层 `_meta.yaml`（仅 name/description） |
| series | elab：activity（弃用）/ literature / new-arrivals / video（弃用）/ webinar；procell：activity（弃用）/ literature |
| 使用方式 | juice CLI 渲染 snippet + variables；母版纯手工复制删减 |

### 1.2 新系统承接契约（已落地，本迁移补内容 + 少量前置代码）

- 目标位置：**系统自带内容库** = `tools/edm-studio/assets/edm/`（dev 态直接编辑，打包态随 extraResources 发布）。
- 资产树：`品牌(meta.yaml+css/) → 类目(fragment|template, meta.yaml+css/) → 族(meta.yaml) → 版本(default/, 内含 fragment.njk|template.njk + meta.yaml + sample.yaml + css/)`。
- 语法：Nunjucks（autoescape 默认开）；模板族 meta `slots:` 声明区块，模板 njk 内 `{{ slot_<key> | safe }}`；片段按 slot/order/repeat 摆放（统一组合引擎 `core/compose.ts`）。
- 播种：文件为源真相，NeDB 只作索引（`origin='system'` 只读；dev/developerMode 可编辑系统文件）；邮件生成用播种快照（html/css 内联）。

### 1.3 css 链路现状核实（批次 0 改造依据，回应用户 #4）

逐行核实 `system-css.ts` / `compose.ts` / `css-bundle.ts` / `mail.ts` / `system.ts` / `content.ts` 后确认，**现状预览与生成确实是两条分叉链路**（用户记忆的"只有一条路径"尚未实现）：

| | 内容页预览（`system:render` / `content:render`） | 邮件预览/生成（`mail:preview` / `mail:generate`） |
|---|---|---|
| css 来源 | **显式 `<link>` 优先**（`collectLinkedCss` 解析 `@shared/@root/@system/@custom`/`./`，剥离 link，`<style>` 注入 head）；**无 link 回退就近链**（各级 `css/` + 版本 style.css） | **播种快照内联**（seed 时就近链快照进 `source.css`）直接拼接，**不解析 link**（njk 里的 link 标签会原样漏进邮件成品） |
| base-reset / uno 原子类 | **无**（不扫 njk、不生成 uno） | **有**（`compose(outputRoot)` 扫描 njk → uno 生成 + base-reset 前置） |

**批次 0 统一为单路径（用户口径）**，四条入口（system:render / content:render / mail:preview / mail:generate）共用同一个 css 解析函数：

```
resolveCssBundle({ sources })            # sources = 参与渲染的全部 njk 源 + 各自 fallback css + 各自解析根
  ① 任一源含显式 <link rel="stylesheet"> → 按书写顺序解析（@shared/@root/@system/@custom/./）→ 去重 → 读内容
     → 从各 html 剥离 link（两条链路都剥，杜绝 link 漏进邮件成品）
  ② 全部源均无 link → 回退就近链（预览=读文件就近链；生成=播种快照 source.css，二者本就同源同序）
  ③ 前置 base-reset + uno 原子类扫描（两条链路一致，见 §1.4）
  ④ 结果以 <style> 注入 head → juice 统一内联
```

改造点：① 预览侧补 base-reset + uno 扫描；② 生成侧补 link 解析（按实体 origin 推导解析根：system → 系统根，custom → 自定义根；版本目录由实体 ID/label 推导，支撑 `./css/…` 引用）；③ css 源**内容级去重**（模板链与片段链都引品牌 css 时只收一份，消除体积膨胀 N+1）；④ 播种刷新对齐 custom 语义（见 §六批次 0）。

### 1.4 uno 直用结论（回应用户 #1）

**njk 源码可直接写 UnoCSS 原子类**，链路已内建且依赖已安装（`@unocss/core` + `@unocss/preset-wind3` 在 edm-studio dependencies）：

```
njk 源码（如 <td class="pb-8 text-center text-[14px]">）
  → 组合引擎扫描全部参与 njk 源 → uno generator 按 preset-wind3 生成用到的原子类 css
  → 与 base-reset、link/就近 css 按序汇成 <style> 注入 head
  → juice applyStyleTags 把规则内联到每个元素的 style 属性 → 邮件客户端兼容
```

- **响应式可用**：`md:` 前缀类生成 `@media (min-width:768px)`，juice `preserveMediaQueries: true` 保留 media query（旧 activity 里 Bootstrap `d-md-block` 的同类诉求，新版用 uno 原生达成——旧版受限点正是缺这一环）；
- **交互伪类无效**：`hover:`/`focus:` 等在邮件无意义，迁移时不使用；
- **任意值语法可用**：`text-[14px]`、`w-[42%]` 等（对应旧手写 `text-size-[14px]`）；
- 旧手写原子类与 uno 原子类**并存不冲突**：存量 css 文件保持手写类；新增/改写内容可逐步换 uno 类（生成态自动扫描，无需登记）。

---

## 二、旧资产盘点结论（迁移依据）

> 逐块盘点（两母版 60+ 区块、series 逐段、CSS 三分区、语法清单、怪癖 10 条）已完成，此处固化迁移所需结论。

### 2.1 模板母版结构（两品牌同构）

```
<table class="app">                ← 750px 居中骨架 + 4 列 colgroup(10px|auto|auto|10px)
  header    页头：logo 通栏图 + 3 个导航链接（elab L950-999 / procell L784-833）
  main      主体：60+ 内容区块堆叠，区块间隔统一 <td class="h-24"> 空行
  footer    页尾：社交图标行 + 虚线分隔 + 公司联系信息（elab L4706-4845 / procell L3199-3344）
```

### 2.2 Mustache → Nunjucks 对照（series 语法盘点结论）

| Mustache | Nunjucks | 说明 |
|---|---|---|
| `{{var}}` | `{{ var }}` | 默认转义；富文本字段例外见 §4.1 |
| `{{#sec}}…{{/sec}}` 布尔/对象开关 | `{% if sec %}…{% endif %}` | |
| `{{^sec}}…{{/sec}}` | `{% if not sec %}…{% endif %}` | |
| `{{#lists}}…{{.}}` 字符串数组迭代 | `{% for item in lists %}{{ item }}{% endfor %}` | |
| 对象数组迭代 | `{% for it in lists %}{{ it.title }}{% endfor %}` | |
| 嵌套二维迭代 `{{#rows}}{{#.}}` | 两层 `{% for %}` | 仅 new-arrivals grid 模式 |
| 条件属性 `{{#x}}href="{{x}}"{{/x}}` | `{% if x %}href="{{ x }}"{% endif %}` | 链接可选（含 #8 占位表场景） |

`className`/`itemClassName` 类"CSS 类名当数据字段"的写法**保留**（保真迁移；语义化演进另行立项）。

### 2.3 不迁移清单（随 #3/#14 更新）

| 类别 | 明细 | 处置 |
|---|---|---|
| 弃用 series | activity、video（两品牌全部） | **不迁移**（needSearch 搜索框死代码、四平台 iframe 问题随之消失） |
| HTML 注释块 | 两模板 10+ 处注释代码（pinterest 图标、注释列等） | 丢弃 |
| 站点环境残留 | Bootstrap 工具类依赖、Vue SSR 属性、`data-src` 懒加载、`id="searchedHidden"` 调试残留 | 随 activity 不迁移；其余区块提取时顺带剥离 |
| 拼写错误 | `w-1001`/`ttps://`/`Paticial`/`text-center1`/`font-size-0` 等未定义类与错链 | 迁移时顺带修正 |

**改判迁移（v0.1 曾列不迁移，按 #7/#8 敲板改判）**：
- 跨品牌"残留"块（elab 尾部 L4371-4418 对比表、L4645-4701 推荐产品卡）——布局归属本就正确，仅图片资源传错位置，迁移并修正图片；
- 空 href 占位表（两品牌 Cited Product / Recommended 表 41 处）——占位模板属性，迁移；链接在字段里可选，填了才渲染 href。

---

## 三、目标资产树设计

### 3.1 迁移后树形（以 elabscience 为例，procell 同构）

```
assets/edm/
├── css/                                  ← 顶层公共层（@shared；#2：两模板公用 css 提取至此）
│   └── email-utils.css                   ← 两品牌逐字相同的重置区 + 通用原子类交集
│                                            （现演示文件 normalize.css / uno.css 属早期 demo，一并清场删除）
├── elabscience/
│   ├── meta.yaml                         ← 已有；补 description/favicon
│   ├── css/
│   │   ├── palette.css                   ← 品牌色板（bg-*：#006db8/#3a82db/#f7750b 系）
│   │   ├── components.css                ← 品牌组件类（title 系/wifi-/gold-/circle-/square-icon-title、
│   │   │                                    button 系、table-bordered/stripe/dashed 系、装饰图标列表类）
│   │   └── brand-utils.css               ← 品牌特有原子类/修饰类（**实施批注**：该文件从未被任何 njk link，
│   │                                        品牌色被 unocss 同名 Tailwind 默认值 + CSS 变量覆盖；已并入 palette.css，文件删除）
│   ├── fragment/
│   │   ├── header/default/{meta.yaml, fragment.njk, sample.yaml, css/}
│   │   ├── footer/default/{…}
│   │   ├── banner/default/{…}            ← 覆盖现演示 default；现演示 v1 保留不动（#16）
│   │   ├── literature/default/{…}        ← series literature 迁移（elab + procell）
│   │   ├── new-arrivals/default/{…}      ← series new-arrivals 迁移（elab）
│   │   ├── webinar/default/{…}           ← series webinar 迁移（elab）
│   │   └── <模式族…>/default/{…}         ← 批次 5 母版穷举提取（§3.3 族清单）
│   └── template/
│       └── standard/
│           ├── meta.yaml                 ← 族：code/name/description/slots 声明
│           ├── css/template.css          ← .app 骨架（750px+colgroup+h-N 间隔行）
│           ├── default/                  ← 迁移骨架版（覆盖现演示 default）
│           │   ├── meta.yaml / template.njk / sample.yaml / css/
│           └── v1/                       ← 现演示版原样保留（#16），预留给下一版开发
```

版本与命名约定：
- **迁移版本一律 `default/`**（版本号=目录派生 1）；**现有 v1 目录一律不动**（#5/#9/#16）。default（迁移真相）与 v1（旧演示）并存期，树中 latest 取 default（readdir 字母序 default 在前，同版本号 1 先者胜）。
- 片段族 code = 目录名（kebab-case）；meta `name` 中文显示名；品牌间同构族同 code。
- css 引用**优先显式 `<link>`**（#10），约定四条路径形态：
  - 顶层公共：`<link rel="stylesheet" href="@shared/email-utils.css">`
  - 品牌层：`<link rel="stylesheet" href="@root/elabscience/css/palette.css">`（custom 派生副本 @root 自动指向自定义根，派生时品牌 css 整树拷贝，路径不失效）
  - 版本内：`<link rel="stylesheet" href="./css/xxx.css">`（相对版本目录，禁止 `..`）
  - **不用族级 `css/`**（避免 `@root/<brand>/<kind>/<family>/css/…` 长路径）：片段/模板私有 css 一律放版本 `default/css/`；跨片段共用即上提品牌层
- njk 内不出现其他外链 stylesheet；每个 njk 声明自己需要的完整依赖集，收集侧自动去重（重复声明无害）。

### 3.2 CSS 分层映射表（样式分离规则）

| 旧 `<style>` 分区（elab 行号） | 新落位 | 引入方式 |
|---|---|---|
| 重置区 L25-72（两品牌逐字相同） | 顶层 `email-utils.css` | @shared |
| 通用原子类两品牌交集（间隔/排版/颜色/定位等） | 顶层 `email-utils.css` | @shared |
| 骨架类 .app/.header/.main/.footer L75-131 | `template/standard/css/template.css` | 模板 njk `./css/`? 否——骨架 css 在族级 css/，**用 `@root/<brand>/template/standard/css/template.css` 显式引入**（族级 css/ 目录只此一处特例，其余场景不用族级） |
| 表格组件 / 标题类 / 装饰图标 / 按钮 | 品牌 `components.css` | @root |
| bg-* 色板 | 品牌 `palette.css` | @root |
| 品牌特有原子类差集 | 品牌 `brand-utils.css`（**实施批注**：已并入本品牌 `palette.css`，随所有 default njk 的 palette link 生效） | @root |
| 页面特定类（.card/.word-cloud-item；procell .poster） | 随对应片段版本 `default/css/`；无主的丢弃 | `./css/` |

### 3.3 片段族清单（#11 扩充口径：可复用尽量提取，批次 5 按此细化命名）

> 分组按视觉模式归并；同一模式的不同区块 → 同族不同 sample/字段变体。标注 ★=母版内重复 ≥2 次（可重复项优先）。行号为 elab 母版（procell 行号在执行时对照盘点）。

| 组 | 族（暂名） | 承接区块（来源） | 说明 |
|---|---|---|---|
| 骨架 | header ★ | 页头 logo+导航（950-999；procell 784-833） | 批次 2 |
| 骨架 | footer ★ | 页尾社交+联系（4706-4845；procell 3199-3344） | 批次 2 |
| 骨架 | banner ★ | 通栏大图（1011-1017；procell 845-851）+ series banner 三件套（image/link/keywords） | 批次 2；字段兼容 series 形态 |
| series | literature | 文献引用四件套：overview 引用卡 + information 虚线摘要卡 + 产品表 + 推荐区 | 批次 3；procell 版多 recommendedLists 字段 |
| series | new-arrivals | banner+词云+两列表+产品展示双模式 | 批次 3 |
| series | webinar | banner+报名卡×2+礼品+讲师卡 | 批次 3 |
| 标题 | heading ★ | 各类标题条（square-/wifi-/gold-/circle-/rectangle-/title-slash 变体） | variant 字段选品牌类名；与 title-lead 拆分：heading=纯标题条，title-lead=标题+导语 |
| 标题 | title-lead ★ | 标题+导语段（2063-2091 等 ≥4 处；procell 853-876） | |
| 图文卡 | image-card ★ | 图左文右卡全变体（图比例 25%~42%、灰底/白卡/下载手册卡/Academy 卡/产品线图文卡三连 3951-4118） | 母版最高频模式，字段支撑已知变体 |
| 图文卡 | triple-gallery ★ | 三列图卡（3597-3645/4645-4701；procell 1477-1595） | |
| 图文卡 | offer-card | 双列促销卡（procell 1371-1475） | |
| 图文卡 | cta-strip ★ | 浅色底 CTA 卡：圆点列表+按钮（1079-1123） | |
| 图文卡 | citation-card | 出版引用背书卡（3307-3351） | |
| 图文卡 | trusted-banner | Trusted by Researchers 背书条（2744-2797） | |
| 列表 | icon-list ★ | 装饰图标列表（17 种图标类，className 字段；1147/2354 等） | |
| 列表 | bullet-list ★ | 圆点/星标列表（3529/3563） | |
| 列表 | feature-list ★ | Product Features：标题+列表+右对齐按钮（1816/2799/3836） | |
| 列表 | arrow-strip | 灰底圆角箭头列表条（1641-1814 Related Reading） | |
| 表格 | product-table ★ | 产品三列表（table-stripe/gray-stripe；2893/4420-4500；procell 2044/2922-3136） | **含空 href 占位形态**（#8）：link 可选字段 |
| 表格 | spec-compare | 双栏规格对比表（procell 2691-2772；elab 4371-4418"残留"块同模式，#7 迁移） | |
| 产品 | data-demo ★ | Data Demonstration：大图+图注/双列（1859/2842/3871） | |
| 产品 | product-single | 单品卡：Features/Validation+大图+指针+按钮，蓝橙变体（2953-3088） | |
| 产品 | grid-cards | 2×2 宫格（FIND YOUR FIT/优势宫格；procell 1112/1970；elab 3213/4363） | |
| 营销 | promo-compare | 双 Promo 对照卡（procell 1855-1956） | |
| 营销 | how-to-order | 流程大图+优势宫格卡（2250-2352） | |

> 一次性纯文案段（如 envelope 提示行、Keywords 行）不单独建族——由 title-lead/bullet-list 等通用族以数据承接。批次 5 执行时若发现新模式块再补族；命名定稿随批次 5 提交。

---

## 四、迁移映射规则

### 4.1 富文本插值链路（回应用户 #6，已核实现有链路满足）

句中局部加粗/标红/上下标（`<strong>`/`<span style="color:…">`/`<sup>`/`<sub>`）的实现路径，**现有表单→保存→渲染链路完整支持**：

```
meta.yaml fields 声明 type: richtext
  → 示例/邮件数据表单渲染 wangEditor 图文混排编辑器（@sshk/form-schema FormFieldRenderer 17 类控件之一；
    另有 richtext「AI 润色」diff 写回已内建）
  → HTML 字符串随数据保存（sample.yaml / 邮件 data）
  → njk 输出 {{ key | safe }}（唯一关口：不标 | safe 会被 autoescape 转义成纯文本）
  → juice 将 <strong>/<sup>/<sub>/<span style> 原样保留（本就是内联标签/内联样式，邮件客户端兼容）
```

迁移纪律（强制）：
1. **字段级声明**：句中需要局部样式的字段一律 `type: richtext`；普通文案字段保持纯文本类型（默认转义，防注入）。
2. **`| safe` 白名单化**：njk 中只对 fields 声明为 richtext 的字段输出加 `| safe`；每个 njk 的 safe 使用点必须在 fields 里有对应 richtext 声明，禁止无声明裸加。
3. wangEditor 产出即内联样式（颜色等 `<span style="…">`），不经 class，juice 链路零额外处理。

### 4.2 数据迁移

- series：`juice.yaml` 的 `variables:` → 版本 `sample.yaml`（剥注释壳；修正怪癖值如 `color-primary1`→真实类名；图片 URL 补 `https:` 并对空格/全角字符 encode）。
- 母版提取族：无旧数据，迁移者按来源行号真实内容裁 1~2 条示例新写 `sample.yaml`；跨品牌"残留"块（#7）示例数据修正为正确品牌图片。

### 4.3 元数据迁移（#15：fields 一次性声明到位）

- 四层 `_meta.yaml` → 族 `meta.yaml`（code/name/description）+ 版本 `meta.yaml`（code/name）。
- **每个迁移版本声明完整 `fields:`**（input/textarea/richtext/select/image/image-list/list，契约同 @sshk/form-schema），示例数据与真实数据全程表单化可填。

### 4.4 模板 slots（standard · 双品牌）

```
slots:
  - { key: header, label: 页头 }
  - { key: body,   label: 正文 }   # 同槽多片段按 order 排序拼接
  - { key: footer, label: 页尾 }
```

- 骨架保留旧 `.app` 表格骨架与 colgroup（750px 居中）；`<td class="h-24">` 间隔由片段自带（片段自治）。
- banner/activity 等（除弃用者）全部作为片段摆入 body。

---

## 五、敲板结论汇总

见 §〇 敲板裁决记录（17 条已全部落档，含 css 链路统一、uno 直用、richtext 链路确认三项核实结论）。

---

## 六、批次拆分（终审后执行；每批 verify 全绿即 commit+push）

> 批次内全部**路径限定提交**（工作树另有在途未提交改动：ContentManagePage/useDetailTab/code-editor/rich-text 及 template/standard/v1 演示文件——v1 按 #16 保留不动，天然避开冲突）。执行期间 `pnpm dev` 实测内容管理页左树/预览/组合/邮件生成。

| 批次 | 内容 | 交付物 | 验证口径 |
|---|---|---|---|
| **0 前置代码**（#4/#17） | ① css 链路统一：新 core 纯函数 `resolveCssBundle`（显式 link 优先 → 就近回退 → base-reset+uno 前置 → 剥离 link），四入口 system:render / content:render / mail:preview / mail:generate 共用；生成侧按实体 origin 推导解析根与版本目录；② css 源内容级去重；③ `seedSystemContent` 对齐 custom 语义（已存在未归档系统实体按文件刷新 source/fields/sample，文件已删未归档清理，archived 跳过不复活）；④ 单测覆盖四入口一致性 | core 改造 + 单测 | vitest 全绿；dev 实测同一资产「内容页预览 = 邮件预览 = 生成三阶段」样式一致 |
| **1 公共样式层 + 清场**（#2/#10） | 顶层 `css/email-utils.css`（两母版交集提取）；双品牌 `css/{palette,components,brand-utils}.css`；品牌 meta 补全；清场：删顶层 demo `normalize.css`/`uno.css` | 4 个 css + meta | 预览单版本：品牌类/公用类经 @shared/@root link 生效；custom 派生副本引用不失效 |
| **2 基础三族**（双品牌） | header / footer / banner：Nunjucks 重写 + 显式 link + sample + fields + `default/css/`；banner 覆盖演示 default（v1 不动） | 6 个版本 default | 单版本预览 + 挂 standard 组合预览，对照旧母版页头/页尾视觉 |
| **3 series 迁移**（elab 3 + procell 1） | literature（双品牌）/ new-arrivals / webinar：Mustache→Nunjucks、juice.yaml→sample.yaml、fields 全声明、richtext 字段按 §4.1 链路 | 4 个版本 default | 各族单渲 + 组合预览；sample 走 mail:generate strict=true 冒烟；富文本字段句中加粗/标红/上下标渲染比对 |
| **4 模板重建**（双品牌） | standard：族 meta（slots 三槽）+ `css/template.css`（.app 骨架）+ `default/` 骨架 njk + sample；v1 原样保留 | 2 个模板 default | 邮件管理走通全流程：选模板 → 摆片段（header/banner/literature/footer）→ 示例预览 → 生成三阶段 |
| **5 母版穷举提取**（#11，双品牌） | 按 §3.3 族清单模式化提取（~24 族/品牌，含 #7 残留块、#8 占位表），命名定稿 | ~24 族 × 2 品牌 | 全部族单渲 + 组合预览抽检；与旧母版逐组视觉对照 |
| **6 邮件兼容整改**（#13 第 2 步） | ::before/::after 标题装饰、nth-child 斑马纹、linear-gradient 按钮、box-shadow/圆角降级、absolute 布局 hack 等改邮件兼容写法 | css/njk 修订 | Outlook 类客户端口径逐块核对；视觉回归对照批次 2~5 存档 |
| **7 收口** | 台账登记；00-index 变更记录；本文档状态改「已定稿并落地」+ 实施记录（各批 commit 号）；旧母版视觉抽检三块（页头/页尾/文献卡）人工比对 | 文档 + 登记 | `pnpm verify` 全绿；推送 main |

依赖：0 → 1 → 2 →（3、4 可并行）→ 5 → 6 → 7；每批独立可交付、可暂停。

---

## 七、风险与坑（迁移时逐条核对）

1. **播种幂等坑（批次 0 未落地前禁改资产）**：系统播种现状"存在即跳过"，banner/standard 的 default 换真实内容后 NeDB 索引仍是演示 HTML → 批次 0 ③ 解决。
2. **css 链路分叉（批次 0 未落地前预览≠生成）**：批次 0 ① 统一；迁移全程以「预览=生成」为验收基准。
3. **link 泄漏**：统一前生成态 njk 里的 `<link>` 会原样漏进邮件成品 → 统一后两条链路均剥离；迁移资产由批次 0 保证。
4. **`./` 引用的生成态解析**：播种实体无路径，版本目录须由实体 ID（`frg_sys_<brand>_<fam>` / `cus_frgv_…`）+ label 推导 → 批次 0 ① 覆盖；推导失败的实体回退就近快照并告警。
5. **strict 渲染**：生成态缺字段即抛错；所有可选字段 `{% if %}` 守卫，fields/sample 给默认值。
6. **`| safe` 纪律**：仅 richtext 声明字段加（§4.1），迁移时逐 njk 自查。
7. **两套原子类并存**：存量手写类进 css 文件；uno 类即写即用（自动扫描）。批次 6 前不做混改，避免视觉回归难定位。
8. **URL 卫生**：旧图片 URL 含空格/全角、`//` 协议相对 → sample 统一补 `https:` 并 encode；#7 残留块图片换成正确品牌资源。
9. **并发会话**：在途未提交改动勿扫入；路径限定 `git add` + 提交前 `git status` 复核。
10. **default 与 v1 并存**：同族下 default（迁移真相）与 v1（旧演示）同版本号 1，latest 取 default（字母序）；组合编辑器选版本时注意选 default。

---

## 八、执行声明

- 终审通知后按 §六批次顺序执行；每批完成即 verify + 路径限定 commit + push + 核验 message，并在批次表标注 commit。
- 执行中发现与盘点不符的细节（行号漂移/结构差异）以实际源文件为准，台账补记；本计划盘点章节不回改（历史结论加批注）。

---

## 九、实施记录（2026-11-24 全批次落地）

| 批次 | 内容 | 提交 | 验证 |
|---|---|---|---|
| 0 | CSS 单链路统一（四入口共用 resolveCssBundle、内容级去重、播种刷新） | `4e63cfd` | 四入口单测 + `pnpm verify` |
| 1 | 公共样式层（email-utils / palette / components / brand-utils，演示 css 清场） | `e238a1a` | 单版本 link 生效 + `pnpm verify` |
| 2 | 基础三族（双品牌 header / footer / banner default） | `097ac1a` | 单版本 + 组合预览 + `pnpm verify` |
| 3 | series 迁移（literature 双品牌、new-arrivals、webinar 的 Nunjucks 化） | `47fdbf3` | 严格渲染 + safe 纪律 + `pnpm verify` |
| 4 | 标准模板重建（双品牌三槽骨架，v1 保留） | `7410d47` | 邮件全流程组合预览 + `pnpm verify` |
| 5 | 母版穷举提取（双品牌 22 个模式族 default） | `4a464c7` | 资产守护测试 + `pnpm verify` |
| 6 | 邮件兼容整改（真实装饰元素、显式斑马纹、渐变纯色回落、去阴影/绝对定位） | `86732b0` | 新增 `edm-mail-compat.test.ts`；90 文件 / 554 tests |
| 7 | 收口（计划状态、台账 #187、索引变更记录） | 本提交（收口文档） | 最终 `pnpm verify` 全绿并推送 main |

> 落地口径补丁：批次 5 族数最终为 26/品牌（基础 4 + series + 22 模式族），守护测试断言据此下调为 `>=26`；批次 6 渐变保留 `background-image` 视觉增强，但同规则必须声明 `background-color` 纯色回落供 Outlook 降级。
