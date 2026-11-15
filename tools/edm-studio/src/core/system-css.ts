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
  collectLinkedCss,
  hasExplicitCssRefs,
  injectCssIntoHead,
  type CssRefContext,
  type CssRefSource,
} from './css-refs.js'

export interface CssRootOptions {
  /** 系统根（@shared / @system 基准）；缺省取当前 root */
  systemRoot?: string
  /** 自定义根（@custom 基准）；缺省取当前 root */
  customRoot?: string
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

/** 兼容层：就近链 css 内容拼接 + 版本级 style.css 最后注入 */
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

  const sources: CssRefSource[] = [{ html: source, ctx: cssCtx(root, dir, opts) }]
  let html = source
  let cssBundle: string
  let cssFiles: string[]

  if (hasExplicitCssRefs(sources)) {
    const linked = collectLinkedCss(sources)
    warnLinked(linked.warnings)
    html = linked.htmls[0] ?? source
    cssBundle = linked.css
    cssFiles = linked.refs
  } else {
    cssFiles = await collectSystemCss(root, sel)
    cssBundle = await collectSystemCssContent(root, sel)
  }

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

  const sources: CssRefSource[] = [
    { html: templateHtml, ctx: cssCtx(root, templateDir, opts) },
    ...raw.map((r) => ({ html: r.html, ctx: r.ctx })),
  ]
  const explicit = hasExplicitCssRefs(sources)
  let htmls = sources.map((s) => s.html)
  let templateCss: string
  let cssFiles: string[]

  if (explicit) {
    const linked = collectLinkedCss(sources)
    warnLinked(linked.warnings)
    htmls = linked.htmls
    templateCss = linked.css
    cssFiles = linked.refs
  } else {
    templateCss = await collectSystemCssContent(root, templateSel)
    cssFiles = await collectSystemCss(root, templateSel)
  }

  const items: ComposePlacement[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    if (!r) continue
    items.push({
      html: htmls[i + 1] ?? r.html,
      css: explicit ? undefined : await collectSystemCssContent(root, r.selector),
      data: r.data,
      slot: r.slot,
      order: r.order,
      repeat: r.repeat,
    })
  }

  const stages = await compose({
    templateHtml: htmls[0] ?? templateHtml,
    templateCss,
    placements: items,
    data: {},
    strict: false,
  })
  return { html: stages.assembled, cssFiles }
}
