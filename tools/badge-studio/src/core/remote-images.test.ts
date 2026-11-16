import { describe, expect, it } from 'vitest'
import { extractRemoteImageRefs, replaceRefs, replacementFor } from './remote-images'

describe('remote-images（穿插⑦-6 外链图片内联）', () => {
  const html = [
    '<img src="https://cdn.example.com/a.png">',
    `<img class='x' src='http://img.example.com/b.jpg?q=1'>`,
    '<img src="data:image/png;base64,AAAA">',
    '<div style="background:url(&quot;https://cdn.example.com/bg.webp&quot;)">',
    '<style>.h{background-image:url(https://cdn.example.com/hero.png)}</style>',
    '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
    '<script src="https://cdn.example.com/app.js"></script>',
    '@font-face{src:url(https://cdn.example.com/font.woff2)}',
  ].join('\n')

  it('提取 img 外链与 CSS 图片 url，跳过 data:/非图片资源', () => {
    const refs = extractRemoteImageRefs(html)
    const urls = refs.map((r) => r.url)
    expect(urls).toContain('https://cdn.example.com/a.png')
    expect(urls).toContain('http://img.example.com/b.jpg?q=1')
    expect(urls).toContain('https://cdn.example.com/bg.webp')
    expect(urls).toContain('https://cdn.example.com/hero.png')
    // data: 内联、css 文件、js、字体不提取
    expect(urls.every((u) => !u.startsWith('data:'))).toBe(true)
    expect(urls.every((u) => !u.endsWith('.css') && !u.endsWith('.js') && !u.endsWith('.woff2'))).toBe(true)
  })

  it('替换后仅目标片段被换成 dataURL，其余原样', () => {
    const refs = extractRemoteImageRefs(html)
    const target = refs.find((r) => r.url === 'https://cdn.example.com/a.png')!
    const out = replaceRefs(html, [target], 'data:image/png;base64,BBBB')
    expect(out).toContain('src="data:image/png;base64,BBBB"')
    expect(out).toContain('https://cdn.example.com/bg.webp') // 其余不动
    expect(out).toContain('AAAA') // 原 data: 不动
  })

  it('replacementFor 保留引号与 img 尾部属性', () => {
    const refs = extractRemoteImageRefs(`<img alt="x" src="https://a.b/c.png" width="1">`)
    expect(refs).toHaveLength(1)
    const r = refs[0]!
    expect(r.tail).toBe(' width="1">')
    expect(replacementFor(r, 'data:image/png;base64,Z')).toBe('<img alt="x" src="data:image/png;base64,Z" width="1">')
  })

  it('CSS url 无引号形态替换保留 url( ) 结构', () => {
    const refs = extractRemoteImageRefs('.h{background-image:url(https://cdn.example.com/hero.png)}')
    const r = refs[0]!
    const out = replaceRefs('.h{background-image:url(https://cdn.example.com/hero.png)}', [r], 'data:image/png;base64,H')
    expect(out).toBe('.h{background-image:url(data:image/png;base64,H)}')
  })

  it('HTML 实体引号（style 属性内嵌 &quot;）形态可提取替换', () => {
    const src = '<div style="background:url(&quot;https://cdn.example.com/bg.webp&quot;) center/cover">'
    const refs = extractRemoteImageRefs(src)
    expect(refs).toHaveLength(1)
    const out = replaceRefs(src, refs, 'data:image/webp;base64,B')
    expect(out).toContain('url(&quot;data:image/webp;base64,B&quot;) center/cover')
  })
})
