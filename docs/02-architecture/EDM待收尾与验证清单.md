# EDM 模块待收尾与验证清单（2026-11-15，R26/R27/R28 落地后更新）

> 来源：R1–R24 已落地，用户要求罗列「未收尾 / 未验证」项并落档，先行上传能力定稿与实现，再接入后续。
> **本轮更新**：上传能力（R26 T1–T8）、共享编辑器（R27 E-T1–E-T5）、CSS 显式引用（R28）均已实现并推送；E1/E2/C1 关闭，剩余项全部是**运行期 / 打包期验证**。
> 状态说明：**待实现**=功能缺口；**已实现·待验证**=代码就绪、待 dev 实跑确认；**待复查**=健壮性/依赖。

## 一、待实现（功能缺口）

| # | 项 | 说明 / 状态 |
|---|---|---|
| E3 | **打包发布 R11 未验证** | electron-builder `extraResources` 把 `assets/edm` 打进 `resources/edm-studio/assets/edm`；本地未跑完整打包验证（用户此前要求等实现完成后统一验证）。**唯一剩余待办**。 |
| ~~E1~~ | ~~上传能力整体未实现~~ | ✅ **已关闭**：`packages/upload-core`（Service + Local/Remote/Cloud Provider）、宿主 `upload:*` IPC、`tools/upload-config` 全局多 profile 配置工具（safeStorage）、工具级 `upload` configGroup 全部落地（`e63def9` / `9021b69` / `d9f4119`）。 |
| ~~E2~~ | ~~EDM 图片 / 富文本图片未接真实通道~~ | ✅ **已关闭**：`ImageField.vue` 与富文本 `onUploadImage` 共用 `renderer/upload.ts::uploadImageFile`，走 `upload:single` 回填服务端 URL；失败回退 dataURL 不阻断离线编辑（`87c79d3`）。 |

## 二、已实现·待运行验证（代码就绪，待 dev 实跑）

| # | 项 | 说明 |
|---|---|---|
| V1 | **自定义内容（custom-edm）全链路** | 薄索引 `seedCustomContent`、按 `source` 路由读写、`system:derive` 跨根拷贝、另存为跨根 + 类型隔离 + 版本全量复制、版本右键「新建版本（同级）」、类目排序 css→模板→片段——未在实际 dev 运行中验证。 |
| V2 | **预览渲染** | `content:render` 指向 customRoot、组合预览 host 模板过滤（policyAllows）、juice 内联——未运行验证。 |
| V3 | **右键新建全链路** | 新建品牌 / 片段族 / 模板族 / 版本 / 样式实际创建文件并刷新树——未运行验证。 |
| V4 | **另存为跨根 / 类型隔离 / 版本全量复制** | 逻辑就绪未运行验证。 |
| V5 | **EDM 与邮件编辑器 / 生成串联** | 薄索引后 `origin=custom` 的模板 / 片段能否被邮件生成正确取用——未验证。 |
| V6 | **R28 CSS 显式引用** | `<link>` + `@shared/@root/@system/@custom` 逻辑 URI、禁 `..`、head 提前去重、片段 repeat 不重复注入、无 link 存量资产回退就近链——7 项单测通过，未 dev 实跑。 |
| V7 | **上传通道真实链路** | 本地目录自检（`tools/upload-config` 的自检按钮）、真实 FTP/SFTP 连接、阿里云 OSS、进度事件 UI、工具级 overrides 覆盖全局 profile、校验收紧（工具不能放宽）——均未连真实服务验证。 |
| V8 | **共享编辑器运行期** | Monaco 多 tab 唯一 model URI / wangEditor 全屏 / 深色主题 / md↔html 单向互转；badge-studio 的 CodeEditor JSON 视图——构建通过，未 dev 实跑。 |
| V9 | **T8 内联图片回写** | `saveSample()` 前 `uploadInlineImages()` 把 sample.yaml 里的 `data:` 图片批量上传并回写 URL——3 项单测通过，未 dev 实跑。 |

## 三、待复查 / 健壮性

| # | 项 | 说明 |
|---|---|---|
| C2 | **依赖 / 漏洞复查** | dependabot 此前报 5 漏洞（dompurify 已修）；本轮新增 `basic-ftp` / `ssh2` / `ali-oss` / `marked` / `turndown`，尚未复查新漏洞。 |
| C3 | **跨平台路径** | `splitPath` 已兼容 `/` 与 `\`，但自定义根在 packaged（userData）与 dev（assets）两套路径的实际读写边界建议补一轮冒烟。 |
| C4 | **打包期 Node 依赖** | `basic-ftp`/`ssh2`/`ali-oss` 内联进 main bundle；`cpu-features` 用构建期 shim 替换，需确认打包后 SFTP 仍能回退纯 JS 探测。 |
| ~~C1~~ | ~~配置默认值与密钥持久化~~ | ✅ **已关闭**：全局配置走 `app.upload.*`（`normalizeUploadConfig` 容错归一化），密钥走 safeStorage（`upload:secret:set` / `upload:secret:state` 只回布尔），SFTP 被动模式等已在配置工具 UI 落地。 |

## 四、推进顺序（更新）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 上传能力定稿 + 实现（R26 T1–T7） | ✅ 完成 |
| 2 | 接入 EDM（T8 / E2）+ 共享编辑器迁移（R27 E-T1–E-T5）+ R28 CSS | ✅ 完成 |
| 3 | 运行期验证（V1–V9） | ⏳ **下一步：用户 dev 实跑**，逐条核对 |
| 4 | 打包验证（E3 / C4） | ⏳ 实现收尾后统一跑 electron-builder |
| 5 | 健壮性复查（C2 / C3） | ⏳ 新依赖漏洞、跨平台冒烟 |

> 建议验证顺序：先用「上传配置」页的**链路自检**打通本地目录（`V7` 第一步）→ 内容管理页试 `@shared` 引用与片段 repeat（`V6`）→ 上传一张图片看 URL 回填（`V2`/`V9`）→ 再查 V1/V3/V4/V5 与共享编辑器（`V8`）→ 最后跑打包（`E3`）。
