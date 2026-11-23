import { describe, expect, it } from 'vitest'
import { extractSlotKeysFromSource, mergeSourceSlots } from './slots'

describe('模板 slot 源码提取', () => {
  it('按出现顺序提取 slot_* 并去重，兼容有无 safe 过滤器', () => {
    const html = '<div>{{ slot_header | safe }}</div><div>{{ slot_body }}</div><div>{{ slot_header|safe }}</div>'
    expect(extractSlotKeysFromSource(html)).toEqual(['header', 'body'])
  })

  it('不把普通变量或无关文本当成 slot', () => {
    expect(extractSlotKeysFromSource('{{ title }} slot_header {{ slot_ }} {{ slot-a }}')).toEqual([])
  })

  it('合并时保留 meta 声明的 type/label，只补源码新增项且不重复', () => {
    const merged = mergeSourceSlots(
      [{ key: 'header', label: '头部', type: 'header' }],
      ['header', 'promo', 'promo'],
    )
    expect(merged).toEqual([
      { key: 'header', label: '头部', type: 'header' },
      { key: 'promo', label: 'promo', type: '' },
    ])
  })
})
