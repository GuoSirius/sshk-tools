/**
 * R5 就近 css 汇集测试：受控临时目录验证 顶层 → 品牌 → 族 → 版本 顺序与预览渲染。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSystemCss, renderSystemCompose, renderSystemPreview } from './system-css'
import { resolveEntitySample } from './sample-data'

const dirs: string[] = []

function tempEdm(): string {
  const root = mkdtempSync(join(tmpdir(), 'sshk-edm-css-'))
  dirs.push(root)
  return root
}

function writeFile(file: string, content: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('R5 collectSystemCss 就近汇集', () => {
  it('顺序为 顶层 → 品牌 → 族 → 版本，版本目录缺省时不收集版本层', async () => {
    const root = tempEdm()
    writeFile(join(root, 'css/top.css'), '.top{}')
    writeFile(join(root, 'elab/css/brand.css'), '.brand{}')
    writeFile(join(root, 'elab/fragment/banner/css/fam.css'), '.fam{}')
    writeFile(join(root, 'elab/fragment/banner/v1/css/ver.css'), '.ver{}')

    const withVersion = await collectSystemCss(root, { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: 'v1' })
    expect(withVersion.map((p) => p.split(/[\\/]/).slice(-1)[0])).toEqual(['top.css', 'brand.css', 'fam.css', 'ver.css'])

    const collapsed = await collectSystemCss(root, { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: '' })
    expect(collapsed.map((p) => p.split(/[\\/]/).slice(-1)[0])).toEqual(['top.css', 'brand.css', 'fam.css'])
  })
})

describe('R5 renderSystemPreview', () => {
  it('片段预览：njk 按示例数据渲染，css 内联进 <style>', async () => {
    const root = tempEdm()
    writeFile(join(root, 'css/reset.css'), '*{box-sizing:border-box}')
    writeFile(join(root, 'elab/fragment/banner/v1/banner.njk'), '<div>{{ title }}</div>')
    writeFile(join(root, 'elab/fragment/banner/v1/sample.yaml'), 'title: 你好横幅')
    writeFile(join(root, 'elab/fragment/banner/v1/css/ver.css'), '.frag-banner{color:red}')

    const preview = await renderSystemPreview(root, { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: 'v1' })
    expect(preview.html).toContain('<div>你好横幅</div>') // njk 已渲染，无 {{ }} 残留
    expect(preview.html).toContain('<style>')
    expect(preview.html).toContain('.frag-banner{color:red}')
    expect(preview.html).toContain('box-sizing:border-box') // 顶层 base-reset 一并内联
  })

  it('模板预览：strict=false 容忍未绑定槽位，不抛异常', async () => {
    const root = tempEdm()
    writeFile(join(root, 'elab/template/standard/v1/template.njk'), '<table><tr><td>{{ slot_header | safe }}</td></tr></table>')
    writeFile(join(root, 'elab/template/standard/v1/sample.yaml'), 'title: 示例')

    const preview = await renderSystemPreview(root, { brandCode: 'elab', kind: 'template', familyCode: 'standard', versionDir: 'v1' })
    expect(preview.html).toContain('<table>')
  })
})

describe('#212 模板数据固定语法（单渲/组合/片段侧同口径）', () => {
  const tplSel = { brandCode: 'elab', kind: 'template', familyCode: 'standard', versionDir: 'v1' }
  const fragSel = { brandCode: 'elab', kind: 'fragment', familyCode: 'header', versionDir: 'v1' }

  function seed(): string {
    const root = tempEdm()
    writeFile(join(root, 'elab/template/standard/v1/template.njk'),
      '<table><colgroup><col width="{{ leftGap }}" /></colgroup><tr><td>{{ slot_header | safe }}</td></tr></table>')
    writeFile(join(root, 'elab/template/standard/v1/sample.yaml'), 'leftGap: 12\n')
    writeFile(join(root, 'elab/fragment/header/v1/fragment.njk'),
      '<div>{{ template.leftGap }}|{{ own }}</div>')
    writeFile(join(root, 'elab/fragment/header/v1/sample.yaml'), 'own: fragment-data\n')
    return root
  }

  it('单渲：模板 sample.yaml 的 leftGap 生效', async () => {
    const html = (await renderSystemPreview(seed(), tplSel)).html
    expect(html).toContain('width="12"')
    expect(html).not.toContain('{{ leftGap }}')
  })

  it('组合预览：模板 {{ leftGap }} 与片段 {{ template.leftGap }} 均生效', async () => {
    const root = seed()
    const html = (await renderSystemCompose(root, tplSel, [
      { selector: fragSel, slot: 'header' },
    ], { templateData: await resolveEntitySample(root, tplSel) })).html
    expect(html).toContain('width="12"')
    expect(html).toContain('12|fragment-data')
    expect(html).not.toContain('{{ template.leftGap }}')
  })

  it('resolveEntitySample：显式覆盖 > 覆盖层 > sample.yaml > {}', async () => {
    const root = seed()
    expect(await resolveEntitySample(root, tplSel)).toEqual({ leftGap: 12 })
    expect(await resolveEntitySample(root, tplSel, { sampleOverride: { leftGap: 99 } })).toEqual({ leftGap: 99 })
    const overlay = tempEdm()
    writeFile(join(overlay, 'elab/template/standard/v1/sample.yaml'), 'leftGap: 88\n')
    expect(await resolveEntitySample(root, tplSel, { source: 'system', overrideRoot: overlay })).toEqual({ leftGap: 88 })
    expect(await resolveEntitySample(root, { ...tplSel, familyCode: 'missing' })).toEqual({})
  })
})
