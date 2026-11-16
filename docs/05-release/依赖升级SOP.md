# 依赖升级 SOP（A-T4，2026-11-16 落档）

- 适用：全仓 pnpm 依赖升级（安全驱动或功能驱动）；非必要不主动批量升级。
- 关联：`00-index.md` 文档清单（本档登记于此）；发布流程 §四；踩坑 #17（Vue2/Vue3 双线库）。

## 流程

0. **触发条件**：安全漏洞（`pnpm audit` / Dependabot 报警）或功能需要；**非必要不主动批量升级**。
1. **升级前**：`git status` 必须干净 → 记录当前 lockfile 摘要（`git log -1 --format=%h -- pnpm-lock.yaml`）。
2. **执行**：
   - 定点：`pnpm up <pkg>@latest`（优先，变更面最小）；
   - 全量：`pnpm up --latest`（仅 audit 全线告警或大版本节奏需要时）；
   - **例外（永远钉大版本）**：Vue2/Vue3 双线库（`@vue/composition-api`、`vue-demi`、`editor-for-vue` 之类），升 latest 会破坏双线兼容——见踩坑 #17。
3. **必跑验证**：`pnpm verify`（13 道门禁 + desktop build + 全部单测）→ `pnpm audit --registry=https://registry.npmjs.org`（官方源复核，镜像源 audit 不可信）。
4. **破坏处理**：
   - TS 大版本类 breaking（如 TS5→TS6）：参照 D24 模式——受控例外写入 `check-latest` 白名单，其余全量 latest；
   - API breaking：修复改动单独 commit（不与 lockfile 混合），commit message 说明适配点。
5. **提交**：`pnpm-lock.yaml` 变更**单独 commit**，message：`chore(deps): upgrade <pkg> <from>→<to>`；功能适配修复另立 commit。
6. **记录**：工具插件化需求台账登记升级条目（版本 from→to + breaking 处理方式）；重大升级（主版本）补 CHANGELOG 说明影响面。

## 快速清单（复制即用）

```
git status                                  # 必须干净
pnpm up <pkg>@latest                        # 定点升级
pnpm verify                                 # 13 道门禁全绿
pnpm audit --registry=https://registry.npmjs.org
git add pnpm-lock.yaml && git commit -m "chore(deps): upgrade <pkg> <from>→<to>"
# 台账登记 + 重大版本补 CHANGELOG
```
