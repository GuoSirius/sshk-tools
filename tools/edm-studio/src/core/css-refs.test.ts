import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectLinkedCss,
  extractCssHrefs,
  hasExplicitCssRefs,
  injectCssIntoHead,
  resolveCssRef,
  stripCssLinks,
  type CssRefContext,
} from './css-refs'

const dirs: string[] = []
function tempRoot(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'sshk-cssrefs-'))
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

function ctx(systemRoot: string, customRoot: string, sourceRoot = systemRoot): CssRefContext {
  return { sourceRoot, systemRoot, customRoot, versionDir: path.join(sourceRoot, 'brand/template/fam/v1') }
}

describe('R28 逻辑 URI 解析', () => {
  it('三种 scope 全部指向正确根', () => {
    const sys = tempRoot()
    const cus = tempRoot()
    const c = ctx(sys, cus)
    expect(resolveCssRef('@system/css/reset.css', c)).toBe(path.join(sys, 'css/reset.css'))
    expect(resolveCssRef('@root/css/brand.css', c)).toBe(path.join(sys, 'css/brand.css'))
    expect(resolveCssRef('@system/css/uno.css', c)).toBe(path.join(sys, 'css/uno.css'))
    expect(resolveCssRef('@custom/css/x.css', c)).toBe(path.join(cus, 'css/x.css'))
    expect(resolveCssRef('./css/a.css', c)).toBe(path.join(c.versionDir, 'css/a.css'))
  })

  it('修订 3：允许 .. 上溯但兜底限根内；越界拒绝；外链返回 null', () => {
    const root = tempRoot()
    const c = ctx(root, tempRoot())
    // ./ 基准是 versionDir，../ 上溯到 fam 层仍在来源根内 → 允许
    expect(resolveCssRef('../css/a.css', c)).toBe(path.join(root, 'brand/template/fam/css/a.css'))
    // @system 根内上溯：从 css/ 回到根
    expect(resolveCssRef('@system/css/../reset.css', c)).toBe(path.join(root, 'reset.css'))
    // 越出根（上溯层数超过层级）→ 拒绝
    expect(() => resolveCssRef('../../../../../outside.css', c)).toThrow('越出')
    expect(resolveCssRef('https://cdn.example.com/a.css', c)).toBeNull()
  })

  it('自定义来源下 @root 指向 custom 根，@system 仍指系统根（跨源引用）', () => {
    const sys = tempRoot()
    const cus = tempRoot()
    const c = ctx(sys, cus, cus)
    expect(resolveCssRef('@root/css/a.css', c)).toBe(path.join(cus, 'css/a.css'))
    expect(resolveCssRef('@system/css/reset.css', c)).toBe(path.join(sys, 'css/reset.css'))
  })
})

describe('R28 提取 / 去重 / head 提前', () => {
  it('按首次出现顺序去重：片段多份、模板与片段重复引用都只收一次', () => {
    const sys = tempRoot()
    const cus = sys
    put(path.join(sys, 'css/reset.css'), '.reset{}')
    put(path.join(sys, 'css/brand.css'), '.brand{}')
    put(path.join(cus, 'css/theme.css'), '.theme{}')
    const c = ctx(sys, cus)
    const template = '<html><head><link rel="stylesheet" href="@system/css/reset.css"></head><body>x</body></html>'
    const frag = '<link rel="stylesheet" href="@root/css/brand.css"><link rel="stylesheet" href="@system/css/reset.css"><div>f</div>'
    const frag2 = '<link rel="stylesheet" href="@root/css/brand.css"><div>f2</div>'

    const linked = collectLinkedCss([
      { html: template, ctx: c },
      { html: frag, ctx: c },
      { html: frag2, ctx: c },
    ])
    expect(linked.refs).toHaveLength(2)
    expect(linked.css).toBe('.reset{}\n\n.brand{}')
    expect(linked.htmls[0]).not.toContain('<link')
    expect(linked.htmls[1]).not.toContain('<link')
    expect(linked.warnings).toHaveLength(0)
  })

  it('缺失文件与非法引用给出告警但不抛错', () => {
    const c = ctx(tempRoot(), tempRoot())
    const linked = collectLinkedCss([{ html: '<link rel="stylesheet" href="@system/css/nope.css"><link rel="stylesheet" href="../../../../../outside.css">', ctx: c }])
    expect(linked.warnings.some((w) => w.includes('不存在'))).toBe(true)
    expect(linked.warnings.some((w) => w.includes('越出'))).toBe(true)
  })

  it('injectCssIntoHead 放进 head；无 head 时补 head；空 css 不动', () => {
    const html = '<html><head><title>t</title></head><body>b</body></html>'
    expect(injectCssIntoHead(html, '')).toBe(html)
    const out = injectCssIntoHead(html, '.a{}')
    expect(out).toContain('<head>\n<style>\n.a{}\n</style>')
    expect(out.indexOf('.a{}')).toBeLessThan(out.indexOf('<title>'))
    expect(injectCssIntoHead('<div>x</div>', '.a{}').startsWith('<style>')).toBe(true)
  })

  it('extractCssHrefs / stripCssLinks / hasExplicitCssRefs', () => {
    const html = '<link href="a.css" rel="stylesheet"><link rel="icon" href="x.ico"><div>x</div>'
    expect(extractCssHrefs(html)).toEqual(['a.css'])
    expect(stripCssLinks(html)).not.toContain('a.css')
    expect(stripCssLinks(html)).toContain('rel="icon"')
    expect(hasExplicitCssRefs([{ html, ctx: ctx(tempRoot(), tempRoot()) }])).toBe(true)
    expect(hasExplicitCssRefs([{ html: '<div>no css</div>', ctx: ctx(tempRoot(), tempRoot()) }])).toBe(false)
  })
})
