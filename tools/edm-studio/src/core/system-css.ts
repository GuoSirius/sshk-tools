/**
 * EDM 系统内容 css 就近汇集与预览渲染（R5 + R19 组合预览）。
 * 就近提升规则（规划第三节）：css 放在「被引用文件最近公共祖先目录」的 css/ 下。
 * 汇集顺序（assembled 阶段 head 注入）：base-reset → 顶层 css → 品牌 css → 类目 css → 族 css → 版本 css → 版本级 style.css。
 * 越近的 css 越靠后，优先级越高（覆盖优先）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as yaml from 'js-yaml'
import { renderFragment, renderMail } from './render.js'
import { compose, type ComposePlacement } from './compose.js'

async function readYaml<T>(file: string): Promise<T | null> {
  try {
    return yaml.load(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
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

/** 版本目录绝对路径（versionDir 为空 = 单版本折叠，族目录即版本） */
function versionDirOf(root: string, sel: SystemSelector): string {
  const base = path.join(root, sel.brandCode, sel.kind, sel.familyCode)
  return sel.versionDir ? path.join(base, sel.versionDir) : base
}

/** 读版本目录下的 njk 源文件内容；无源文件返回 null */
async function readSourceOf(dir: string): Promise<string | null> {
  try {
    const files = await fs.readdir(dir)
    const njk = files.find((f) => f.endsWith('.njk'))
    if (!njk) return null
    return await fs.readFile(path.join(dir, njk), 'utf8')
  } catch {
    return null
  }
}

/**
 * 按就近原则收集某版本相关的 css 文件绝对路径，顺序：顶层 → 品牌 → 类目 → 族 → 版本。
 * 类目级 = <brand>/<kind>/css/（v5：作用域覆盖该类全部族/版本）。
 */
export async function collectSystemCss(root: string, sel: SystemSelector): Promise<string[]> {
  const levels = [
    path.join(root, 'css'),
    path.join(root, sel.brandCode, 'css'),
    path.join(root, sel.brandCode, sel.kind, 'css'),
    path.join(root, sel.brandCode, sel.kind, sel.familyCode, 'css'),
  ]
  if (sel.versionDir) levels.push(path.join(root, sel.brandCode, sel.kind, sel.familyCode, sel.versionDir, 'css'))
  const out: string[] = []
  for (const dir of levels) {
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.css'))
      out.push(...files.map((f) => path.join(dir, f)))
    } catch {
      /* 目录不存在跳过 */
    }
  }
  return out
}

/** 就近链 css 内容拼接 + 版本级 style.css 最后注入（优先级最高；R8 播种与两处预览共用） */
export async function collectSystemCssContent(root: string, sel: SystemSelector): Promise<string> {
  const files = await collectSystemCss(root, sel)
  const parts: string[] = []
  for (const f of files) {
    try {
      parts.push(await fs.readFile(f, 'utf8'))
    } catch {
      /* 单文件读取失败不阻塞 */
    }
  }
  try {
    parts.push(await fs.readFile(path.join(versionDirOf(root, sel), 'style.css'), 'utf8'))
  } catch {
    /* 无内联样式不阻塞 */
  }
  return parts.join('\n\n')
}

export interface SystemPreview {
  html: string
  cssFiles: string[]
}

/**
 * 渲染系统内容预览（单版本，无组合）：读取源 njk + 示例数据 + 就近 css，输出可直接塞进 iframe 的 HTML。
 * 片段用 renderFragment；模板用 renderMail（strict=false 容忍未绑定槽位）。
 */
export async function renderSystemPreview(root: string, sel: SystemSelector): Promise<SystemPreview> {
  const dir = versionDirOf(root, sel)
  const source = await readSourceOf(dir)
  if (!source) throw new Error(`找不到源文件：${dir}`)
  const sample = (await readYaml<Record<string, unknown>>(path.join(dir, 'sample.yaml'))) ?? {}
  const cssFiles = await collectSystemCss(root, sel)
  const cssBundle = await collectSystemCssContent(root, sel)

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

/** 组合预览的片段摆放：片段版本选择器 + 区块/顺序/次数/独立数据（data 缺省读该版本 sample.yaml） */
export interface ComposePlacementSelector {
  selector: SystemSelector
  slot: string
  order?: number
  repeat?: number
  data?: Record<string, unknown>
}

/**
 * 组合预览（R19）：模板版本（templateSel）+ 片段摆放（assets 文件域）→ compose 三阶段 assembled。
 * 片段/模板预览统一入口：片段预览 = placements 单元素指向当前片段；模板预览 = 片段库摆放。
 */
export async function renderSystemCompose(
  root: string,
  templateSel: SystemSelector,
  placements: ComposePlacementSelector[],
): Promise<SystemPreview> {
  const templateDir = versionDirOf(root, templateSel)
  const templateHtml = await readSourceOf(templateDir)
  if (!templateHtml) throw new Error(`找不到模板源文件：${templateDir}`)
  const templateCss = await collectSystemCssContent(root, templateSel)

  const items: ComposePlacement[] = []
  for (const p of placements) {
    const dir = versionDirOf(root, p.selector)
    const html = await readSourceOf(dir)
    if (!html) continue
    const data = p.data ?? ((await readYaml<Record<string, unknown>>(path.join(dir, 'sample.yaml'))) ?? {})
    items.push({
      html,
      css: await collectSystemCssContent(root, p.selector),
      data,
      slot: p.slot,
      order: p.order,
      repeat: p.repeat,
    })
  }
  const stages = await compose({ templateHtml, templateCss, placements: items, data: {}, strict: false })
  return { html: stages.assembled, cssFiles: await collectSystemCss(root, templateSel) }
}
