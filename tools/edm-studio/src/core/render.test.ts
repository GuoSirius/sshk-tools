import { describe, expect, it } from 'vitest'
import { renderFragment, renderMail } from './render'

describe('三阶段渲染管线（数据契约 §7）', () => {
  it('槽位注入 + CSS 内联 + 压缩', async () => {
    const stages = await renderMail({
      templateHtml: '<table><tr><td>{{ slot_header | safe }}</td></tr><tr><td>{{ name }}</td></tr><style>td{color:red}</style></table>',
      bindings: { header: '<b>12月营销</b>' },
      data: { name: '狼哥' },
      render: { strict: false, autoEscape: true },
    })
    expect(stages.assembled).toContain('<b>12月营销</b>')
    expect(stages.assembled).toContain('狼哥')
    // juice 内联后 style 标签内容落到元素 style 属性
    expect(stages.inlined).not.toContain('<style>')
    expect(stages.inlined.replace(/\s/g, '').toLowerCase()).toContain('color:red')
    // final 已压缩
    expect(stages.final.length).toBeLessThanOrEqual(stages.inlined.length)
    expect(stages.sourceHash).toMatch(/^sha256:/)
  })

  it('autoEscape 阻断数据中的 HTML 注入', async () => {
    const stages = await renderMail({
      templateHtml: '<p>{{ name }}</p>',
      bindings: {},
      data: { name: '<script>alert(1)</script>' },
      render: { strict: false, autoEscape: true },
    })
    expect(stages.assembled).not.toContain('<script>')
    expect(stages.assembled).toContain('&lt;script&gt;')
  })

  it('strict 模式未定义变量报错', async () => {
    await expect(
      renderMail({
        templateHtml: '<p>{{ missing }}</p>',
        bindings: {},
        data: {},
        render: { strict: true, autoEscape: true },
      }),
    ).rejects.toThrow()
  })

  it('renderFragment 渲染片段数据', () => {
    expect(renderFragment('<li>{{ title }}</li>', { title: '产品A' })).toContain('产品A')
  })
})
