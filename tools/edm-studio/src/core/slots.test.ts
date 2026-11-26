import { describe, expect, it } from 'vitest'
import { extractSlotKeysFromSource } from './slots'

describe('模板 slot 源码提取（#213：njk 源码为唯一真相源）', () => {
  it('按出现顺序提取 slot_* 并去重，兼容有无 safe 过滤器', () => {
    const html = '<div>{{ slot_header | safe }}</div><div>{{ slot_body }}</div><div>{{ slot_header|safe }}</div>'
    expect(extractSlotKeysFromSource(html)).toEqual(['header', 'body'])
  })

  it('不把普通变量或无关文本当成 slot', () => {
    expect(extractSlotKeysFromSource('{{ title }} slot_header {{ slot_ }} {{ slot-a }}')).toEqual([])
  })

  it('源码增删 slot 即时反映：不再依赖任何 meta 声明', () => {
    expect(extractSlotKeysFromSource('{{ slot_a | safe }}{{ slot_b | safe }}')).toEqual(['a', 'b'])
    expect(extractSlotKeysFromSource('{{ slot_b | safe }}')).toEqual(['b']) // 删掉 a 后清单只剩 b
    expect(extractSlotKeysFromSource('{{ slot_promo | safe }}')).toEqual(['promo']) // 新增即时出现
  })
})
