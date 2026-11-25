/**
 * R28：显式 CSS 引用引擎（取代「就近自动全收」）。
 *
 * 用户在模板 / 片段 njk 源码中自己写 <link rel="stylesheet" href="..."> 精确控制引入哪些 css，
 * 路径用逻辑 URI，不再需要 ../../ 逐层推算（2026-11-24 用户口径：只保留三个前缀）：
 *   ./css/a.css          当前文件所在版本目录（禁止 ..，层级由引擎解析）
 *   @root/css/a.css      当前来源根（自动判断：系统实体=系统根 / 自定义实体=自定义根，一般用这个）
 *   @system/css/a.css    显式系统根（自定义要使用系统资源时用，如 reset.css）
 *   @custom/css/a.css    显式自定义根（系统使用自定义资源时用，几乎用不到但保留）
 *
 * 渲染时统一：按源码出现顺序提取 → 解析 → 去重（片段多份/多引用自动合并）→ 读内容
 * → 从各 html 剥离 link → 以 <style> 注入 <head>，再由 juice 内联。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 只匹配 stylesheet link（大小写 / 属性顺序宽松） */
const LINK_RE = /<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/i

export interface CssRefContext {
  /** 当前来源根：系统=edmRoot / 自定义=custom-edm */
  sourceRoot: string
  /** 系统根（@system） */
  systemRoot: string
  /** 自定义根（@custom） */
  customRoot: string
  /** 当前文件所在版本目录（./ 基准） */
  versionDir: string
}

export interface CssRefSource {
  html: string
  ctx: CssRefContext
}

export interface LinkedCss {
  /** 去重后按首次出现顺序拼接的 css 内容 */
  css: string
  /** 解析后的绝对路径（去重后，顺序同 css） */
  refs: string[]
  warnings: string[]
  /** 与输入顺序一致的、已剥离 stylesheet link 的 html */
  htmls: string[]
}

export function extractCssHrefs(html: string): string[] {
  const out: string[] = []
  for (const match of html.matchAll(LINK_RE)) {
    const href = HREF_RE.exec(match[0])?.[1]
    if (href) out.push(href)
  }
  return out
}

/** 剥离 stylesheet link 标签（外链一并剥离，避免邮件客户端重复请求） */
export function stripCssLinks(html: string): string {
  return html.replace(LINK_RE, '')
}

/**
 * 逻辑 URI → 绝对路径（2026-11-25 修订 3：允许 `..` 上溯，解析后兜底限定在对应根内）。
 * - 前缀决定允许根：@system→systemRoot / @custom→customRoot / @root 与裸路径→sourceRoot / ./→versionDir
 * - path.resolve 归一化后若越出允许根即拒绝（防目录穿越）；不因出现 `..` 字面就 throw
 * - http(s)/data/file 外链返回 null 并交由调用方告警
 */
export function resolveCssRef(href: string, ctx: CssRefContext): string | null {
  const h = href.trim()
  if (/^(https?:|data:|file:)/i.test(h)) return null
  const pick = (base: string, rest: string, scope: string, guardRoot = base): string => {
    const resolved = path.resolve(path.resolve(base), rest.replace(/^\/+/, ''))
    const root = path.resolve(guardRoot)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`CSS 引用越出 ${scope} 根：${href}`)
    }
    return resolved
  }
  if (h.startsWith('@system/')) return pick(ctx.systemRoot, h.slice('@system/'.length), '@system')
  if (h.startsWith('@custom/')) return pick(ctx.customRoot, h.slice('@custom/'.length), '@custom')
  if (h.startsWith('@root/')) return pick(ctx.sourceRoot, h.slice('@root/'.length), '@root')

  // ./xxx 或 xxx：相对当前版本目录解析，但允许 ../ 在来源根内上溯（兜底限 sourceRoot）
  return pick(ctx.versionDir, h.replace(/^\.\//, ''), '@root', ctx.sourceRoot)
}

/** 按源码出现顺序收集、去重（片段 repeat / 多个片段引用同一 css 只收一次） */
export function collectLinkedCss(sources: CssRefSource[]): LinkedCss {
  const refs: string[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    for (const href of extractCssHrefs(source.html)) {
      try {
        const resolved = resolveCssRef(href, source.ctx)
        if (!resolved) {
          warnings.push(`外链 CSS 已跳过（邮件客户端常被拦截，请改为 @system / @root 本地引用）：${href}`)
          continue
        }
        if (seen.has(resolved)) continue
        seen.add(resolved)
        refs.push(resolved)
      } catch (err) {
        warnings.push((err as Error).message)
      }
    }
  }

  const parts: string[] = []
  for (const ref of refs) {
    if (!existsSync(ref)) {
      warnings.push(`CSS 文件不存在：${ref}`)
      continue
    }
    try {
      parts.push(readFileSync(ref, 'utf8'))
    } catch (err) {
      warnings.push(`CSS 读取失败（${ref}）：${(err as Error).message}`)
    }
  }

  return {
    css: parts.join('\n\n'),
    refs,
    warnings,
    htmls: sources.map((s) => stripCssLinks(s.html)),
  }
}

/** 把汇集后的 css 以 <style> 注入 <head>（无 head 时补一个，再不济放最前） */
export function injectCssIntoHead(html: string, css: string): string {
  if (!css.trim()) return html
  const style = `<style>\n${css}\n</style>\n`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${style}`)
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>\n${style}</head>`)
  return style + html
}

/** 是否含显式 css 引用（用于「显式优先、无 link 时回退就近链」的兼容判断） */
export function hasExplicitCssRefs(sources: CssRefSource[]): boolean {
  return sources.some((s) => extractCssHrefs(s.html).length > 0)
}
