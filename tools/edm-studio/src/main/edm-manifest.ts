/**
 * EDM 系统内容解析层（R3）：扫描 assets/edm 树 → 构造 Brand→Family→Version 内存模型。
 * 文件为源真相，NeDB 仅作查询索引（Q3）。主进程专用（fs），渲染层通过 system:load 取结果。
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

async function loadVersions<TMeta>(familyDir: string): Promise<VersionNode<TMeta>[]> {
  const subs = await listDirs(familyDir)
  const out: VersionNode<TMeta>[] = []
  for (const sub of subs) {
    const vdir = path.join(familyDir, sub)
    const meta = await readYaml<TMeta>(path.join(vdir, 'meta.yaml'))
    if (meta == null) continue
    const src = await findSource(vdir)
    if (!src) continue
    const sample = await readYaml<Record<string, unknown>>(path.join(vdir, 'sample.yaml'))
    out.push({
      dir: sub,
      path: vdir,
      meta,
      source: src.name,
      sourcePath: src.path,
      sample: sample ?? null,
      css: await collectCss(vdir),
    })
  }
  // 单版本折叠（第九节）：族目录自身即默认版本（含 meta + 源，无版本子目录）
  if (out.length === 0) {
    const famMeta = await readYaml<TMeta>(path.join(familyDir, 'meta.yaml'))
    const src = await findSource(familyDir)
    if (famMeta && src) {
      const sample = await readYaml<Record<string, unknown>>(path.join(familyDir, 'sample.yaml'))
      out.push({ dir: '', path: familyDir, meta: famMeta, source: src.name, sourcePath: src.path, sample: sample ?? null, css: await collectCss(familyDir) })
    }
  }
  return out
}

async function loadFamily<TFamily, TVersion>(
  familyDir: string,
): Promise<{ meta: TFamily; versions: VersionNode<TVersion>[] } | null> {
  const meta = await readYaml<TFamily>(path.join(familyDir, 'meta.yaml'))
  if (meta == null) return null
  const versions = await loadVersions<TVersion>(familyDir)
  return { meta, versions }
}

async function loadBrand(brandDir: string): Promise<BrandNode | null> {
  const meta = await readYaml<BrandMeta>(path.join(brandDir, 'meta.yaml'))
  if (!meta || !meta.code || !meta.name) {
    console.warn(`[edm] 跳过无效品牌目录 ${brandDir}（缺少 code/name）`)
    return null
  }
  const fragmentFamilies: FragmentFamilyNode[] = []
  const templateFamilies: TemplateFamilyNode[] = []

  for (const f of await listDirs(path.join(brandDir, 'fragment'))) {
    const fam = await loadFamily<FragmentFamilyMeta, FragmentVersionMeta>(path.join(brandDir, 'fragment', f))
    if (fam) fragmentFamilies.push({ code: f, path: path.join(brandDir, 'fragment', f), ...fam })
  }
  for (const t of await listDirs(path.join(brandDir, 'template'))) {
    const fam = await loadFamily<TemplateFamilyMeta, TemplateVersionMeta>(path.join(brandDir, 'template', t))
    if (fam) templateFamilies.push({ code: t, path: path.join(brandDir, 'template', t), ...fam })
  }

  const brandCss = (await collectCss(path.join(brandDir, 'css'))).map((p) => path.relative(brandDir, path.join(brandDir, p)))
  return { code: meta.code, path: brandDir, meta, css: brandCss, fragments: fragmentFamilies, templates: templateFamilies }
}

/** 解析系统内容根目录 → 完整内存模型（R3）。root 由调用方注入（builtin/dev 或 external，R6）。 */
export async function loadEdmModel(root: string): Promise<EdmModel> {
  const topCss = (await collectCss(path.join(root, 'css'))).map((p) => p)
  const brands: BrandNode[] = []
  for (const b of await listDirs(root)) {
    if (b === 'css') continue // 顶层公共样式目录，非品牌（避免每次播种打无效品牌警告）
    const brandDir = path.join(root, b)
    const brand = await loadBrand(brandDir)
    if (brand) brands.push(brand)
  }
  return { root, topCss, brands }
}
