/**
 * R8 首次运行播种：系统内容（assets/edm）注册进 NeDB 查询索引。
 * - 文件为源真相：播种文档 origin='system' 且只读（ipc 层拒绝编辑/删除，改 = saveAsNew 派生副本）；
 * - 确定性 ID `<前缀>_sys_<code>`：与 ULID 天然不冲突；逐实体「存在即跳过」幂等，
 *   重启不重复播种，新增内置内容自动补种，用户归档的系统实体也不会被复活；
 * - css 按就近链（顶层 → 品牌 → 族 → 版本，R5）拼为 inline 内容进 source.css，
 *   邮件生成（collectCss inline 模式）无需感知 edm 根路径即可复用三阶段管线。
 */
import { promises as fs } from 'node:fs'
import type {
  Brand,
  Fragment,
  FragmentVersion,
  Repository,
  Template,
  TemplateVersion,
} from '@sshk/repository'
import { loadEdmModel } from './edm-manifest.js'
import { collectSystemCssContent } from '../core/system-css.js'

const sysBrandId = (code: string): string => `brd_sys_${code}`
const sysFragmentId = (brand: string, fam: string): string => `frg_sys_${brand}_${fam}`
const sysFragmentVersionId = (brand: string, fam: string, dir: string): string =>
  `frgv_sys_${brand}_${fam}_${dir || 'default'}`
const sysTemplateId = (brand: string, fam: string): string => `tpl_sys_${brand}_${fam}`
const sysTemplateVersionId = (brand: string, fam: string, dir: string): string =>
  `tplv_sys_${brand}_${fam}_${dir || 'default'}`

export interface SeedCounts {
  brands: number
  fragments: number
  fragmentVersions: number
  templates: number
  templateVersions: number
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 版本号恒取目录名 vN（default / 无数字记 1；2026-11-23 用户拍板只读派生）。
 * metaVersion 参数保留仅为兼容既有调用点，不再参与取值——手填 version 与目录漂移会
 * 让邮件编辑器显示错版本、latestVersionId 误判。system:derive 派生亦复用本函数。
 */
export function versionNumberOf(dir: string, _metaVersion?: unknown): number {
  const m = /v(\d+)/i.exec(dir)
  return m ? Number(m[1]) : 1
}

/** 播种系统内容进 NeDB（幂等；返回本次实际新增条数） */
export async function seedSystemContent(repo: Repository, root: string): Promise<SeedCounts> {
  const counts: SeedCounts = { brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0 }
  const model = await loadEdmModel(root)

  for (const b of model.brands) {
    const brandId = sysBrandId(b.code)
    if (!(await repo.get<Brand>('brands', brandId))) {
      await repo.insert<Brand>('brands', {
        _id: brandId,
        code: b.code,
        name: b.meta.name,
        origin: 'system',
      })
      counts.brands++
    }

    for (const fam of b.fragments) {
      const fragId = sysFragmentId(b.code, fam.code)
      if (!(await repo.get<Fragment>('fragments', fragId))) {
        await repo.insert<Fragment>('fragments', {
          _id: fragId,
          brandId,
          name: fam.meta.name,
          description: fam.meta.description,
          type: fam.meta.type || 'product',
          origin: 'system',
        })
        counts.fragments++
      }
      let latestFv: { id: string; version: number } | null = null
      for (const v of fam.versions) {
        const fvId = sysFragmentVersionId(b.code, fam.code, v.dir)
        if (!(await repo.get<FragmentVersion>('fragmentVersions', fvId))) {
          const policy = v.meta.policy ?? fam.meta.policy
          await repo.insert<FragmentVersion>('fragmentVersions', {
            _id: fvId,
            fragmentId: fragId,
            brandId,
            version: versionNumberOf(v.dir, v.meta.version),
            label: `v${versionNumberOf(v.dir, v.meta.version)}`,
            type: fam.meta.type || 'product',
            source: {
              html: (await readText(v.sourcePath)) ?? '',
              css: await collectSystemCssContent(root, { brandCode: b.code, kind: 'fragment', familyCode: fam.code, versionDir: v.dir }),
              cssMode: 'inline',
            },
            policy: { blacklist: policy?.blacklist ?? [], whitelist: policy?.whitelist ?? [] },
            dataSchema: fam.meta.dataSchema,
            fields: v.meta.fields ?? fam.meta.fields ?? undefined,
            sampleData: v.sample ?? undefined,
            origin: 'system',
          })
          counts.fragmentVersions++
        }
        const n = versionNumberOf(v.dir, v.meta.version)
        if (!latestFv || n > latestFv.version) latestFv = { id: fvId, version: n }
      }
      if (latestFv) await repo.update<Fragment>('fragments', fragId, { latestVersionId: latestFv.id })
    }

    for (const fam of b.templates) {
      const tplId = sysTemplateId(b.code, fam.code)
      if (!(await repo.get<Template>('templates', tplId))) {
        await repo.insert<Template>('templates', {
          _id: tplId,
          brandId,
          name: fam.meta.name,
          description: fam.meta.description,
          origin: 'system',
        })
        counts.templates++
      }
      let latestTv: { id: string; version: number } | null = null
      for (const v of fam.versions) {
        const tvId = sysTemplateVersionId(b.code, fam.code, v.dir)
        if (!(await repo.get<TemplateVersion>('templateVersions', tvId))) {
          const n = versionNumberOf(v.dir, v.meta.version)
          await repo.insert<TemplateVersion>('templateVersions', {
            _id: tvId,
            templateId: tplId,
            brandId,
            version: n,
            label: `v${n}`,
            source: {
              html: (await readText(v.sourcePath)) ?? '',
              css: await collectSystemCssContent(root, { brandCode: b.code, kind: 'template', familyCode: fam.code, versionDir: v.dir }),
              cssMode: 'inline',
            },
            slots: (fam.meta.slots ?? []).map((s) => ({ key: s.key, type: s.type, required: false, multiple: false })),
            dataSchema: fam.meta.dataSchema,
            fields: v.meta.fields ?? undefined,
            sampleData: v.sample ?? undefined,
            origin: 'system',
          })
          counts.templateVersions++
        }
        const n = versionNumberOf(v.dir, v.meta.version)
        if (!latestTv || n > latestTv.version) latestTv = { id: tvId, version: n }
      }
      if (latestTv) await repo.update<Template>('templates', tplId, { latestVersionId: latestTv.id })
    }
  }

  return counts
}

/* ── R24 自定义根薄索引：文件为真相源，扫描 custom-edm 根 → 同步 NeDB origin='custom' ──
 * - 行为与系统播种一致（css 就近链内联进 source.css）；
 * - 幂等 + 刷新：已存在实体按文件更新；文件已删的实体从 NeDB 清理；
 * - 邮件编辑器 / 生成逻辑零改动（沿用 origin 字段区分）。 */
const cusBrandId = (code: string): string => `cus_brd_${code}`
const cusFragmentId = (brand: string, fam: string): string => `cus_frg_${brand}_${fam}`
const cusFragmentVersionId = (brand: string, fam: string, dir: string): string =>
  `cus_frgv_${brand}_${fam}_${dir || 'default'}`
const cusTemplateId = (brand: string, fam: string): string => `cus_tpl_${brand}_${fam}`
const cusTemplateVersionId = (brand: string, fam: string, dir: string): string =>
  `cus_tplv_${brand}_${fam}_${dir || 'default'}`

/** 播种 / 同步自定义内容进 NeDB（返回本次新增 / 更新 / 清理条数） */
export async function seedCustomContent(repo: Repository, root: string): Promise<SeedCounts & { removed: number }> {
  const counts: SeedCounts & { removed: number } = { brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0, removed: 0 }
  const model = await loadEdmModel(root)
  // 期望实体 ID 集合（用于清理已删文件对应的 NeDB 实体）
  const want = {
    brands: new Set<string>(),
    fragments: new Set<string>(),
    fragmentVersions: new Set<string>(),
    templates: new Set<string>(),
    templateVersions: new Set<string>(),
  }

  for (const b of model.brands) {
    const brandId = cusBrandId(b.code)
    want.brands.add(brandId)
    const existing = await repo.get<Brand>('brands', brandId)
    if (!existing) {
      await repo.insert<Brand>('brands', { _id: brandId, code: b.code, name: b.meta.name, origin: 'custom' })
      counts.brands++
    } else {
      await repo.update<Brand>('brands', brandId, { code: b.code, name: b.meta.name, origin: 'custom' })
    }

    for (const fam of b.fragments) {
      const fragId = cusFragmentId(b.code, fam.code)
      want.fragments.add(fragId)
      const existingF = await repo.get<Fragment>('fragments', fragId)
      if (!existingF) {
        await repo.insert<Fragment>('fragments', {
          _id: fragId, brandId, name: fam.meta.name, description: fam.meta.description, type: fam.meta.type || 'product', origin: 'custom',
        })
        counts.fragments++
      } else {
        await repo.update<Fragment>('fragments', fragId, { brandId, name: fam.meta.name, description: fam.meta.description, type: fam.meta.type || 'product', origin: 'custom' })
      }
      let latestFv: { id: string; version: number } | null = null
      for (const v of fam.versions) {
        const fvId = cusFragmentVersionId(b.code, fam.code, v.dir)
        want.fragmentVersions.add(fvId)
        const n = versionNumberOf(v.dir, v.meta.version)
        const policy = v.meta.policy ?? fam.meta.policy
        const patch = {
          fragmentId: fragId, brandId, version: n, label: `v${n}`, type: fam.meta.type || 'product',
          source: {
            html: (await readText(v.sourcePath)) ?? '',
            css: await collectSystemCssContent(root, { brandCode: b.code, kind: 'fragment', familyCode: fam.code, versionDir: v.dir }),
            cssMode: 'inline' as const,
          },
          policy: { blacklist: policy?.blacklist ?? [], whitelist: policy?.whitelist ?? [] },
          dataSchema: fam.meta.dataSchema,
          fields: v.meta.fields ?? fam.meta.fields ?? undefined,
          sampleData: v.sample ?? undefined,
          origin: 'custom' as const,
        }
        if (!(await repo.get<FragmentVersion>('fragmentVersions', fvId))) {
          await repo.insert<FragmentVersion>('fragmentVersions', { _id: fvId, ...patch })
          counts.fragmentVersions++
        } else {
          await repo.update<FragmentVersion>('fragmentVersions', fvId, patch)
        }
        if (!latestFv || n > latestFv.version) latestFv = { id: fvId, version: n }
      }
      if (latestFv) await repo.update<Fragment>('fragments', fragId, { latestVersionId: latestFv.id })
    }

    for (const fam of b.templates) {
      const tplId = cusTemplateId(b.code, fam.code)
      want.templates.add(tplId)
      const existingT = await repo.get<Template>('templates', tplId)
      if (!existingT) {
        await repo.insert<Template>('templates', {
          _id: tplId, brandId, name: fam.meta.name, description: fam.meta.description, origin: 'custom',
        })
        counts.templates++
      } else {
        await repo.update<Template>('templates', tplId, { brandId, name: fam.meta.name, description: fam.meta.description, origin: 'custom' })
      }
      let latestTv: { id: string; version: number } | null = null
      for (const v of fam.versions) {
        const tvId = cusTemplateVersionId(b.code, fam.code, v.dir)
        want.templateVersions.add(tvId)
        const n = versionNumberOf(v.dir, v.meta.version)
        const patch = {
          templateId: tplId, brandId, version: n, label: `v${n}`,
          source: {
            html: (await readText(v.sourcePath)) ?? '',
            css: await collectSystemCssContent(root, { brandCode: b.code, kind: 'template', familyCode: fam.code, versionDir: v.dir }),
            cssMode: 'inline' as const,
          },
          slots: (fam.meta.slots ?? []).map((s) => ({ key: s.key, type: s.type, required: false, multiple: false })),
          dataSchema: fam.meta.dataSchema,
          fields: v.meta.fields ?? undefined,
          sampleData: v.sample ?? undefined,
          origin: 'custom' as const,
        }
        if (!(await repo.get<TemplateVersion>('templateVersions', tvId))) {
          await repo.insert<TemplateVersion>('templateVersions', { _id: tvId, ...patch })
          counts.templateVersions++
        } else {
          await repo.update<TemplateVersion>('templateVersions', tvId, patch)
        }
        if (!latestTv || n > latestTv.version) latestTv = { id: tvId, version: n }
      }
      if (latestTv) await repo.update<Template>('templates', tplId, { latestVersionId: latestTv.id })
    }
  }

  // 清理：NeDB 中 origin=custom 但文件中已不存在的实体（文件删除 → 索引同步清理）
  type SeedEntity = Brand | Fragment | Template | FragmentVersion | TemplateVersion
  for (const coll of ['brands', 'fragments', 'fragmentVersions', 'templates', 'templateVersions'] as const) {
    const existing = await repo.list<SeedEntity>(coll, { origin: 'custom', archived: false })
    for (const doc of existing) {
      if (!want[coll].has(doc._id)) {
        await repo.remove(coll, doc._id)
        counts.removed++
      }
    }
  }

  return counts
}
