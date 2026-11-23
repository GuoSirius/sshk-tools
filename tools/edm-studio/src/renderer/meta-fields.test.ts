import { describe, expect, it } from 'vitest'
import { fieldsBlock, replaceFieldsInMeta, replaceTopLevelField, withMetaIdentity } from './meta-fields'
import type { FieldDef } from './sample-schema'

const sample: FieldDef[] = [
  { key: 'title', label: '主标题', type: 'input', required: true, maxLength: 30 },
  {
    key: 'theme',
    label: '主题色',
    type: 'radio',
    options: [
      { label: '科技蓝', value: 'blue' },
      { label: '活力绿', value: 'green' },
    ],
  },
  { key: 'products', label: '产品', type: 'list', minRows: 1, itemFields: [{ key: 'name', label: '名', type: 'input', required: true }] },
]

describe('fieldsBlock', () => {
  it('非空数组序列化为缩进块', () => {
    const b = fieldsBlock(sample)
    expect(b.startsWith('fields:\n  - key: title')).toBe(true)
    expect(b).toContain('    options:')
  })
  it('空数组输出 fields: []', () => {
    expect(fieldsBlock([])).toBe('fields: []')
  })
})

describe('replaceFieldsInMeta', () => {
  it('替换已有顶层 fields 块，保留其余键与注释', () => {
    const raw = [
      '# 头部注释',
      'version: 2',
      'changelog: 改为响应式',
      '',
      'fields:',
      '  - key: old',
      '    label: 旧',
      '',
      'other: keep',
    ].join('\n')
    const out = replaceFieldsInMeta(raw, sample)
    expect(out).toContain('# 头部注释')
    expect(out).toContain('version: 2')
    expect(out).toContain('changelog: 改为响应式')
    expect(out).toContain('other: keep')
    expect(out).not.toContain('key: old')
    expect(out).toContain('key: title')
    expect(out).toContain('key: theme')
  })

  it('无 fields 时追加到文末', () => {
    const raw = 'version: 2\nchangelog: x'
    const out = replaceFieldsInMeta(raw, sample)
    expect(out.indexOf('version: 2')).toBeLessThan(out.indexOf('fields:'))
    expect(out.trimEnd().endsWith('fields:') || out.includes('fields:\n')).toBe(true)
    expect(out).toContain('key: title')
  })

  it('空数组时移除 fields 块内容', () => {
    const raw = 'version: 2\nfields:\n  - key: a\n    label: A\nother: x'
    const out = replaceFieldsInMeta(raw, [])
    expect(out).toContain('fields: []')
    expect(out).toContain('other: x')
    expect(out).not.toContain('key: a')
  })
})

describe('重命名同步 code / 必填补齐', () => {
  it('replaceTopLevelField 保留注释与其余键', () => {
    const raw = '# 注释\ncode: "demo"\nname: Demo\nchangelog: x\n'
    const out = replaceTopLevelField(raw, 'code', 'demo-v2')
    expect(out).toContain('# 注释')
    expect(out).toContain('name: Demo')
    expect(out).toContain('code: "demo-v2"')
    expect(out).not.toContain('code: "demo"')
  })

  it('withMetaIdentity 仅补齐缺失的 code/name', () => {
    const out = withMetaIdentity('version: 2\nname: 首版\n', 'v2', '第二版')
    expect(out).toContain('code: "v2"')
    expect(out).toContain('name: 首版')
    expect(out).not.toContain('name: 第二版')
    expect(withMetaIdentity('code: a\nname: b\n', 'x', 'y')).toBe('code: a\nname: b\n')
  })
})
