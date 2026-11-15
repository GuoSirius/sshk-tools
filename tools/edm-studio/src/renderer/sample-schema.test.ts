import { describe, expect, it } from 'vitest'
import { applyDefaults, normalizeFields, parseYamlObject, validateModel } from './sample-schema'

describe('normalizeFields', () => {
  it('丢弃缺 key / 未知 type 的项，归一化 options', () => {
    const fields = normalizeFields([
      { key: 'title', label: '标题', type: 'input', required: true, maxLength: 10 },
      { type: 'input' },
      { key: 'bad', type: 'unknown' },
      { key: 'align', type: 'radio', options: ['left', 'center'] },
      { key: 'sel', type: 'select', options: [{ label: '甲', value: 'a' }, { value: 'b' }] },
    ])
    expect(fields.map((f) => f.key)).toEqual(['title', 'align', 'sel'])
    expect(fields[1]!.options).toEqual([{ label: 'left', value: 'left' }, { label: 'center', value: 'center' }])
    expect(fields[2]!.options).toEqual([{ label: '甲', value: 'a' }, { label: 'b', value: 'b' }])
    expect(fields[0]!.maxLength).toBe(10)
  })

  it('list 归一化 itemFields 并保留行数约束', () => {
    const fields = normalizeFields([{ key: 'items', type: 'list', minRows: 1, maxRows: 3, itemFields: [{ key: 'name', type: 'input' }] }])
    expect(fields[0]!.itemFields?.[0]!.key).toBe('name')
    expect(fields[0]!.maxRows).toBe(3)
  })

  it('非数组输入返回空', () => {
    expect(normalizeFields(null)).toEqual([])
    expect(normalizeFields('x')).toEqual([])
  })
})

describe('applyDefaults', () => {
  it('显式 default 优先，数组类控件兜底空数组', () => {
    const fields = normalizeFields([
      { key: 'a', type: 'input', default: 'hi' },
      { key: 'imgs', type: 'image-list', max: 2 },
      { key: 'b', type: 'input' },
    ])
    const out = applyDefaults(fields, { b: 'keep' })
    expect(out).toEqual({ a: 'hi', imgs: [], b: 'keep' })
  })

  it('已有值不被覆盖', () => {
    const fields = normalizeFields([{ key: 'a', type: 'input', default: 'hi' }])
    expect(applyDefaults(fields, { a: 'own' })['a']).toBe('own')
  })
})

describe('validateModel', () => {
  it('required：字符串空与数组空均报必填', () => {
    const fields = normalizeFields([
      { key: 't', label: '标题', type: 'input', required: true },
      { key: 'tags', label: '标签', type: 'checkbox', required: true },
    ])
    const errors = validateModel(fields, { t: '', tags: [] })
    expect(errors['t']).toBe('标题必填')
    expect(errors['tags']).toBe('标签必填')
    expect(validateModel(fields, { t: 'x', tags: ['a'] })).toEqual({})
  })

  it('input：minLength/maxLength/pattern（非法正则忽略）', () => {
    const fields = normalizeFields([
      { key: 't', label: '标题', type: 'input', minLength: 2, maxLength: 4 },
      { key: 'c', label: '编码', type: 'input', pattern: '^[A-Z]{2}$' },
      { key: 'p', label: '正则', type: 'input', pattern: '[' },
    ])
    expect(validateModel(fields, { t: 'a', c: 'AB', p: 'x' })).toEqual({ t: '标题至少 2 字' })
    expect(validateModel(fields, { t: 'abcde', c: 'ab', p: 'x' })).toEqual({ t: '标题最多 4 字', c: '编码格式不正确' })
    expect(validateModel(fields, { t: 'abc', c: 'AB', p: 'x' })).toEqual({})
  })

  it('richtext 按 HTML 剥标签计长', () => {
    const fields = normalizeFields([{ key: 'r', label: '正文', type: 'richtext', maxLength: 5 }])
    expect(validateModel(fields, { r: '<p>123456</p>' })).toEqual({ r: '正文正文最多 5 字' })
    expect(validateModel(fields, { r: '<p>123</p>' })).toEqual({})
  })

  it('checkbox/select-multi/image-list 数量上限', () => {
    const fields = normalizeFields([
      { key: 'ck', label: '多选', type: 'checkbox', maxChecked: 2 },
      { key: 'sm', label: '多选下拉', type: 'select-multi', maxSelected: 1 },
      { key: 'imgs', label: '图集', type: 'image-list', max: 3 },
    ])
    const errors = validateModel(fields, { ck: ['1', '2', '3'], sm: ['a', 'b'], imgs: ['1', '2', '3', '4'] })
    expect(errors['ck']).toBe('多选最多选 2 项')
    expect(errors['sm']).toBe('多选下拉最多选 1 项')
    expect(errors['imgs']).toBe('图集最多上传 3 张')
  })

  it('list：行数约束 + 递归校验行内字段（错误键 <key>.<行>.<子键>）', () => {
    const fields = normalizeFields([
      {
        key: 'items', label: '卡片', type: 'list', minRows: 2, maxRows: 3,
        itemFields: [{ key: 'name', label: '名称', type: 'input', required: true }],
      },
    ])
    const errors = validateModel(fields, { items: [{ name: 'a' }, { name: '' }, { name: 'c' }] })
    expect(errors['items.1.name']).toBe('名称必填')
    expect(Object.keys(errors)).toEqual(['items.1.name'])

    expect(validateModel(fields, { items: [{ name: 'a' }] })['items']).toBe('卡片至少 2 行')
    expect(validateModel(fields, { items: [{ name: 'a' }] })['items.0.name']).toBeUndefined()
    expect(validateModel(fields, { items: [] })['items']).toBe('卡片至少 2 行')
  })
})

describe('parseYamlObject：空示例数据不再误报 YAML 错误（复核项 8）', () => {
  it('空串 / 空白 / 纯注释 / null / 非字符串一律视为空模型', () => {
    for (const text of ['', '   \n  ', '# 只有注释', 'null', '~', undefined, null, 42]) {
      expect(parseYamlObject(text)).toEqual({})
    }
  })

  it('合法键值映射正常解析', () => {
    expect(parseYamlObject('title: 你好\nitems:\n  - a\n  - b\n')).toEqual({ title: '你好', items: ['a', 'b'] })
  })

  it('真正的语法错误仍然抛出，交调用方提示修正', () => {
    expect(() => parseYamlObject('a: [1,\n')).toThrow()
  })

  it('顶层不是键值映射时给出明确原因，不包装成模糊的 YAML 问题', () => {
    expect(() => parseYamlObject('- a\n- b\n')).toThrow('键值映射')
    expect(() => parseYamlObject('just-a-string')).toThrow('键值映射')
  })
})
