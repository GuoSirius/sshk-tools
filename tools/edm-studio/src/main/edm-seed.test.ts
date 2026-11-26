/**
 * R8 播种测试：复用真实 assets/edm 作为夹具（顺带回归 manifest 解析）。
 * 覆盖：幂等（二次播种零新增）、origin='system' 实体注册、确定性 ID、
 * css 就近链内联、候选片段两道过滤查询可用。
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '@sshk/repository'
import type { Brand, FragmentVersion, TemplateVersion } from '@sshk/repository'
import { seedSystemContent } from './edm-seed'
import { loadEdmModel } from './edm-manifest'

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
    expect(second).toEqual({ brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0, removed: 0 })
  })

  it('文件为真相：刷新已归档跳过的系统版本 / 文件删除清理未归档索引', async () => {
    const repo = makeRepo()
    const root = join(dirs[dirs.length - 1]!, 'edm-copy')
    mkdirSync(root, { recursive: true })
    cpSync(EDM_ROOT, root, { recursive: true })
    await seedSystemContent(repo, root)

    const fvId = 'frgv_sys_elabscience_banner_default'
    const file = join(root, 'elabscience/fragment/banner/default/fragment.njk')
    writeFileSync(file, '<div>{{ title }} refreshed</div>')
    const refreshed = await seedSystemContent(repo, root)
    expect(refreshed.fragmentVersions).toBe(0)
    const fv = await repo.get<FragmentVersion>('fragmentVersions', fvId)
    expect(fv?.source.html).toContain('refreshed')

    // 归档实体不复活：改文件后再次播种，归档标记与旧内容保持不变
    await repo.update<FragmentVersion>('fragmentVersions', fvId, { archived: true })
    writeFileSync(file, '<div>should not revive</div>')
    await seedSystemContent(repo, root)
    expect((await repo.get<FragmentVersion>('fragmentVersions', fvId))?.archived).toBe(true)
    expect((await repo.get<FragmentVersion>('fragmentVersions', fvId))?.source.html).toContain('refreshed')

    // 未归档实体文件被删 → 索引清理
    const otherId = 'frgv_sys_elabscience_banner_v1'
    await repo.update<FragmentVersion>('fragmentVersions', otherId, { archived: false })
    rmSync(join(root, 'elabscience/fragment/banner/v1'), { recursive: true, force: true })
    const cleaned = await seedSystemContent(repo, root)
    expect(cleaned.removed).toBeGreaterThan(0)
    expect(await repo.get<FragmentVersion>('fragmentVersions', otherId)).toBeNull()
  })

  it('归档同 code 的旧随机 id 品牌（垃圾数据），确定性 id 保留且二次播种幂等', async () => {
    const repo = makeRepo()
    // 模拟早期 brand:save 建的遗留品牌：与系统品牌同 code=procell、随机 id、无 origin
    await repo.insert<Brand>('brands', {
      _id: 'brd_01m7enwzrvxwtkmfmyrvf5xhjq', code: 'procell', name: '普诺赛',
    } as Brand)
    const first = await seedSystemContent(repo, EDM_ROOT)
    expect(first.removed).toBeGreaterThan(0)
    expect((await repo.get<Brand>('brands', 'brd_01m7enwzrvxwtkmfmyrvf5xhjq'))?.archived).toBe(true)
    expect((await repo.get<Brand>('brands', 'brd_procell'))?.archived).toBeFalsy()
    // 用户自建品牌（有 origin=custom）不受清理影响
    await repo.insert<Brand>('brands', {
      _id: 'brd_custom01', code: 'mybrand', name: '我的品牌', origin: 'custom',
    } as Brand)
    const second = await seedSystemContent(repo, EDM_ROOT)
    expect(second.removed).toBe(0)
    expect((await repo.get<Brand>('brands', 'brd_custom01'))?.archived).toBeFalsy()
  })

  it('播种实体 origin=system 且确定性 ID 稳定；css 就近链已内联', async () => {
    const repo = makeRepo()
    await seedSystemContent(repo, EDM_ROOT)

    // 期望值从真实资产解析而非硬编码：用户在应用里改了 meta 也不会误报（文件才是真相源）
    const model = await loadEdmModel(EDM_ROOT)
    const srcBrand = model.brands.find((b) => b.code === 'elabscience')
    const srcFv = srcBrand?.fragments.find((f) => f.code === 'banner')?.versions.find((v) => v.dir === 'v1')

    const brand = await repo.get<Brand>('brands', 'brd_elabscience')
    if (!brand) throw new Error('播种品牌缺失')
    expect(brand.origin).toBe('system')
    expect(brand.name).toBe(String(srcBrand?.meta.name ?? 'Elabscience'))

    const fv = await repo.get<FragmentVersion>('fragmentVersions', 'frgv_sys_elabscience_banner_v1')
    if (!fv) throw new Error('播种片段版本缺失')
    expect(fv.origin).toBe('system')
    // #213：片段族 type 已取消，DB 字段保留兼容写空串
    expect(fv.type).toBe('')
    expect(fv.policy).toEqual({ blacklist: [], whitelist: [] })
    // 版本号恒按目录名 vN 派生（只读派生，忽略手填 version）
    expect(fv.version).toBe(srcFv ? Number(/v(\d+)/i.exec(srcFv.dir)?.[1] ?? 1) : 1)
    // njk 源码已读入 + 顶层/品牌/族就近 css 内联（含 base-reset 与 template.css 同链规则）
    expect(fv.source.html).toContain('{{')
    expect(fv.source.cssMode).toBe('inline')
    expect(fv.source.css?.length ?? 0).toBeGreaterThan(0)
  })

  it('播种后候选片段按品牌隔离 + 黑白名单过滤（#213 无类型过滤）', async () => {
    const repo = makeRepo()
    await seedSystemContent(repo, EDM_ROOT)

    const tv = await repo.get<TemplateVersion>('templateVersions', 'tplv_sys_elabscience_standard_v1')
    if (!tv) throw new Error('播种模板版本缺失')
    expect(tv.origin).toBe('system')
    // #213：候选片段不按类型过滤，只按品牌隔离 + 黑白名单
    const candidates = await repo.listCandidateFragmentVersions(tv)
    const sysIds = candidates.map((c) => c._id)
    expect(sysIds).toContain('frgv_sys_elabscience_banner_default')
    expect(sysIds).toContain('frgv_sys_elabscience_banner_v1')
    // 其它品牌片段不得混入（品牌隔离 R10）
    expect(sysIds.every((id) => id.startsWith('frgv_sys_elabscience_'))).toBe(true)
  })
})
