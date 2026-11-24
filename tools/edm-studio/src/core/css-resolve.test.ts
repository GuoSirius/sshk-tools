/** plans/14 批次 0：四入口共用的 css 单链路解析测试。 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCssBundle, type CssResolveSource } from './css-resolve'
import { injectCssIntoHead } from './css-refs'
import { renderSystemCompose, renderSystemPreview } from './system-css'

const dirs: string[] = []
function tempRoot(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'sshk-css-resolve-'))
  dirs.push(d)
  return d
}
function put(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function ctx(root: string, versionDir = path.join(root, 'brand/fragment/fam/default')) {
  return { sourceRoot: root, systemRoot: root, customRoot: root, versionDir }
}

describe('resolveCssBundle 单链路', () => {
  it('显式 link 优先：按书写顺序解析、内容级去重、剥离 link；无 link 走回退快照', async () => {
    const root = tempRoot()
    put(path.join(root, 'css/shared.css'), '.shared{color:red}')
    put(path.join(root, 'brand/css/brand.css'), '.brand{color:blue}')
    put(path.join(root, 'brand/fragment/fam/default/css/local.css'), '.local{color:green}')
    const c = ctx(root)
    const html = '<link rel="stylesheet" href="@system/css/shared.css"><link rel="stylesheet" href="@root/brand/css/brand.css"><link rel="stylesheet" href="./css/local.css"><link rel="stylesheet" href="@system/css/shared.css"><div>x</div>'
    const sources: CssResolveSource[] = [{ html, ctx: c, fallbackCss: '.fallback{}' }]

    const linked = await resolveCssBundle({ sources })
    expect(linked.css).toBe('.shared{color:red}\n\n.brand{color:blue}\n\n.local{color:green}')
    expect(linked.refs).toHaveLength(3)
    expect(linked.htmls[0]).not.toContain('<link')

    const fallback = await resolveCssBundle({ sources: [{ html: '<div>x</div>', ctx: c, fallbackCss: '.fallback{}' }] })
    expect(fallback.css).toBe('.fallback{}')
    expect(fallback.refs).toEqual([])
  })

  it('公共样式层：@system/css/reset.css 与 @root/<brand>/css/palette.css 显式 link 生效', async () => {
    const edmRoot = fileURLToPath(new URL('../../assets/edm', import.meta.url))
    const c = ctx(edmRoot)
    const html = '<link rel="stylesheet" href="@system/css/reset.css"><link rel="stylesheet" href="@root/elabscience/css/palette.css"><div>x</div>'
    const bundle = await resolveCssBundle({ sources: [{ html, ctx: c }] })
    expect(bundle.css).toContain('box-sizing: border-box')
    expect(bundle.css).toContain('.bg-blue')
    expect(bundle.htmls[0]).not.toContain('<link')
  })

  it('显式链与等价回退快照产出相同 css（预览 = 生成的共同基准）', async () => {
    const root = tempRoot()
    const shared = '.reset{margin:0}\n.comp{color:red}'
    put(path.join(root, 'css/shared.css'), shared)
    const c = ctx(root)
    const explicit = await resolveCssBundle({
      sources: [{ html: '<link rel="stylesheet" href="@system/css/shared.css"><div>x</div>', ctx: c }],
    })
    const fallback = await resolveCssBundle({ sources: [{ html: '<div>x</div>', ctx: c, fallbackCss: shared }] })
    expect(explicit.css).toBe(fallback.css)
    expect(injectCssIntoHead('<html><head></head><body>x</body></html>', explicit.css))
      .toBe(injectCssIntoHead('<html><head></head><body>x</body></html>', fallback.css))
  })
})

describe('四入口预览侧共用 resolveCssBundle', () => {
  it('单版本与组合预览均剥离 link、注入同一 css；uno 原子类经 outputRoot 前置', async () => {
    const root = tempRoot()
    const out = tempRoot()
    put(path.join(root, 'css/shared.css'), '.shared{color:red}')
    put(path.join(root, 'elab/fragment/banner/default/fragment.njk'), '<link rel="stylesheet" href="@system/css/shared.css"><div class="text-center">{{ title }}</div>')
    put(path.join(root, 'elab/fragment/banner/default/sample.yaml'), 'title: hi')
    put(path.join(root, 'elab/template/standard/default/template.njk'), '<html><head></head><body>{{ slot_body | safe }}</body></html>')
    put(path.join(root, 'elab/template/standard/default/sample.yaml'), '{}')

    const single = await renderSystemPreview(root, { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: 'default' }, { outputRoot: out })
    expect(single.html).toContain('<div class="text-center">hi</div>')
    expect(single.html).toContain('.shared{color:red}')
    expect(single.html).not.toContain('<link')
    expect(single.html).toContain('text-align:center') // uno 扫描生成

    const composed = await renderSystemCompose(
      root,
      { brandCode: 'elab', kind: 'template', familyCode: 'standard', versionDir: 'default' },
      [{ selector: { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: 'default' }, slot: 'body' }],
      { outputRoot: out },
    )
    expect(composed.html).toContain('.shared{color:red}')
    expect(composed.html).not.toContain('<link')
    expect(composed.html).toContain('text-align:center')
    // 同一资产：单版本与组合预览的 css 规则集合一致（组合多一层 skeleton，但共享链只出现一次）
    expect(composed.html.match(/\.shared\{color:red\}/g)).toHaveLength(1)
  })
})
