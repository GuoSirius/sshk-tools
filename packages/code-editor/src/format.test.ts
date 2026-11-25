import { describe, expect, it } from 'vitest'
import { compactHtml, formatCss, formatHtml, formatNjk } from './format'

describe('formatHtml/compactHtml', () => {
  it('格式化 HTML 为可读多行', async () => {
    const out = await formatHtml('<div><b>x</b><p>hi</p></div>')
    expect(out).toContain('\n  <b>x</b>')
    expect(out).toContain('\n  <p>hi</p>')
  })

  it('残缺 HTML 不抛错，保留原文', async () => {
    expect(await formatHtml('<div><b>x')).toBe('<div><b>x')
  })

  it('压缩只去格式化换行，不破坏文本语义空格', () => {
    expect(compactHtml('<div>\n  <b>x</b>\n  <p>hi</p>\n</div>')).toBe('<div><b>x</b><p>hi</p></div>')
    expect(compactHtml('<b>a</b> <i>b</i>')).toBe('<b>a</b> <i>b</i>')
  })

  it('压缩保护 pre/code 内空白', () => {
    const html = '<div>\n<pre>line 1\n  line 2</pre>\n<code>a  b</code>\n</div>'
    expect(compactHtml(html)).toBe('<div><pre>line 1\n  line 2</pre><code>a  b</code></div>')
  })
})

describe('formatNjk/formatCss', () => {
  it('njk 格式化时模板标记保持原样（Prettier 默认会在标记内折行）', async () => {
    const out = await formatNjk('<div>{% if link %}<a href="{{ link }}">x</a>{% endif %}</div>')
    expect(out).toContain('{% if link %}')
    expect(out).toContain('{{ link }}')
    expect(out).toContain('{% endif %}')
    expect(out).not.toContain('__SSHK_TPL_TOKEN_')
  })

  it('残缺 njk 原样返回', async () => {
    expect(await formatNjk('<div><b>x')).toBe('<div><b>x')
  })

  it('css 格式化且保留 njk 插值', async () => {
    expect(await formatCss('a{color:red}')).toContain('\n  color: red;')
    expect(await formatCss('a{width:{{ width }}px}')).toContain('width: {{ width }}px')
  })

  it('非法 css 原样返回', async () => {
    expect(await formatCss('a{color:')).toBe('a{color:')
  })
})
