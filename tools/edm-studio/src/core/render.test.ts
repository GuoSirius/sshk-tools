import { describe, expect, it } from 'vitest'
import { renderFragment, renderFragmentHtml, renderMail } from './render'

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

describe('njk 分层上下文（2026-11-25 修订 1/13）', () => {
  it('模板 meta.* 命名空间注入 + favicon 继承链（版本→族→类型→品牌）', async () => {
    const stages = await renderMail({
      templateHtml: '<link rel="shortcut icon" href="{{ meta.favicon }}" /><p>{{ meta.family.code }}</p><p>{{ subject }}</p>',
      bindings: {},
      data: { subject: '标题' },
      render: { strict: false, autoEscape: true },
      meta: {
        brand: { code: 'elabscience', name: 'Elab', favicon: 'brand.ico' },
        family: { code: 'standard', name: '标准' },
        version: { code: 'v1', name: 'V1', favicon: 'v1.ico' },
      },
    })
    expect(stages.assembled).toContain('href="v1.ico"')
    expect(stages.assembled).toContain('<p>standard</p>')
    expect(stages.assembled).toContain('<p>标题</p>')
  })

  it('meta.favicon 无继承值时为空串，strict 模式不抛错', async () => {
    const stages = await renderMail({
      templateHtml: '<p>[{{ meta.favicon }}]</p>',
      bindings: {},
      data: {},
      render: { strict: true, autoEscape: true },
    })
    expect(stages.assembled).toContain('[]')
  })

  it('renderFragmentHtml：片段 meta.* + template.* 命名空间隔离，同名字段不覆盖', () => {
    const out = renderFragmentHtml({
      html: '<p>{{ title }}</p><p>{{ meta.family.code }}</p><p>{{ template.title }}</p><p>{{ template.meta.family.code }}</p>',
      data: { title: '片段标题' },
      meta: { family: { code: 'frag', name: '片段族' } },
      templateCtx: { title: '模板标题', meta: { family: { code: 'tpl', name: '模板族' } } },
      render: { strict: false, autoEscape: true },
    })
    expect(out).toContain('<p>片段标题</p>')
    expect(out).toContain('<p>frag</p>')
    expect(out).toContain('<p>模板标题</p>')
    expect(out).toContain('<p>tpl</p>')
  })

  it('片段独立渲染（无模板 ctx）：template 为空对象，if 守卫为假不抛', () => {
    const out = renderFragmentHtml({
      html: '<p>{{ title }}</p>{% if template %}<b>{{ template.title }}</b>{% endif %}',
      data: { title: '独立片段' },
      render: { strict: false, autoEscape: true },
    })
    expect(out).toContain('<p>独立片段</p>')
    expect(out).not.toContain('<b>')
  })
})
