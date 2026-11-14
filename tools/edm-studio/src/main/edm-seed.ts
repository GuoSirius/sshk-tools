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
import { collectSystemCss } from '../core/system-css.js'

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

/** css 就近链（顶层 → 品牌 → 族 → 版本）拼接为单段 inline 内容 */
async function cssChainContent(
  root: string,
  brandCode: string,
  kind: string,
  familyCode: string,
  versionDir: string,
): Promise<string> {
  const files = await collectSystemCss(root, { brandCode, kind, familyCode, versionDir })
  const parts: string[] = []
  for (const f of files) {
    const txt = await readText(f)
    if (txt != null) parts.push(txt)
  }
  return parts.join('\n\n')
}

/** 版本号取 meta.version；缺失时按目录名 vN 兜底，default 记 1 */
function versionNumberOf(dir: string, metaVersion: unknown): number {
  if (typeof metaVersion === 'number' && Number.isFinite(metaVersion) && metaVersion > 0) return metaVersion
  const m = /v(\d+)/.exec(dir)
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
              css: await cssChainContent(root, b.code, 'fragment', fam.code, v.dir),
              cssMode: 'inline',
            },
            policy: { blacklist: policy?.blacklist ?? [], whitelist: policy?.whitelist ?? [] },
            dataSchema: fam.meta.dataSchema,
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
              css: await cssChainContent(root, b.code, 'template', fam.code, v.dir),
              cssMode: 'inline',
            },
            slots: (fam.meta.slots ?? []).map((s) => ({ key: s.key, type: s.type, required: false, multiple: false })),
            dataSchema: fam.meta.dataSchema,
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
