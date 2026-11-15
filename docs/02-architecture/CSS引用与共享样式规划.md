# CSS 引用与共享样式规划（R28，2026-11-15 讨论稿）

> 触发：用户疑问 ① 自定义/系统自带的 css 按 root 隔离是否成立、该怎么引入、有没有统一格式、要不要自己写 `../../xxx/xxx`；② 样式重置 / unocss / 公共样式希望只在系统自带维护一份、自定义可跨区复用，该怎么办。
> **状态：讨论稿，待拍板**。本轮不改 CSS 代码（属 EDM 收尾批次，不占 R26/R27 的 B1–B8）。

## 一、现状（代码走读证据）

| 事实 | 证据 |
|---|---|
| **无显式引用** | `meta.yaml` 实测只有 `version` / `changelog`，**没有 `css` 字段**；css 靠目录约定自动收集 |
| **就近自动汇集** | `core/system-css.ts::collectSystemCss(root, sel)` 依次读 `<root>/css` → `<brand>/css` → `<brand>/<kind>/css` → `<family>/css` → `<version>/css`，目录下所有 `.css` 全收；再拼 `<version>/style.css` |
| **顺序即优先级** | 越近越靠后 → 覆盖优先：顶层 → 品牌 → 类目 → 族 → 版本 → 版本级 `style.css` |
| **source 隔离天然成立** | `ipc.ts::content:render` 先 `resolveContentRoot(source)` 取 root，再传 `renderSystemPreview` / `renderSystemCompose` → `collectSystemCss`；所有路径都是 `path.join(root, ...)`，**没有任何跨根路径** |
| **模板/片段天然分家** | 类目层路径含 `sel.kind`（`template` / `fragment`），各自只读自己的 `<kind>/css` |

> **用户判断 ✅ 成立**：自定义模板/片段只会读 `custom-edm` 根下的 css，不会跨到系统自带；系统自带同理。现有实现已保证，无需额外改动。

## 二、疑问 1：怎么引入？要不要自己写 `../../`？

**不需要写任何路径**。把 `.css` 放进对应层级的 `css/` 目录即自动生效：

| 放到哪一层 | 作用域 | 汇集序 |
|---|---|---|
| `<root>/css/` | 该来源下**全部**品牌/模板/片段 | 1（最远，优先级最低） |
| `<root>/<brand>/css/` | 该品牌全部模板与片段 | 2 |
| `<root>/<brand>/<template\|fragment>/css/` | 该类目下全部族/版本 | 3 |
| `<root>/<brand>/<kind>/<family>/css/` | 该族全部版本 | 4 |
| `<root>/<brand>/<kind>/<family>/<version>/css/` | 该版本 | 5 |
| `<version>/style.css` | 该版本内联样式 | 6（最后，优先级最高） |

- 同一层多个 `.css` 全部收集；⚠️ 现状 `fs.readdir` 未显式排序，同层顺序依赖文件系统（见 C-T1，建议 `.sort()` 保证确定性）。
- **「统一格式」现状没有、也不需要**：这是目录约定式隐式引用，不是路径引用。
- 若将来确需「点对点引用某个具体文件」，建议用**带命名空间的逻辑 URI**（如 `shared:base-reset.css` / `source:/css/brand.css`），**不要引入裸 `../../` 相对路径**——相对路径会随版本层级漂移、易越权、跨 source 时语义不明。

## 三、疑问 2：公共样式只维护一份、自定义可复用

### 现状缺口（这是真问题）

- 系统根 `assets/edm/css/` 已有公共文件：`base-reset.css`（跨品牌重置，181B）、`uno.css`（基线注释）、`demo.css`。但 `collectSystemCss(customRoot, ...)` 只读 `custom-edm/css` → **自定义完全拿不到这些公共样式**。
- 工具包另有一份 `tools/edm-studio/assets/base-reset.css`（完整 normalize 精简版，1321B），由 `core/css-bundle.ts::ensureBaseReset` 复制到产物系统；`compose.ts` **仅在传 `outputRoot` 时** 经 `collectCss` 注入 `base-reset + unocss 原子类`。
- **`system-css.ts`（内容管理预览 / 组合链路）没接这个基座** → 预览里工具自带 reset 与 uno 原子类可能未生效，且两套 reset 并存（`assets/edm/css/base-reset.css` 与工具自带版）。

### 推荐方案：把公共样式「提升为应用层基座」，而不是做跨区引用

汇集顺序改为（**前两层与 source 无关，两个来源共用同一份**）：

```
① 应用基座（工具自带，只读、随应用发布）
     base-reset.css + unocss 运行时生成 + 公共组件类
② 共享层 shared（用户可编辑；唯一允许被两个 source 同时读的公共目录）
     assets/edm/_shared/css/*.css
③ <source 根>/css        ← source 私有，严格按 root 隔离
④ 品牌 → ⑤ 类目 → ⑥ 族 → ⑦ 版本 → ⑧ style.css
```

- ①② 不属于任何 source 根 → **天然只维护一份**，自定义与系统自带都自动获得，**用户无需声明任何跨区引用**。
- ③ 起仍严格按 root 隔离 → 完全不破坏疑问 1 的结论。
- 解析时对 `..` 做拦截、共享层走白名单只读；可复用 `@sshk/repository::resolveSafe` 与 main 侧 `confine`。
- 现有 `assets/edm/css/base-reset.css` / `uno.css` 建议迁到共享层，消除两套 reset 并存。

### 待拍板（1 项）：共享层放哪

| 选项 | 落点 | 取舍 |
|---|---|---|
| **A（推荐）** | 工具自带 `tools/edm-studio/assets/edm-shared/` | 彻底不跨区、随应用发布只读、结构最干净；但改公共样式要动工具包 |
| **B** | 系统根 `assets/edm/_shared/css/` | 符合「在系统自带里定义」的直觉，用户在内容管理页即可编辑；需引入一条受控跨区白名单 |
| **A+B** | ①工具基座只读 + ②用户共享层可编辑 | 最灵活，多一层目录与配置 |

> 无论选哪个，**用户都不写路径、不写 `../../`**；差别只在公共文件的物理落点与可编辑性。

## 四、任务拆分（EDM 收尾批次，不占 B1–B8）

| # | 任务 | 落点 |
|---|---|---|
| C-T1 | `collectSystemCss` 同层 `fs.readdir` 结果显式 `.sort()`，消除顺序不确定性 | `core/system-css.ts` |
| C-T2 | 抽取 `collectSharedCss()`，接入 `renderSystemPreview` / `renderSystemCompose`；`system-css.ts` 与 `css-bundle.ts` 共用同一份 reset / uno 基座 | `core/` |
| C-T3 | 按拍板结果建共享层目录 + 白名单/越权校验；迁移现有公共 css | `assets/` + `ipc.ts` |
| C-T4 | 验证：自定义与系统自带预览均含同一份共享样式；自定义私有 css 不串到系统根，反之亦然 | 预览 / 单测 |
