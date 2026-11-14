/**
 * R8 播种测试：复用真实 assets/edm 作为夹具（顺带回归 manifest 解析）。
 * 覆盖：幂等（二次播种零新增）、origin='system' 实体注册、确定性 ID、
 * css 就近链内联、候选片段两道过滤查询可用。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '@sshk/repository'
import type { Brand, FragmentVersion, TemplateVersion } from '@sshk/repository'
import { seedSystemContent } from './edm-seed'

const dirs: string[] = []
const EDM_ROOT = fileURLToPath(new URL('../../assets/edm', import.meta.url))

function makeRepo(): Repository {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-edm-seed-'))
  dirs.push(dir)
  return new Repository(dir)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('R8 系统内容播种', () => {
  it('首次播种有产出，二次播种幂等零新增', async () => {
    const repo = makeRepo()
    const first = await seedSystemContent(repo, EDM_ROOT)
    expect(first.brands).toBeGreaterThan(0)
    expect(first.fragments).toBeGreaterThan(0)
    expect(first.fragmentVersions).toBeGreaterThan(0)
    expect(first.templates).toBeGreaterThan(0)
    expect(first.templateVersions).toBeGreaterThan(0)

    const second = await seedSystemContent(repo, EDM_ROOT)
    expect(second).toEqual({ brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0 })
  })

  it('播种实体 origin=system 且确定性 ID 稳定；css 就近链已内联', async () => {
    const repo = makeRepo()
    await seedSystemContent(repo, EDM_ROOT)

    const brand = await repo.get<Brand>('brands', 'brd_sys_elabscience')
    if (!brand) throw new Error('播种品牌缺失')
    expect(brand.origin).toBe('system')
    expect(brand.name).toBe('Elabscience')

    const fv = await repo.get<FragmentVersion>('fragmentVersions', 'frgv_sys_elabscience_banner_v1')
    if (!fv) throw new Error('播种片段版本缺失')
    expect(fv.origin).toBe('system')
    expect(fv.type).toBe('header')
    expect(fv.policy).toEqual({ blacklist: [], whitelist: [] })
    // 版本号取 meta.version（v1 目录声明 version: 2）
    expect(fv.version).toBe(2)
    // njk 源码已读入 + 顶层/品牌/族就近 css 内联（含 base-reset 与 template.css 同链规则）
    expect(fv.source.html).toContain('{{')
    expect(fv.source.cssMode).toBe('inline')
    expect(fv.source.css?.length ?? 0).toBeGreaterThan(0)
  })

  it('播种后候选片段两道过滤查询可用（品牌隔离 + 同槽位类型）', async () => {
    const repo = makeRepo()
    await seedSystemContent(repo, EDM_ROOT)

    const tv = await repo.get<TemplateVersion>('templateVersions', 'tplv_sys_elabscience_standard_v1')
    if (!tv) throw new Error('播种模板版本缺失')
    expect(tv.origin).toBe('system')
    const candidates = await repo.listCandidateFragmentVersions(tv, 'header')
    const sysIds = candidates.map((c) => c._id)
    expect(sysIds).toContain('frgv_sys_elabscience_banner_default')
    expect(sysIds).toContain('frgv_sys_elabscience_banner_v1')
    // 其它品牌片段不得混入（品牌隔离 R10）
    expect(sysIds.every((id) => id.startsWith('frgv_sys_elabscience_'))).toBe(true)
  })
})
