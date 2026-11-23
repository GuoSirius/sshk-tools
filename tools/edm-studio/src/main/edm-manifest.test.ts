/**
 * 缺失字段补齐回归（2026-11-23）：品牌/族/版本 meta 与 .njk 缺失时节点仍出现在树上，
 * css/ 目录不被误当版本；补齐只发生在内存，用户保存时才由 content:writeFile 落盘。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEdmModel } from './edm-manifest'

const dirs: string[] = []
const EDM_ROOT = fileURLToPath(new URL('../../assets/edm', import.meta.url))

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-edm-manifest-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('EDM 解析缺失字段补齐', () => {
  it('品牌缺 name / 族缺 meta / 片段版本缺 meta 与 njk：节点仍出现且给出可落盘路径', async () => {
    const root = makeRoot()
    const verDir = join(root, 'acme', 'fragment', 'hero', 'v1')
    mkdirSync(join(verDir, 'css'), { recursive: true })
    writeFileSync(join(root, 'acme', 'meta.yaml'), 'description: demo\n')
    writeFileSync(join(verDir, 'css', 'a.css'), '.a{}')

    const model = await loadEdmModel(root)
    expect(model.brands).toHaveLength(1)
    const brand = model.brands[0]!
    expect(brand.code).toBe('acme')
    expect(brand.meta.name).toBe('acme')
    expect(brand.fragments).toHaveLength(1)
    const fam = brand.fragments[0]!
    expect(fam.meta.code).toBe('hero')
    expect(fam.meta.name).toBe('hero')
    // css/ 目录被排除，只剩 v1 一个版本
    expect(fam.versions).toHaveLength(1)
    const ver = fam.versions[0]!
    expect(ver.dir).toBe('v1')
    expect(ver.meta.version).toBe(1)
    expect((ver.meta as { code: string; name: string }).code).toBe('v1')
    expect((ver.meta as { code: string; name: string }).name).toBe('v1')
    expect(brand.fragmentMeta?.code).toBe('fragment')
    expect(brand.templateMeta?.name).toBe('template')
    expect(ver.source).toBe('fragment.njk')
    expect(ver.sourcePath).toBe(join(verDir, 'fragment.njk'))
    expect(existsSync(ver.sourcePath)).toBe(false) // 只补内存，不主动写文件
  })

  it('模板版本缺 meta 与 njk：默认源名 template.njk；族目录自身折叠版本同样补齐', async () => {
    const root = makeRoot()
    const famDir = join(root, 'acme', 'template', 'standard')
    mkdirSync(famDir, { recursive: true })

    const model = await loadEdmModel(root)
    const fam = model.brands[0]!.templates[0]!
    expect(fam.versions).toHaveLength(1)
    expect(fam.versions[0]!.dir).toBe('')
    expect(fam.versions[0]!.source).toBe('template.njk')
    expect(fam.versions[0]!.sourcePath).toBe(join(famDir, 'template.njk'))
  })

  it('meta 已有 code/name/version 时原值优先，不被默认值覆盖', async () => {
    const root = makeRoot()
    const verDir = join(root, 'acme', 'fragment', 'hero', 'v2')
    mkdirSync(verDir, { recursive: true })
    writeFileSync(join(root, 'acme', 'meta.yaml'), 'code: acme\nname: Acme Corp\n')
    writeFileSync(join(root, 'acme', 'fragment', 'hero', 'meta.yaml'), 'code: hero\nname: 顶部横幅\n')
    writeFileSync(join(verDir, 'meta.yaml'), 'version: 7\n')
    writeFileSync(join(verDir, 'custom.njk'), 'hi')

    const model = await loadEdmModel(root)
    const brand = model.brands[0]!
    expect(brand.meta.name).toBe('Acme Corp')
    const fam = brand.fragments[0]!
    expect(fam.meta.name).toBe('顶部横幅')
    const ver = fam.versions[0]!
    expect(ver.meta.version).toBe(7)
    expect(ver.source).toBe('custom.njk')
  })

  it('真实系统资产解析不变：内置品牌与既有族仍在（用户新建品牌不影响）', async () => {
    const model = await loadEdmModel(EDM_ROOT)
    const codes = model.brands.map((b) => b.code)
    expect(codes).toContain('elabscience')
    expect(codes).toContain('procell')
    for (const code of ['elabscience', 'procell']) {
      const b = model.brands.find((x) => x.code === code)
      expect(b?.fragments.some((f) => f.code === 'banner')).toBe(true)
      expect(b?.templates.some((t) => t.code === 'standard')).toBe(true)
    }
  })
})
