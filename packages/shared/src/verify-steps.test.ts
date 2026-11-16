import { describe, expect, it } from 'vitest'
import { VERIFY_STEPS } from './verify-steps'

/** 真实内建工具 id（tool.manifest.id = 目录名）；新增工具时同步这里 */
const REAL_TOOL_IDS = new Set(['upload-config', 'edm-studio', 'badge-studio', 'model-console', 'template-tool'])
/** catalogState 判定器的特殊 spec（非工具 id） */
const SPECIAL_CATALOG_SPECS = new Set(['grants'])
/** 预加载层 api 上的宿主能力键（preload/index.ts 暴露的命名空间 / 单函数） */
const HOST_API_KEYS = new Set(['upload', 'callHostApi'])

describe('VERIFY_STEPS 自动判定 spec 契约', () => {
  it('catalogState 的 spec 必须是真实工具 id 或特殊键（A10 曾写成 upload 导致恒「未过」）', () => {
    const bad = VERIFY_STEPS
      .filter((s) => s.auto?.kind === 'catalogState')
      .filter((s) => !SPECIAL_CATALOG_SPECS.has(s.auto!.spec) && !REAL_TOOL_IDS.has(s.auto!.spec))
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

  it('route 直达 target 必须是真实工具 id（B/D 组曾写成 edm/upload 短名，点直达被路由打回桌面）', () => {
    const bad = VERIFY_STEPS
      .filter((s) => s.entry?.type === 'route')
      .filter((s) => !REAL_TOOL_IDS.has(s.entry!.target))
    expect(bad.map((s) => `${s.id}:${s.entry!.target}`)).toEqual([])
  })
})
