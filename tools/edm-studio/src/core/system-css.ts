/**
 * EDM 系统内容 css 就近汇集与预览渲染（R5）。
 * 就近提升规则（规划第三节）：css 放在「被引用文件最近公共祖先目录」的 css/ 下。
 * 汇集顺序（assembled 阶段 head 注入）：base-reset → 顶层 css → 品牌 css → 族 css → 版本 css → 模板内联 → juice。
 * 越近的 css 越靠后，优先级越高（覆盖优先）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as yaml from 'js-yaml'
import { renderFragment, renderMail } from './render.js'

async function readYaml<T>(file: string): Promise<T | null> {
  try {
    return yaml.load(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
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

async function cssIn(dir: string): Promise<string[]> {
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.css'))
    return files.map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

export interface SystemSelector {
  brandCode: string
  /** 'fragment' | 'template' */
  kind: string
  familyCode: string
  /** 版本目录名：default / v1 / ''（单版本折叠） */
  versionDir: string
}

/**
 * 按就近原则收集某版本相关的 css 文件绝对路径，顺序：顶层 → 品牌 → 族 → 版本。
 */
export async function collectSystemCss(root: string, sel: SystemSelector): Promise<string[]> {
  const levels = [
    path.join(root, 'css'),
    path.join(root, sel.brandCode, 'css'),
    path.join(root, sel.brandCode, sel.kind, sel.familyCode, 'css'),
  ]
  if (sel.versionDir) levels.push(path.join(root, sel.brandCode, sel.kind, sel.familyCode, sel.versionDir, 'css'))
  const out: string[] = []
  for (const dir of levels) out.push(...(await cssIn(dir)))
  return out
}

export interface SystemPreview {
  html: string
  cssFiles: string[]
}

/**
 * 渲染系统内容预览：读取源 njk + 示例数据 + 就近 css，输出可直接塞进 iframe 的 HTML。
 * 片段用 renderFragment；模板用 renderMail（strict=false 容忍未绑定槽位）。
 */
export async function renderSystemPreview(root: string, sel: SystemSelector): Promise<SystemPreview> {
  const versionDir = sel.versionDir ? path.join(root, sel.brandCode, sel.kind, sel.familyCode, sel.versionDir) : path.join(root, sel.brandCode, sel.kind, sel.familyCode)
  const src = await findSource(versionDir)
  if (!src) throw new Error(`找不到源文件：${versionDir}`)
  const source = await fs.readFile(src.path, 'utf8')
  const sample = (await readYaml<Record<string, unknown>>(path.join(versionDir, 'sample.yaml'))) ?? {}

  const cssFiles = await collectSystemCss(root, sel)
  const parts: string[] = []
  const baseReset = path.join(root, 'css', 'base-reset.css')
  if (cssFiles.includes(baseReset)) {
    parts.push(await fs.readFile(baseReset, 'utf8'))
  } else {
    try {
      parts.push(await fs.readFile(baseReset, 'utf8'))
    } catch {
      /* 无 base-reset 不阻塞 */
    }
  }
  for (const f of cssFiles) {
    if (f === baseReset) continue
    parts.push(await fs.readFile(f, 'utf8'))
  }
  const cssBundle = parts.join('\n\n')

  if (sel.kind === 'fragment') {
    const body = renderFragment(source, sample)
    return { html: `<style>\n${cssBundle}\n</style>\n${body}`, cssFiles }
  }

  const stages = await renderMail({
    templateHtml: source,
    bindings: {},
    data: sample,
    render: { strict: false, autoEscape: true },
    cssBundle,
  })
  return { html: stages.assembled, cssFiles }
}
