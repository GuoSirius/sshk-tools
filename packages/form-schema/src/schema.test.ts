import { describe, expect, it } from 'vitest'
import { applyDefaults, normalizeFields, parseYamlObject, retypeField, validateModel, validateSchema } from './index'

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
    expect(validateModel(fields, { r: '<p>123456</p>' })).toEqual({ r: '正文最多 5 字' })
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

  it('number：非数字 / 越界校验', () => {
    const fields = normalizeFields([
      { key: 'qty', label: '数量', type: 'number', min: 1, max: 10 },
    ])
    expect(validateModel(fields, { qty: 'abc' })['qty']).toBe('数量必须是数字')
    expect(validateModel(fields, { qty: 0 })['qty']).toBe('数量不能小于 1')
    expect(validateModel(fields, { qty: 11 })['qty']).toBe('数量不能大于 10')
    expect(validateModel(fields, { qty: 5 })).toEqual({})
  })

  it('repeater：按 itemFields 递归校验组合卡内字段', () => {
    const fields = normalizeFields([
      {
        key: 'products', label: '产品', type: 'repeater', minRows: 1,
        itemFields: [
          { key: 'name', label: '产品名称', type: 'input', required: true },
          { key: 'link', label: '链接', type: 'url' },
        ],
      },
    ])
    expect(validateModel(fields, { products: [{ name: '' }] })['products.0.name']).toBe('产品名称必填')
    expect(validateModel(fields, { products: [] })['products']).toBe('产品至少 1 行')
    expect(validateModel(fields, { products: [{ name: '抗体', link: 'https://x.com' }] })).toEqual({})
  })

  it('table：按 columns 的 cellType 校验链接列（错误键 <key>.<行>.<列>）', () => {
    const fields = normalizeFields([
      {
        key: 'rows', label: '对比表', type: 'table',
        columns: [
          { key: 'name', label: '名称', cellType: 'input' },
          { key: 'url', label: '链接', cellType: 'url' },
        ],
      },
    ])
    expect(validateModel(fields, { rows: [{ name: 'A', url: 'not-a-url' }] })['rows.0.url']).toBe('链接需为 http(s) 链接')
    expect(validateModel(fields, { rows: [{ name: 'A', url: 'https://x.com' }] })).toEqual({})
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

describe('retypeField（切换类型清旧属性，体检 #3）', () => {
  it('input→number 丢弃 minLength/pattern，保留通用属性', () => {
    const f = { key: 'k', label: '标签', type: 'input' as const, minLength: 2, pattern: '^[A-Z]+$', required: true, placeholder: '提示' }
    const next = retypeField(f, 'number')
    expect(next).toEqual({ key: 'k', label: '标签', type: 'number', required: true, placeholder: '提示' })
  })

  it('容器→原子丢弃 itemFields/columns，原子→table 保留 columns', () => {
    const list = { key: 'k', label: '列表', type: 'list' as const, itemFields: [{ key: 'x', label: 'X', type: 'input' as const }], minRows: 1 }
    expect(retypeField(list, 'input')).toEqual({ key: 'k', label: '列表', type: 'input' })
    const table = { key: 't', label: '表', type: 'table' as const, columns: [{ key: 'c', label: '列', cellType: 'input' as const }] }
    expect(retypeField(table, 'repeater').columns).toBeUndefined()
    expect(retypeField(table, 'table').columns).toEqual(table.columns)
  })
})

describe('validateSchema（设计器红字与保存层共用，体检 #5）', () => {
  it('key 非法/重复/保留字、label 空均报错', () => {
    const fields = normalizeFields([
      { key: 'ok', label: '正常', type: 'input' },
      { key: 'ok', label: '', type: 'input' },
      { key: '1bad', label: '数字开头', type: 'input' },
      { key: '__proto__', label: '保留字', type: 'input' },
    ])
    const errors = validateSchema(fields)
    expect(errors['0.key']).toBeUndefined()
    expect(errors['1.key']).toBe('key 重复')
    expect(errors['1.label']).toBe('标签不能为空')
    expect(errors['2.key']).toContain('不以数字开头')
    expect(errors['3.key']).toContain('不以数字开头')
  })

  it('选择类至少一选项且不重复、容器行数上下限、子字段错误递归', () => {
    const fields: Parameters<typeof validateSchema>[0] = [
      { key: 'sel', label: '选择', type: 'select', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }] },
      { key: 'box', label: '复选', type: 'checkbox', options: [] },
      { key: 'list', label: '列表', type: 'list', minRows: 3, maxRows: 2, itemFields: [{ key: '', label: '空', type: 'input' }] },
    ]
    const errors = validateSchema(fields)
    expect(errors['0.options']).toBe('选项值不能重复')
    expect(errors['1.options']).toBe('至少配置一个选项')
    expect(errors['2.maxRows']).toBe('最多行不能少于最少行')
    expect(errors['2.itemFields.0.key']).toBe('key 不能为空')
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
