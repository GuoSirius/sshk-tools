/**
 * EDM CSS 单链路解析（plans/14 批次 0）。
 *
 * 四条渲染入口（system:render / content:render / mail:preview / mail:generate）
 * 共用本函数，消除「预览解析 link / 生成读播种快照」两条分叉链路：
 *   ① 任一源含显式 <link rel="stylesheet"> → 按书写顺序解析、内容级去重、剥离 link；
 *   ② 全部源无 link → 回退调用方提供的就近链快照（预览读文件 / 生成读播种快照，同源同序）；
 *   ③ 传入 outputRoot 时自动注入 normalize.css（构建期内联）+ uno 原子类；其余 css 一律显式 link；
 *   ④ 调用方把结果 css 以 <style> 注入 head，再由 juice 统一内联。
 */
import { promises as fs } from 'node:fs'
import {
  extractCssHrefs,
  hasExplicitCssRefs,
  resolveCssRef,
  stripCssLinks,
  type CssRefSource,
} from './css-refs.js'
import { collectCss } from './css-bundle.js'

export interface CssResolveSource extends CssRefSource {
  /** 无显式 link 时的回退 css 内容（就近文件链快照 / 播种快照） */
  fallbackCss?: string
}

export interface ResolveCssInput {
  sources: CssResolveSource[]
  /** 传入时注入 normalize.css + uno（框架自动注入两项；播种期不传，只存去重后的页面 css） */
  outputRoot?: string
  unoEnabled?: boolean
}

export interface ResolveCssResult {
  /** 最终 css（含框架自动注入的 normalize.css + uno 原子类） */
  css: string
  /** 与输入顺序一致、已剥离 stylesheet link 的 html */
  htmls: string[]
  /** 内容级去重后的 css 绝对路径（回退模式为空） */
  refs: string[]
  warnings: string[]
}

/** 显式 link 链：解析 → 读内容 → 按内容去重 → 剥离 link */
async function collectExplicit(sources: CssResolveSource[]): Promise<ResolveCssResult> {
  const warnings: string[] = []
  const refs: string[] = []
  const parts: string[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    for (const href of extractCssHrefs(source.html)) {
      let resolved: string | null
      try {
        resolved = resolveCssRef(href, source.ctx)
      } catch (err) {
        warnings.push((err as Error).message)
        continue
      }
      if (!resolved) {
        warnings.push(`外链 CSS 已跳过（邮件客户端常被拦截，请改为 @system / @root 本地引用）：${href}`)
        continue
      }
      let content: string
      try {
        content = await fs.readFile(resolved, 'utf8')
      } catch {
        warnings.push(`CSS 文件不存在或读取失败：${resolved}`)
        continue
      }
      const key = content.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      refs.push(resolved)
      parts.push(content)
    }
  }

  return { css: parts.join('\n\n'), htmls: sources.map((s) => stripCssLinks(s.html)), refs, warnings }
}

/** 统一 css 解析入口（四条渲染入口 + 播种共用） */
export async function resolveCssBundle(input: ResolveCssInput): Promise<ResolveCssResult> {
  const sources = input.sources
  let resolved: ResolveCssResult
  if (hasExplicitCssRefs(sources)) {
    resolved = await collectExplicit(sources)
  } else {
    const seen = new Set<string>()
    const parts: string[] = []
    for (const source of sources) {
      const content = source.fallbackCss
      if (!content?.trim()) continue
      const key = content.trim()
      if (seen.has(key)) continue
      seen.add(key)
      parts.push(content)
    }
    resolved = { css: parts.join('\n\n'), htmls: sources.map((s) => stripCssLinks(s.html)), refs: [], warnings: [] }
  }

  if (!input.outputRoot) return resolved

  const bundle = await collectCss({
    outputRoot: input.outputRoot,
    sources: resolved.css.trim() ? [{ mode: 'inline', content: resolved.css }] : [],
    scanCodes: resolved.htmls,
    unoEnabled: input.unoEnabled ?? true,
  })
  return { ...resolved, css: bundle.css, warnings: [...resolved.warnings, ...bundle.warnings] }
}
