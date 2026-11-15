# CSS 引用与共享样式规划（R28，2026-11-15）

> 触发：用户疑问 ① 自定义/系统自带的 css 按 root 隔离是否成立、该怎么引入、有没有统一格式、要不要自己写 `../../xxx/xxx`；② 样式重置 / unocss / 公共样式希望只在系统自带维护一份、自定义可跨区复用，该怎么办。
> **状态**：§一–§四 是**初版讨论稿，主推荐已被用户否定**（保留作历史，不篡改）；最终落地方案见 **§五**。代码已实现于 `561dab8`。

## 一、现状（代码走读证据，初稿）

| 事实 | 证据 |
|---|---|
| **无显式引用** | `meta.yaml` 实测只有 `version` / `changelog`，**没有 `css` 字段**；css 靠目录约定自动收集 |
| **就近自动汇集** | `core/system-css.ts::collectSystemCss(root, sel)` 依次读 `<root>/css` → `<brand>/css` → `<brand>/<kind>/css` → `<family>/css` → `<version>/css`，目录下所有 `.css` 全收；再拼 `<version>/style.css` |
| **顺序即优先级** | 越近越靠后 → 覆盖优先：顶层 → 品牌 → 类目 → 族 → 版本 → 版本级 `style.css` |
| **source 隔离天然成立** | `ipc.ts::content:render` 先 `resolveContentRoot(source)` 取 root，再传 `renderSystemPreview` / `renderSystemCompose` → `collectSystemCss`；所有路径都是 `path.join(root, ...)`，**没有任何跨根路径** |
| **模板/片段天然分家** | 类目层路径含 `sel.kind`（`template` / `fragment`），各自只读自己的 `<kind>/css` |

> **用户判断 ✅ 成立**：自定义模板/片段只会读 `custom-edm` 根下的 css，不会跨到系统自带；系统自带同理。现有实现已保证，无需额外改动。

## 二、疑问 1：怎么引入？要不要自己写 `../../`？（初稿结论，后被否定）

初稿认为**不需要写任何路径**，把 `.css` 放进对应层级的 `css/` 目录即自动生效：

| 放到哪一层 | 作用域 | 汇集序 |
|---|---|---|
| `<root>/css/` | 该来源下**全部**品牌/模板/片段 | 1（最远，优先级最低） |
| `<root>/<brand>/css/` | 该品牌全部模板与片段 | 2 |
| `<root>/<brand>/<template\|fragment>/css/` | 该类目下全部族/版本 | 3 |
| `<root>/<brand>/<kind>/<family>/css/` | 该族全部版本 | 4 |
| `<root>/<brand>/<kind>/<family>/<version>/css/` | 该版本 | 5 |
| `<version>/style.css` | 该版本内联样式 | 6（最后，优先级最高） |

- 同一层多个 `.css` 全部收集；⚠️ 初稿 `fs.readdir` 未显式排序，同层顺序依赖文件系统（C-T1 建议 `.sort()`，**已落地**）。
- 初稿建议「若将来确需点对点引用，用带命名空间的逻辑 URI，不要引入裸 `../../`」——**这条被采纳并成为最终方案的核心**。

## 三、疑问 2：公共样式只维护一份、自定义可复用（初稿方案，后被否定）

### 现状缺口（这是真问题）

- 系统根 `assets/edm/css/` 已有公共文件：`base-reset.css`（跨品牌重置）、`uno.css`、`demo.css`。但 `collectSystemCss(customRoot, ...)` 只读 `custom-edm/css` → **自定义完全拿不到这些公共样式**。
- 工具包另有一份 `tools/edm-studio/assets/base-reset.css`，由 `core/css-bundle.ts::ensureBaseReset` 复制到产物系统；`compose.ts` **仅在传 `outputRoot` 时**经 `collectCss` 注入 `base-reset + unocss 原子类`。
- `system-css.ts`（内容管理预览 / 组合链路）没接这个基座 → 两套 reset 并存。

### 初稿推荐（已否决）：把公共样式「提升为应用层基座」

```
① 应用基座（工具自带，只读、随应用发布）
② 共享层 shared（用户可编辑；唯一允许被两个 source 同时读的公共目录）
③ <source 根>/css ← source 私有，严格按 root 隔离
④ 品牌 → ⑤ 类目 → ⑥ 族 → ⑦ 版本 → ⑧ style.css
```

- 初稿认为用户「不写路径、不写 `../../`」即可自动获得公共样式，并给出 A（工具自带）/ B（系统根 `_shared/css`）/ A+B 三个落点待拍板。

> ⚠️ **用户明确否定该方向**：就近收集会引入过多、不好控制顺序；公共目录里的 css **不是全部公用**（如 a/b 依赖 c，e/d 依赖 f，不希望 f 被引入 a/b）。用户要求「**由用户在源码里自己 link 控制**」，并「保持现有结构不动、可跨区引入、简洁、不能 `../../`」。

## 四、任务拆分（初稿，C-T1~C-T4；实际只落地 C-T1 的一部分）

| # | 任务 | 实际结果 |
|---|---|---|
| C-T1 | `collectSystemCss` 同层 `.sort()` | ✅ 已落地（兼容回退链） |
| C-T2 | 抽取 `collectSharedCss()` 应用基座 + 共享层 | ❌ 方向被否定，未实现 |
| C-T3 | 建 `_shared/css` 共享层目录 + 白名单 | ❌ 方向被否定，未实现 |
| C-T4 | 验证两个 source 共用同一份共享样式 | ❌ 改为验证显式 link 的跨区引用与去重 |

## 五、最终落地方案（R28，`561dab8`）

### 5.1 机制：显式 `<link>` + 逻辑 URI + head 提前去重

| 环节 | 实现 |
|---|---|
| 源码声明 | 用户在模板/片段 `.njk` 里写 `<link rel="stylesheet" href="...">`，**自己决定引哪些、什么顺序** |
| 逻辑 URI | 禁止 `..`；`@shared/` 指系统根 `css/`（跨区唯一推荐通道，保持现有结构不动）、`@root/` 当前 source 根、`@system/` 系统根、`@custom/` 自定义根、`./css/a.css` 当前版本目录 |
| 收集 | `core/css-refs.ts::collectLinkedCss` 按源码出现顺序提取 stylesheet link → 解析成绝对路径 → 去重（片段 repeat 多份 / 多个片段引同一 css 只收一次）→ 读 css 内容 → **从源码剥离 link** |
| 注入 | `core/css-bundle.ts::injectCss` 改为 `injectCssIntoHead`：把所有 css 统一以 `<style>` 注入 `<head>`，后续 juice 内联；顺序 = 源码首次出现顺序 |
| 兼容 | 参与预览的源码**完全没有 link** 时回退 R5 就近链（保护存量资产），回退链同层文件名 `.sort()` 保证确定性 |
| 跨区 | `ipc.ts::content:render` 传 `cssRoots = { systemRoot, customRoot }`，`@shared` 恒指系统根 `css/` → 公共样式**只维护一份**、自定义可引用，且不会误引无关 css |

### 5.2 推荐写法

```html
<link rel="stylesheet" href="@shared/base-reset.css">
<link rel="stylesheet" href="@root/css/brand.css">
<link rel="stylesheet" href="./css/version.css">
```

| 写法 | 含义 | 适用 |
|---|---|---|
| `./css/a.css` | 当前版本目录（不允许含 `..`） | 版本私有样式 |
| `@root/css/a.css` | 当前 source 根（自定义来源下即 custom-edm） | source 内公共 |
| `@shared/a.css` | **系统根 `css/`**，跨区唯一推荐通道 | 公共 reset / uno / 组件类 |
| `@system/css/a.css` | 显式系统根 | 明确指定系统资源 |
| `@custom/css/a.css` | 显式自定义根 | 明确指定自定义资源 |

> 外链 `http(s):` / `data:` / `file:` 直接跳过（不注入、不剥离）；缺失文件或非法引用产生 warning，不阻断渲染。

### 5.3 验证

- `core/css-refs.test.ts`：7 项单测覆盖四种 scope 解析、自定义来源下 `@root` 与 `@shared` 分离、`..` 报错、首次出现顺序去重、缺失文件告警、head 注入、link 剥离。
- `core/css-bundle.test.ts` 断言更新为 head 注入。
- **仍需用户实跑**：真实模板/片段预览中 `@shared` 跨区生效、片段 repeat 不重复注入、无 link 的存量资产回退正常。
