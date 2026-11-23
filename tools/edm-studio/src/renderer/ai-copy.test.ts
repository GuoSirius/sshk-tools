import { describe, expect, it } from 'vitest'
import {
  buildSamplePrompt,
  coerceSample,
  extractHtml,
  extractJson,
  generateSample,
  polishRichText,
} from './ai-copy'
import type { FieldDef } from './sample-schema'

const chat = async (messages: { role: string; content: string }[]): Promise<string> =>
  Promise.resolve(`好的，这是结果：\n\`\`\`json\n${messages[0]?.content ? '{"ok":1}' : '{}'}\n\`\`\``)

describe('buildSamplePrompt（D-Q2 schema → prompt）', () => {
  it('序列化 schema 并写明输出契约与选项白名单', () => {
    const fields: FieldDef[] = [
      { key: 'title', label: '标题', type: 'input', required: true, placeholder: '30 字内' },
      { key: 'level', label: '等级', type: 'select', options: [{ label: '高', value: 'high' }, { label: '低', value: 'low' }] },
      {
        key: 'items', label: '商品', type: 'repeater', maxRows: 3,
        itemFields: [{ key: 'name', label: '名称', type: 'input' }],
      },
    ]
    const prompt = buildSamplePrompt(fields, '双十一促销')
    expect(prompt).toContain('"key":"title"')
    expect(prompt).toContain('allowedValues')
    expect(prompt).toContain('itemFields')
    expect(prompt).toContain('双十一促销')
    expect(prompt).toContain('不要 markdown 围栏')
  })
})

describe('extractJson / extractHtml（模型返回容错）', () => {
  it('容忍围栏与前后解释文字', () => {
    expect(extractJson('说明\n```json\n{"a":1}\n```\n完')).toBe('{"a":1}')
    expect(extractJson('结果如下：{"a":{"b":2}} 请查收')).toBe('{"a":{"b":2}}')
    expect(extractJson('没有对象')).toBeNull()
  })
  it('HTML 提取取首个 < 到末个 >', () => {
    expect(extractHtml('```html\n<table><tr><td>x</td></tr></table>\n```')).toBe('<table><tr><td>x</td></tr></table>')
    expect(extractHtml('纯文本')).toBeNull()
  })
})

describe('coerceSample（按 schema 转型收紧）', () => {
  const fields: FieldDef[] = [
    { key: 'title', label: '标题', type: 'input' },
    { key: 'level', label: '等级', type: 'radio', options: [{ label: '高', value: 'high' }, { label: '低', value: 'low' }] },
    { key: 'tags', label: '标签', type: 'checkbox', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
    { key: 'imgs', label: '图', type: 'image-list', max: 2 },
    {
      key: 'rows', label: '行', type: 'repeater', maxRows: 2,
      itemFields: [{ key: 'name', label: '名称', type: 'input' }],
    },
  ]
  it('非法选项回落首个、多选过滤白名单、数量截断、list 递归、未知键丢弃', () => {
    const out = coerceSample(fields, {
      title: 123,
      level: 'illegal',
      tags: ['a', 'x', 'b'],
      imgs: ['u1', 'u2', 'u3'],
      rows: [{ name: 'n1', junk: 1 }, 'bad-row', { name: 'n2' }, { name: 'n3' }],
      unknown: 'drop',
    })
    expect(out).toEqual({
      title: '123',
      level: 'high',
      tags: ['a', 'b'],
      imgs: ['u1', 'u2'],
      rows: [{ name: 'n1' }, { name: 'n2' }],
    })
  })

  it('新原子类型：url/number/date/color/switch 按类型收紧', () => {
    const f: FieldDef[] = [
      { key: 'link', label: '链接', type: 'url' },
      { key: 'qty', label: '数量', type: 'number' },
      { key: 'date', label: '日期', type: 'date' },
      { key: 'color', label: '颜色', type: 'color' },
      { key: 'on', label: '开关', type: 'switch' },
    ]
    const out = coerceSample(f, {
      link: 'https://x.com', qty: '12', date: '2026-01-02', color: '#ff0000', on: 'true',
    })
    expect(out).toEqual({
      link: 'https://x.com', qty: 12, date: '2026-01-02', color: '#ff0000', on: true,
    })
    // 非法值回落：日期/颜色不合规回退、数字非数回退 0、开关非 true 回退 false
    const bad = coerceSample(f, { date: '01/02/2026', color: 'red', qty: 'abc', on: 'yes' })
    expect(bad).toEqual({ link: '', qty: 0, date: '', color: '#409EFF', on: false })
  })

  it('新容器类型：repeater 按 itemFields 递归、table 按 columns 平铺', () => {
    const f: FieldDef[] = [
      {
        key: 'products', label: '产品', type: 'repeater', maxRows: 2,
        itemFields: [{ key: 'name', label: '名称', type: 'input' }, { key: 'link', label: '链接', type: 'url' }],
      },
      {
        key: 'matrix', label: '对比表', type: 'table', maxRows: 1,
        columns: [{ key: 'name', label: '名称', cellType: 'input' }, { key: 'url', label: '链接', cellType: 'url' }],
      },
    ]
    const out = coerceSample(f, {
      products: [{ name: '抗体', link: 'https://x.com', junk: 1 }, { name: '蛋白' }, { name: '第三行' }],
      matrix: [{ name: 'A', url: 'https://y.com', junk: 2 }],
    })
    expect(out).toEqual({
      products: [
        { name: '抗体', link: 'https://x.com' },
        { name: '蛋白', link: '' },
      ],
      matrix: [{ name: 'A', url: 'https://y.com' }],
    })
  })
})

describe('generateSample（端到端注入 chat）', () => {
  it('解析模型 JSON 并 coerce；解析失败抛可读错误', async () => {
    const fields: FieldDef[] = [{ key: 'title', label: '标题', type: 'input' }]
    const good: typeof chat = async () => '```json\n{"title":"新品上市"}\n```'
    await expect(generateSample(fields, good)).resolves.toEqual({ title: '新品上市' })
    const bad: typeof chat = async () => '模型抽风了，没有 JSON'
    await expect(generateSample(fields, bad)).rejects.toThrow(/没有返回可解析的 JSON/)
    const broken: typeof chat = async () => '```json\n{"a":}\n```'
    await expect(generateSample(fields, broken)).rejects.toThrow(/JSON 不合法/)
  })
})

describe('polishRichText（富文本润色）', () => {
  it('返回剥出的 HTML；无 HTML 抛错', async () => {
    const ok: typeof chat = async () => '润色后：\n<p>更专业的文案</p>'
    await expect(polishRichText('<p>旧文案</p>', ok)).resolves.toBe('<p>更专业的文案</p>')
    const bad: typeof chat = async () => '没有标签的回答'
    await expect(polishRichText('<p>x</p>', bad)).rejects.toThrow(/没有返回可用的 HTML/)
  })
})
