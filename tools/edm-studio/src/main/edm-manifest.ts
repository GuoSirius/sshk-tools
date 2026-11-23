/**
 * EDM 系统内容解析层（R3）：扫描 assets/edm 树 → 构造 Brand→Family→Version 内存模型。
 * 文件为源真相，NeDB 仅作查询索引（Q3）。主进程专用（fs），渲染层通过 system:load 取结果。
 *
 * 缺失字段策略（2026-11-23）：品牌/族/版本的 meta.yaml 缺必填字段、版本缺 .njk 时，
 * 一律在内存里补出可编辑默认值（目录名 / 版本号 / 约定源文件名），让节点出现在树上、
 * 用户可在应用中直接修改；保存时才由 content:writeFile 真正落盘。解析期不告警、不跳过。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as yaml from 'js-yaml'
import type {
  BrandMeta,
  BrandNode,
  EdmModel,
  FragmentFamilyMeta,
  FragmentFamilyNode,
  FragmentVersionMeta,
  TemplateFamilyMeta,
  TemplateFamilyNode,
  TemplateVersionMeta,
  VersionNode,
} from '../core/edm-types.js'

async function readYaml<T>(file: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(file, 'utf8')
    return yaml.load(txt) as T
  } catch {
    return null
  }
}

async function listDirs(p: string): Promise<string[]> {
  try {
    const ents = await fs.readdir(p, { withFileTypes: true })
    return ents.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function findSource(p: string): Promise<{ name: string; path: string } | null> {
  try {
    const files = await fs.readdir(p)
    const njk = files.find((f) => f.endsWith('.njk'))
    return njk ? { name: njk, path: path.join(p, njk) } : null
  } catch {
    return null
  }
}

/** 缺失源文件时的约定名（与现有资产命名一致）；只作内存路径，用户保存源码时才创建 */
const DEFAULT_SOURCE_NAME = { fragment: 'fragment.njk', template: 'template.njk' } as const

/** 目录名 → 版本号（v1/v2 → 1/2；default 或空 → 1），与 edm-seed.versionNumberOf 同口径 */
function versionOfDir(dir: string): number {
  const m = /v(\d+)/i.exec(dir)
  return m ? Number(m[1]) : 1
}

/** 品牌 meta：整份缺失或 code/name 缺失时用目录名补齐 */
async function readBrandMeta(brandDir: string, dirName: string): Promise<BrandMeta> {
  const raw = await readYaml<Partial<BrandMeta>>(path.join(brandDir, 'meta.yaml'))
  return { ...(raw ?? {}), code: raw?.code || dirName, name: raw?.name || dirName }
}

/** 族 meta：整份缺失或 code/name 缺失时用族目录名补齐（泛型：片段族 / 模板族同构） */
async function readFamilyMeta<TFamily extends object>(familyDir: string): Promise<TFamily> {
  const dirName = path.basename(familyDir)
  const raw = await readYaml<Partial<TFamily> & { code?: string; name?: string }>(path.join(familyDir, 'meta.yaml'))
  return { ...(raw ?? {}), code: raw?.code || dirName, name: raw?.name || dirName } as TFamily
}

/** 版本 meta：整份缺失或 version 非法时用目录名补齐 */
async function readVersionMeta<TMeta extends object>(vdir: string, dir: string): Promise<TMeta> {
  const raw = await readYaml<Partial<TMeta> & { version?: number }>(path.join(vdir, 'meta.yaml'))
  const n = raw?.version
  return { ...(raw ?? {}), version: typeof n === 'number' && n > 0 ? n : versionOfDir(dir) } as TMeta
}

/** 某层级 css/ 目录下的文件名列表（不递归；目录不存在返回空，v5 各级 css 目录） */
async function cssFilesIn(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.css')).sort()
  } catch {
    return []
  }
}

async function collectCss(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string, rel: string): Promise<void> => {
    let ents
    try {
      ents = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const rp = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name === 'css') {
          const inner = await fs.readdir(path.join(d, e.name))
          for (const f of inner) if (f.endsWith('.css')) out.push(`${rp}/css/${f}`)
        } else {
          await walk(path.join(d, e.name), rp)
        }
      } else if (e.name.endsWith('.css')) {
        out.push(rp)
      }
    }
  }
  await walk(dir, '')
  return out
}

/**
 * 版本目录扫描：缺 meta.yaml / .njk 均补默认值，不再静默跳过。
 * css/ 是样式目录而非版本目录，必须显式排除（否则补默认后会多出一个假版本节点）。
 */
async function loadVersions<TMeta extends object>(
  familyDir: string,
  sourceName: string,
): Promise<VersionNode<TMeta>[]> {
  const subs = (await listDirs(familyDir)).filter((d) => d !== 'css')
  const out: VersionNode<TMeta>[] = []
  const add = async (dir: string, vdir: string): Promise<void> => {
    const meta = await readVersionMeta<TMeta>(vdir, dir)
    const src = await findSource(vdir)
    const sample = await readYaml<Record<string, unknown>>(path.join(vdir, 'sample.yaml'))
    out.push({
      dir,
      path: vdir,
      meta,
      source: src?.name ?? sourceName,
      sourcePath: src?.path ?? path.join(vdir, sourceName),
      sample: sample ?? null,
      css: await collectCss(vdir),
    })
  }
  for (const sub of subs) await add(sub, path.join(familyDir, sub))
  // 单版本折叠（第九节）：无版本子目录时族目录自身即默认版本
  if (out.length === 0) await add('', familyDir)
  return out
}

async function loadFamily<TFamily extends object, TVersion extends object>(
  familyDir: string,
  sourceName: string,
): Promise<{ meta: TFamily; css: string[]; versions: VersionNode<TVersion>[] }> {
  const meta = await readFamilyMeta<TFamily>(familyDir)
  const versions = await loadVersions<TVersion>(familyDir, sourceName)
  return { meta, css: await cssFilesIn(path.join(familyDir, 'css')), versions }
}

async function loadBrand(brandDir: string, dirName: string): Promise<BrandNode> {
  const meta = await readBrandMeta(brandDir, dirName)
  const fragmentFamilies: FragmentFamilyNode[] = []
  const templateFamilies: TemplateFamilyNode[] = []

  for (const f of (await listDirs(path.join(brandDir, 'fragment'))).filter((d) => d !== 'css')) {
    const fam = await loadFamily<FragmentFamilyMeta, FragmentVersionMeta>(path.join(brandDir, 'fragment', f), DEFAULT_SOURCE_NAME.fragment)
    fragmentFamilies.push({ code: f, path: path.join(brandDir, 'fragment', f), ...fam })
  }
  for (const t of (await listDirs(path.join(brandDir, 'template'))).filter((d) => d !== 'css')) {
    const fam = await loadFamily<TemplateFamilyMeta, TemplateVersionMeta>(path.join(brandDir, 'template', t), DEFAULT_SOURCE_NAME.template)
    templateFamilies.push({ code: t, path: path.join(brandDir, 'template', t), ...fam })
  }

  const brandCss = (await collectCss(path.join(brandDir, 'css'))).map((p) => path.relative(brandDir, path.join(brandDir, p)))
  return {
    // 身份恒取实际目录名（与族/版本一致）：meta.code 只是可编辑的展示别名，
    // 改它不应让树路径/播种 ID/渲染 selector 指向不存在的目录。
    code: dirName,
    path: brandDir,
    meta,
    css: brandCss,
    fragmentCss: await cssFilesIn(path.join(brandDir, 'fragment', 'css')),
    templateCss: await cssFilesIn(path.join(brandDir, 'template', 'css')),
    fragmentMeta: await readYaml(path.join(brandDir, 'fragment', 'meta.yaml')),
    templateMeta: await readYaml(path.join(brandDir, 'template', 'meta.yaml')),
    fragments: fragmentFamilies,
    templates: templateFamilies,
  }
}

/** 解析系统内容根目录 → 完整内存模型（R3）。root 由调用方注入（builtin/dev 或 external，R6）。 */
export async function loadEdmModel(root: string): Promise<EdmModel> {
  const topCss = (await collectCss(path.join(root, 'css'))).map((p) => p)
  const brands: BrandNode[] = []
  for (const b of await listDirs(root)) {
    if (b === 'css') continue // 顶层公共样式目录，非品牌
    brands.push(await loadBrand(path.join(root, b), b))
  }
  return { root, topCss, brands }
}
