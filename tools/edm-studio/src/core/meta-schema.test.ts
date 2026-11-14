/**
 * R2 元数据校验测试：黑白名单仅片段侧持有（用户裁定）。
 */
import { describe, expect, it } from 'vitest'
import { META_JSON_SCHEMAS, validateMeta } from './meta-schema'

describe('R2 validateMeta', () => {
  it('品牌：缺 code/name 报错，齐备通过', () => {
    expect(validateMeta('brand', { code: 'procell', name: 'Procell' }).valid).toBe(true)
    const bad = validateMeta('brand', { code: 'procell' })
    expect(bad.valid).toBe(false)
    expect(bad.errors.join(' ')).toContain("must have required property 'name'")
  })

  it('片段族：policy 只允许 whitelist/blacklist，多余键拒绝；模板族无 policy 字段约束外的额外键放行', () => {
    expect(validateMeta('fragmentFamily', { code: 'banner', name: '横幅', policy: { blacklist: [], whitelist: [] } }).valid).toBe(true)
    const extra = validateMeta('fragmentFamily', { code: 'b', name: 'b', policy: { foo: 1 } })
    expect(extra.valid).toBe(false)
    // 模板/品牌侧不持有 policy（已废弃，靠 additionalProperties: true 不硬拒，但 schema 不声明该字段）
    expect(META_JSON_SCHEMAS.templateFamily).not.toHaveProperty('properties.policy')
  })

  it('片段版本：version 必须 ≥1 的整数', () => {
    expect(validateMeta('fragmentVersion', { version: 2 }).valid).toBe(true)
    expect(validateMeta('fragmentVersion', { version: 0 }).valid).toBe(false)
    expect(validateMeta('fragmentVersion', {}).valid).toBe(false)
  })

  it('模板族：slots 每项必须含 key/type', () => {
    expect(validateMeta('templateFamily', {
      code: 'standard', name: '标准', slots: [{ key: 'header', type: 'header' }],
    }).valid).toBe(true)
    const bad = validateMeta('templateFamily', { code: 's', name: 's', slots: [{ type: 'header' }] })
    expect(bad.valid).toBe(false)
  })

  it('模板版本：version + changelog 通过', () => {
    expect(validateMeta('templateVersion', { version: 1, changelog: '初始' }).valid).toBe(true)
  })
})
