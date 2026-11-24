/**
 * EDM 内容预览渲染（R5 + R19 + R28）。
 *
 * R28：CSS 以「源码显式 <link> 控制」优先 —— 按出现顺序提取、解析逻辑 URI、
 *      去重（模板选多个片段 / 一个片段 repeat 多份时自动合并）、剥离 link、
 *      统一以 <style> 注入 <head>。顺序完全由用户源码中 link 的书写顺序决定。
 *      仅当参与组合的源码**完全没有 link** 时，回退 R5 就近链（兼容存量资产，不破坏既有预览）。
 * R5 就近链保留为兼容层：顶层 → 品牌 → 类目 → 族 → 版本 → style.css，同层文件名排序。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as yaml from 'js-yaml'
import { renderFragment, renderMail } from './render.js'
import { compose, type ComposePlacement } from './compose.js'
import {
  hasExplicitCssRefs,
  injectCssIntoHead,
  type CssRefContext,
} from './css-refs.js'
import { resolveCssBundle, type CssResolveSource } from './css-resolve.js'

export interface CssRootOptions {
  /** 系统根（@system 基准）；缺省取当前 root */
  systemRoot?: string
  /** 自定义根（@custom 基准）；缺省取当前 root */
  customRoot?: string
  /** 产物根：传入时注入 normalize.css + uno（框架自动注入两项；四入口一致，预览/生成必须都传） */
  outputRoot?: string
  unoEnabled?: boolean
}

function cssCtx(root: string, versionDir: string, opts: CssRootOptions): CssRefContext {
  return {
    sourceRoot: root,
    systemRoot: opts.systemRoot ?? root,
    customRoot: opts.customRoot ?? root,
    versionDir,
  }
}

function warnLinked(warnings: string[]): void {
  for (const w of warnings) console.warn(`[edm] css 引用警告：${w}`)
}

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

/** 兼容层：就近收集（顶层 → 品牌 → 类目 → 族 → 版本），同层按文件名排序保证确定性 */
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
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.css')).sort()
      out.push(...files.map((f) => path.join(dir, f)))
    } catch {
      /* 目录不存在跳过 */
    }
  }
  return out
}

/** 兼容层：就近链 css 内容拼接 + 版本级 style.css 最后注入（内容级去重，避免 N+1 体积膨胀） */
export async function collectSystemCssContent(root: string, sel: SystemSelector): Promise<string> {
  const files = await collectSystemCss(root, sel)
  files.push(path.join(versionDirOf(root, sel), 'style.css'))
  const parts: string[] = []
  const seen = new Set<string>()
  for (const f of files) {
    try {
      const content = await fs.readFile(f, 'utf8')
      const key = content.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      parts.push(content)
    } catch {
      /* 单文件不存在/读取失败不阻塞 */
    }
  }
  return parts.join('\n\n')
}

export interface SystemPreview {
  html: string
  cssFiles: string[]
}

/** 渲染单版本预览：显式 link 优先，无 link 回退就近链 */
export async function renderSystemPreview(
  root: string,
  sel: SystemSelector,
  opts: CssRootOptions = {},
): Promise<SystemPreview> {
  const dir = versionDirOf(root, sel)
  const source = await readSourceOf(dir)
  if (!source) throw new Error(`找不到源文件：${dir}`)
  const sample = (await readYaml<Record<string, unknown>>(path.join(dir, 'sample.yaml'))) ?? {}

  const sources: CssResolveSource[] = [{ html: source, ctx: cssCtx(root, dir, opts) }]
  const explicit = hasExplicitCssRefs(sources)
  if (!explicit) sources[0]!.fallbackCss = await collectSystemCssContent(root, sel)
  const bundle = await resolveCssBundle({ sources, outputRoot: opts.outputRoot, unoEnabled: opts.unoEnabled })
  warnLinked(bundle.warnings)
  const html = bundle.htmls[0] ?? source
  const cssBundle = bundle.css
  const cssFiles = explicit ? bundle.refs : await collectSystemCss(root, sel)

  if (sel.kind === 'fragment') {
    const body = renderFragment(html, sample)
    return { html: injectCssIntoHead(body, cssBundle), cssFiles }
  }

  const stages = await renderMail({
    templateHtml: html,
    bindings: {},
    data: sample,
    render: { strict: false, autoEscape: true },
    cssBundle,
  })
  return { html: stages.assembled, cssFiles }
}

/** 组合预览的片段摆放：片段版本选择器 + 区块/顺序/次数/独立数据 */
export interface ComposePlacementSelector {
  selector: SystemSelector
  slot: string
  order?: number
  repeat?: number
  data?: Record<string, unknown>
}

interface RawPlacement {
  selector: SystemSelector
  ctx: CssRefContext
  html: string
  data: Record<string, unknown>
  slot: string
  order?: number
  repeat?: number
}

/**
 * 组合预览（R19 + R28）：模板 + 片段摆放 → compose 三阶段 assembled。
 * 显式模式下所有源码的 link 统一收集并去重（片段 repeat 多份不再重复引入），
 * 去重结果作为 templateCss 一次注入 head；回退模式下保持逐 placement 就近链。
 */
export async function renderSystemCompose(
  root: string,
  templateSel: SystemSelector,
  placements: ComposePlacementSelector[],
  opts: CssRootOptions = {},
): Promise<SystemPreview> {
  const templateDir = versionDirOf(root, templateSel)
  const templateHtml = await readSourceOf(templateDir)
  if (!templateHtml) throw new Error(`找不到模板源文件：${templateDir}`)

  const raw: RawPlacement[] = []
  for (const p of placements) {
    const dir = versionDirOf(root, p.selector)
    const html = await readSourceOf(dir)
    if (!html) continue
    const data = p.data ?? ((await readYaml<Record<string, unknown>>(path.join(dir, 'sample.yaml'))) ?? {})
    raw.push({
      selector: p.selector,
      ctx: cssCtx(root, dir, opts),
      html,
      data,
      slot: p.slot,
      order: p.order,
      repeat: p.repeat,
    })
  }

  const sources: CssResolveSource[] = [
    { html: templateHtml, ctx: cssCtx(root, templateDir, opts) },
    ...raw.map((r) => ({ html: r.html, ctx: r.ctx })),
  ]
  const explicit = hasExplicitCssRefs(sources)
  if (!explicit) {
    sources[0]!.fallbackCss = await collectSystemCssContent(root, templateSel)
    for (let i = 0; i < raw.length; i++) sources[i + 1]!.fallbackCss = await collectSystemCssContent(root, raw[i]!.selector)
  }
  const bundle = await resolveCssBundle({ sources, outputRoot: opts.outputRoot, unoEnabled: opts.unoEnabled })
  warnLinked(bundle.warnings)
  const htmls = bundle.htmls

  const items: ComposePlacement[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    if (!r) continue
    items.push({
      html: htmls[i + 1] ?? r.html,
      data: r.data,
      slot: r.slot,
      order: r.order,
      repeat: r.repeat,
    })
  }

  const stages = await compose({
    templateHtml: htmls[0] ?? templateHtml,
    placements: items,
    data: {},
    strict: false,
    resolvedCss: bundle.css,
  })
  return {
    html: stages.assembled,
    cssFiles: explicit ? bundle.refs : await collectSystemCss(root, templateSel),
  }
}
