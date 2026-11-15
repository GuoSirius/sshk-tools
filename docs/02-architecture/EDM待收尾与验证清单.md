# EDM 模块待收尾与验证清单（2026-11-15）

> 来源：R1–R24 已落地，用户要求罗列「未收尾 / 未验证」项并落档，先行上传能力定稿与实现，再接入后续。
> 状态说明：**待实现**=功能缺口；**已实现·待验证**=代码就绪、待 dev 实跑确认；**待复查**=健壮性/依赖。

## 一、待实现（功能缺口）

| # | 项 | 说明 / 落点 |
|---|---|---|
| E1 | **上传能力整体未实现** | 仅 `tool.manifest.json` 的 `config-upload`/`config-cloud` 配置骨架 + `sample-schema.ts` 的 `upload` 字段声明（R15.3，标注「接入后生效」）；无 Provider / Service / 真实上传逻辑；无任何代码消费这两个 configGroup。 |
| E2 | **EDM 图片 / 富文本图片未接真实通道** | `ImageField.vue` 仅本地文件→dataURL（FileReader），未接 FTP/SFTP/云；富文本图片同理。待上传能力（R26）落地后迁移。 |
| E3 | **打包发布 R11 未验证** | electron-builder `extraResources` 把 `assets/edm` 打进 `resources/edm-studio/assets/edm`；本地未跑完整打包验证（用户此前要求等实现完成后统一验证）。 |

## 二、已实现·待运行验证（代码就绪，待 dev 实跑）

| # | 项 | 说明 |
|---|---|---|
| V1 | **自定义内容（custom-edm）全链路** | 薄索引 `seedCustomContent`、按 `source` 路由读写、`system:derive` 跨根拷贝、另存为跨根 + 类型隔离 + 版本 `content:listDir` 全量复制、版本右键「新建版本（同级）」、类目排序 css→模板→片段——代码完成，未在实际 dev 运行中验证。 |
| V2 | **预览渲染** | `content:render` 指向 customRoot、组合预览 host 模板过滤（policyAllows）、juice 内联——未运行验证。 |
| V3 | **右键新建全链路** | 新建品牌 / 片段族 / 模板族 / 版本 / 样式（原「新建文件」）实际创建文件并刷新树——未运行验证。 |
| V4 | **另存为跨根 / 类型隔离 / 版本全量复制** | 逻辑就绪未运行验证（跨 custom↔system、模板与片段不得互串、版本递归全量拷贝）。 |
| V5 | **EDM 与邮件编辑器 / 生成串联** | 薄索引后 `origin=custom` 的模板 / 片段能否被邮件生成正确取用——未验证。 |

## 三、待复查 / 健壮性

| # | 项 | 说明 |
|---|---|---|
| C1 | **配置默认值与密钥持久化** | `config-upload`/`config-cloud` 字段默认值、`password`/`accessKeySecret` 的 safeStorage 持久化、SFTP 被动模式等未在 Config UI 落实（当前仅 schema 字段，无消费逻辑）。 |
| C2 | **依赖 / 漏洞复查** | dependabot 此前报 5 漏洞（dompurify 已修），后续新漏洞未复查。 |
| C3 | **跨平台路径** | `splitPath` 已兼容 `/` 与 `\`，但自定义根在 packaged（userData）与 dev（assets）两套路径的实际读写边界建议补一轮冒烟。 |

## 四、推进顺序建议

1. **上传能力定稿 + 实现（R26：T1–T7）** —— 当前重点，先打通本地，再 FTP/SFTP，再云；配套上传配置工具。
2. **接入 EDM（T8 / E2）** —— 上传产物回写内容资源引用，图片控件迁移到共享服务。
3. **运行期验证（V1–V5）** —— 用户在 dev 实跑，逐条核对双顶层树 / 右键 / 另存为 / 预览。
4. **打包验证（E3）** —— 实现收尾后统一跑 electron-builder 打包确认 R11。
5. **健壮性复查（C1–C3）** —— 密钥托管、漏洞、跨平台冒烟。
