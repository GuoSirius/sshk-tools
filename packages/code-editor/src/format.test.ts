import { describe, expect, it } from 'vitest'
import { compactHtml, formatHtml } from './format'

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
