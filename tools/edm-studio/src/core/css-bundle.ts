import { readFileSync } from 'node:fs'
import { resolveSafe } from '@sshk/repository'
import { injectCssIntoHead } from './css-refs.js'

/**
 * EDM css 汇集（数据契约补记 A/B/C，2026-11-24 用户口径）：
 * 唯一自动注入项是 uno 原子类（扫描参与渲染的 njk 源码动态生成）；
 * 其余一切 css（含 base-reset）必须由 njk 显式 <link> 引入并经 resolveCssBundle 解析后才生效，
 * 不再由本层自动前置/落盘——避免「自动链 + 显式链」两套来源导致的顺序与覆盖不确定。
 * 汇集结果在 assembled 阶段以 <style> 注入 head，再由 juice 统一内联。
 * unocss 依赖未安装时优雅降级为警告，不阻断渲染。
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

  // 唯一自动注入：uno 原子类。base-reset 等其他 css 一律由 njk 显式 link 解析后进入 sources
  if (input.unoEnabled) {
    const uno = await unoCss(input.scanCodes ?? [], warnings)
    if (uno.trim()) parts.push(uno)
  }

  // 汇集顺序：uno → local（品牌/模板文件）→ inline（DB / 显式 link 解析内容）
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
