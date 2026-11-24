import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolveSafe } from '@sshk/repository'
import { injectCssIntoHead } from './css-refs.js'
// 框架重置层（2026-11-24 用户口径）：normalize.css 为自动注入的两项之一。
// 构建期（electron-vite/rollup）经 vite ?raw 内联为字符串——安装包零 node_modules 也可用；
// vitest 5 对 css 文件导入（含 ?raw）一律 stub 为空串（实测项目内/node_modules 均空），
// 故运行时回退 createRequire 解析包内文件读取，两条链路产出一致。
import normalizeRaw from 'normalize.css/normalize.css?raw'

let normalizeCssCache: string | null = null

/** normalize.css 内容：构建期 ?raw 优先，vitest 下回退 createRequire 读包文件；两者皆失败返回空并告警 */
export function normalizeResetCss(warnings: string[]): string {
  if (normalizeCssCache !== null) return normalizeCssCache
  if (normalizeRaw && normalizeRaw.length > 0) {
    normalizeCssCache = normalizeRaw
    return normalizeCssCache
  }
  try {
    normalizeCssCache = readFileSync(
      createRequire(import.meta.url).resolve('normalize.css/normalize.css'),
      'utf8',
    )
  } catch (err) {
    warnings.push(`normalize.css 读取失败（重置层为空）：${(err as Error).message.split('\n')[0]}`)
    normalizeCssCache = ''
  }
  return normalizeCssCache
}

/**
 * EDM css 汇集（数据契约补记 A/B/C，2026-11-24 用户口径）：
 * 自动注入仅两项：normalize.css（npm 框架重置）→ uno 原子类（扫描参与渲染的 njk 源码动态生成）。
 * 其余一切 css——含系统/自定义根与所有品牌下的文件、邮件适配 reset.css——必须由 njk
 * 显式 <link> 引入并经 resolveCssBundle 解析后才生效，本层不自动前置/落盘。
 * 汇集结果在 assembled 阶段以 <style> 注入 head，再由 juice 统一内联。
 */

export interface CssSource {
  mode: 'inline' | 'local' | 'external'
  /** inline：内容存 DB */
  content?: string
  /** local：相对产物系统的 css 文件 */
  file?: string
  /** external：线上 URL */
  url?: string
}

export interface CollectCssInput {
  outputRoot: string
  sources: CssSource[]
  /** 参与原子类扫描的源码（模板 njk + 片段 njk） */
  scanCodes?: string[]
  /** 原子类生成开关；未装 unocss 依赖时自动跳过 */
  unoEnabled?: boolean
}

export interface CssBundle {
  css: string
  warnings: string[]
}

async function unoCss(scanCodes: string[], warnings: string[]): Promise<string> {
  try {
    const { createGenerator } = await import('@unocss/core')
    const { default: presetWind3 } = await import('@unocss/preset-wind3')
    const uno = await createGenerator({ presets: [presetWind3({ preflight: false })] })
    const generated = await uno.generate(scanCodes.join('\n'), { preflights: false })
    return generated.css
  } catch (err) {
    warnings.push(`unocss 原子类生成跳过（依赖未安装或出错）：${(err as Error).message.split('\n')[0]}`)
    return ''
  }
}

/** 按约定顺序汇集 css；external 保留 link 并警告邮件兼容性，local/inline 统一进 <style> */
export async function collectCss(input: CollectCssInput): Promise<CssBundle> {
  const warnings: string[] = []
  const parts: string[] = []

  // 自动注入 ①：normalize.css 框架重置（构建期 ?raw / 运行时回退读取）
  const normalize = normalizeResetCss(warnings)
  if (normalize.trim()) parts.push(normalize)
  // 自动注入 ②：uno 原子类。reset.css（邮件适配增量）等其余 css 一律由 njk 显式 link 解析后进入 sources
  if (input.unoEnabled) {
    const uno = await unoCss(input.scanCodes ?? [], warnings)
    if (uno.trim()) parts.push(uno)
  }

  // 汇集顺序：normalize → uno → local（品牌/模板文件）→ inline（DB / 显式 link 解析内容）
  for (const source of input.sources.filter((s) => s.mode === 'local')) {
    if (!source.file) { warnings.push('local css 缺少文件路径，已跳过'); continue }
    try {
      parts.push(readFileSync(resolveSafe(input.outputRoot, source.file), 'utf8'))
    } catch (err) {
      warnings.push(`local css 读取失败（${source.file}）：${(err as Error).message}`)
    }
  }
  for (const source of input.sources.filter((s) => s.mode === 'external')) {
    warnings.push(`external css（${source.url ?? ''}）在部分邮件客户端会被拦截，建议改为 inline 或 local 后内联`)
  }
  for (const source of input.sources.filter((s) => s.mode === 'inline')) {
    if (source.content?.trim()) parts.push(source.content)
  }
  return { css: parts.join('\n\n'), warnings }
}

/** assembled 阶段注入：<style> 统一提前到 <head> 内，juice 会把它内联到 style 属性（R28） */
export function injectCss(html: string, css: string): string {
  return injectCssIntoHead(html, css)
}
