import { describe, expect, it } from 'vitest'
import { buildBindings, compose } from './compose.js'

describe('compose 统一组合引擎（R19）', () => {
  it('buildBindings：同 slot 按 order 排序拼接、repeat 重复追加、异 slot 分组', () => {
    const bindings = buildBindings(
      [
        { html: 'B', slot: 'body', order: 2 },
        { html: 'A', slot: 'body', order: 1, repeat: 2 },
        { html: 'H', slot: 'header' },
      ],
      {},
      false,
    )
    expect(bindings['header']).toBe('H')
    expect(bindings['body']).toBe('A\nA\nB')
  })

  it('compose：片段渲染进模板 slot_*、placement 独立 data、fallback 生效、css 注入 style', async () => {
    const result = await compose({
      templateHtml: '<html><body>{{ slot_header | safe }}|{{ slot_body | safe }}</body></html>',
      templateCss: 'body{color:red}',
      placements: [
        { html: '<b>{{ name }}</b>', slot: 'header', data: { name: '横幅' } },
        { html: '<i>{{ text }}</i>', slot: 'body' },
      ],
      data: { text: '正文兜底' },
      strict: false,
    })
    expect(result.assembled).toContain('<b>横幅</b>')
    expect(result.assembled).toContain('<i>正文兜底</i>')
    expect(result.assembled).toContain('body{color:red}')
    expect(result.bindings['header']).toBe('<b>横幅</b>')
    expect(result.inlined).toContain('<b>横幅</b>')
    expect(result.final.length).toBeGreaterThan(0)
  })

  it('compose：repeat 展开次数正确、同输入 sourceHash 稳定', async () => {
    const input = {
      templateHtml: '<div>{{ slot_body | safe }}</div>',
      placements: [{ html: '<p>x</p>', slot: 'body', repeat: 3 }],
      data: {},
      strict: false,
    }
    const r1 = await compose(input)
    expect(r1.assembled.split('<p>x</p>').length - 1).toBe(3)
    const r2 = await compose(input)
    expect(r1.sourceHash).toBe(r2.sourceHash)
  })

  it('compose：空 slot / 空 html 的 placement 被跳过', async () => {
    const result = await compose({
      templateHtml: '<div>{{ slot_body | safe }}</div>',
      placements: [
        { html: '', slot: 'body' },
        { html: '<p>ok</p>', slot: '' },
        { html: '<p>hit</p>', slot: 'body' },
      ],
      data: {},
      strict: false,
    })
    expect(result.assembled).toContain('<p>hit</p>')
    expect(result.assembled).not.toContain('<p>ok</p>')
  })
})

describe('compose 元数据注入（2026-11-25 修订 1/13）', () => {
  it('片段可见模板 ctx（template.* 命名空间），片段自身 meta 不被模板覆盖', async () => {
    const result = await compose({
      templateHtml: '<div>{{ slot_body | safe }}</div>',
      placements: [
        {
          html: '<p>{{ title }}|{{ template.title }}|{{ meta.family.code }}|{{ template.meta.family.code }}</p>',
          slot: 'body',
          data: { title: '片段' },
          meta: { family: { code: 'frag', name: '片段族' } },
        },
      ],
      data: { title: '邮件主题' },
      meta: { family: { code: 'tpl', name: '模板族' } },
      strict: false,
    })
    expect(result.assembled).toContain('<p>片段|邮件主题|frag|tpl</p>')
  })
})
