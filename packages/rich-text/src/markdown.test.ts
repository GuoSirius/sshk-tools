import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, markdownToHtml } from './markdown'

describe('P1=C Markdown ↔ HTML', () => {
  it('markdown → html', () => {
    expect(markdownToHtml('# 标题')).toContain('<h1>标题</h1>')
    expect(markdownToHtml('**粗体**')).toContain('<strong>粗体</strong>')
  })

  it('html → markdown', () => {
    expect(htmlToMarkdown('<h1>标题</h1>')).toContain('# 标题')
    expect(htmlToMarkdown('<p>a <strong>b</strong></p>')).toContain('**b**')
  })

  it('往返不保真：富文本 class 语义会丢失（已告知用户，仅做单向导入/导出）', () => {
    const md = htmlToMarkdown('<table class="edm-reset"><tr><td>x</td></tr></table>')
    expect(md).not.toContain('edm-reset')
  })
})
