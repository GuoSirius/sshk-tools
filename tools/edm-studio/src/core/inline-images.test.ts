import { describe, expect, it } from 'vitest'
import { extractInlineImages, replaceInlineImages, replacementFor } from './inline-images'

describe('T8 HTML 内联图片提取与回写', () => {
  it('识别 data: 图片，跳过外链与富文本正常 URL', () => {
    const html = '<img src="https://cdn.test/a.png"><img class="x" src=\'data:image/png;base64,aGVsbG8=\' /><img src="data:image/svg+xml;base64,PHN2Zz4=">'
    const images = extractInlineImages(html)
    expect(images).toHaveLength(2)
    expect(images[0]?.mime).toBe('image/png')
    expect(images[0]?.quote).toBe("'")
    expect(images[1]?.mime).toBe('image/svg+xml')
    expect(images[1]?.name).toBe('inline-2.svg')
    expect(images[0]?.size).toBe(5)
  })

  it('回写 URL 时保留引号与前缀，并避免 $ 被当替换模式', () => {
    const html = '<img src="data:image/png;base64,aGVsbG8=">'
    const img = extractInlineImages(html)[0]
    expect(img).toBeDefined()
    const replacement = replacementFor(img!, 'https://cdn.test/a$b.png')
    expect(replacement).toBe('<img src="https://cdn.test/a$b.png"')
    expect(replaceInlineImages(html, [{ raw: img!.raw, replacement }])).toBe(`${replacement}>`)
  })

  it('无内联图片时原样返回', () => {
    expect(extractInlineImages('<img src="a.png">')).toHaveLength(0)
    expect(replaceInlineImages('<p>x</p>', [])).toBe('<p>x</p>')
  })
})
