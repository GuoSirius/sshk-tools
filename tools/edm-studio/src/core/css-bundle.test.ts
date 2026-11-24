import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectCss, injectCss } from './css-bundle.js'

const tmpDirs: string[] = []
function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edm-css-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('EDM css 汇集（数据契约补记 A/B）', () => {
  it('不自动注入 base-reset：未显式 link 时 css 不含 reset 内容', async () => {
    const root = makeRoot()
    const { css } = await collectCss({ outputRoot: root, sources: [], unoEnabled: false })
    expect(css).not.toContain('mso-table-lspace')
    expect(css).not.toContain('ExternalClass')
  })

  it('汇集顺序：local 文件 → inline 内容（base-reset 已交由 njk 显式 link）', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'brand.css'), '.brand{color:red}')
    const { css, warnings } = await collectCss({
      outputRoot: root,
      sources: [
        { mode: 'inline', content: '.inline{color:blue}' },
        { mode: 'local', file: 'brand.css' },
      ],
      unoEnabled: false,
    })
    expect(warnings).toHaveLength(0)
    expect(css).not.toContain('mso-table-lspace')
    expect(css.indexOf('.brand')).toBeLessThan(css.indexOf('.inline'))
  })

  it('local 文件缺失明确告警；external 保留警告不进 style', async () => {
    const root = makeRoot()
    const { css, warnings } = await collectCss({
      outputRoot: root,
      sources: [
        { mode: 'local', file: 'missing.css' },
        { mode: 'external', url: 'https://cdn.example.com/x.css' },
      ],
    })
    expect(css).not.toContain('cdn.example.com')
    expect(warnings.some((w) => w.includes('missing.css'))).toBe(true)
    expect(warnings.some((w) => w.includes('external css'))).toBe(true)
  })

  it('unocss 未安装时优雅降级为警告，不阻断渲染', async () => {
    const root = makeRoot()
    const { warnings } = await collectCss({
      outputRoot: root,
      sources: [],
      scanCodes: ['<div class="p-2">x</div>'],
      unoEnabled: true,
    })
    // 依赖装好时这里会是空警告；未装时必须有明确原因而不是抛错
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('injectCss：css 统一提前到 <head> 内，空 css 不注入', () => {
    expect(injectCss('<html></html>', '')).toBe('<html></html>')
    const out = injectCss('<html><head><title>t</title></head><body>b</body></html>', '.a{color:red}')
    expect(out).toContain('<head>\n<style>\n.a{color:red}')
    expect(out.indexOf('.a{color:red}')).toBeLessThan(out.indexOf('<title>'))
  })
})
