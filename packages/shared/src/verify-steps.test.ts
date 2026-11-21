import { describe, expect, it } from 'vitest'
import { VERIFY_STEPS } from './verify-steps'

/** 真实纯工具 id（tool.manifest.id = 目录名，P4-8b 后 tools/ 只剩纯工具）；新增工具时同步这里 */
const PURE_TOOL_IDS = new Set(['edm-studio', 'badge-studio', 'template-tool'])
/** 应用内置模块 id（P4-8 · D53）：三基础模块并入应用本体，verify-steps 直达目标仍用这些 id，
 *  VerifyGuidePage 将其映射到 /app/<module>/<page>（不再经 /tool/<id> 工具宿主） */
const MODULE_IDS = new Set(['file-manager', 'model-manager', 'share-manager'])
/** route 直达 target 合法集合 = 纯工具 ∪ 模块 id */
const REAL_ROUTE_TARGETS = new Set([...PURE_TOOL_IDS, ...MODULE_IDS])
/** catalogState 判定器的特殊 spec（非工具 id） */
const SPECIAL_CATALOG_SPECS = new Set(['grants'])
/** 预加载层 api 上的宿主能力键（preload/index.ts 暴露的命名空间 / 单函数） */
const HOST_API_KEYS = new Set(['upload', 'fs', 'callHostApi', 'shareHub', 'shareHubControl'])

describe('VERIFY_STEPS 自动判定 spec 契约', () => {
  it('catalogState 的 spec 必须是纯工具 id 或特殊键（A10 catalogState 已随 P4-8b 工具退役移除）', () => {
    const bad = VERIFY_STEPS
      .filter((s) => s.auto?.kind === 'catalogState')
      .filter((s) => !SPECIAL_CATALOG_SPECS.has(s.auto!.spec) && !PURE_TOOL_IDS.has(s.auto!.spec))
    expect(bad.map((s) => `${s.id}:${s.auto!.spec}`)).toEqual([])
  })

  it('hostCapability 的 spec 必须是 preload api 上真实存在的键', () => {
    const bad = VERIFY_STEPS
      .filter((s) => s.auto?.kind === 'hostCapability')
      .filter((s) => !HOST_API_KEYS.has(s.auto!.spec))
    expect(bad.map((s) => `${s.id}:${s.auto!.spec}`)).toEqual([])
  })

  it('步骤 id 全仓唯一', () => {
    const ids = VERIFY_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('route 直达 target 必须是纯工具 id 或应用模块 id（B/D 组曾写成 edm/upload 短名，点直达被路由打回桌面）', () => {
    const bad = VERIFY_STEPS
      .filter((s) => s.entry?.type === 'route')
      .filter((s) => !REAL_ROUTE_TARGETS.has(s.entry!.target))
    expect(bad.map((s) => `${s.id}:${s.entry!.target}`)).toEqual([])
  })
})
