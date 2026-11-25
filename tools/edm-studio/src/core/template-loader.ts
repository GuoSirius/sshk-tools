/**
 * Nunjucks 模板 loader（2026-11-25 需求 2：extends / include / import）：
 * 复用 CSS 逻辑 URI 同一套前缀语义，让用户心智一致：
 *   @system/…  系统资产根
 *   @custom/…  自定义资产根
 *   @root/…    当前来源根（系统/自定义自动判断）
 *   ./…        当前版本目录（允许 ../ 上溯，兜底限来源根内）
 * 无落盘路径的模板（DB 字符串源码）注册进内存表，磁盘优先、内存回落（Q2 已拍板）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type nunjucks from 'nunjucks'

export interface TemplateRoots {
  systemRoot: string
  customRoot: string
  sourceRoot: string
  /** 当前模板所在版本目录（./ 与裸路径基准） */
  versionDir: string
}

/** 内存模板表：name → njk 源码（磁盘无落盘路径时的回落，Q2） */
export type MemoryTemplates = Map<string, string>

const MEM_PREFIX = '@mem/'

/**
 * 逻辑模板名 → 绝对路径；越出对应根拒绝（防目录穿越），外链一律拒绝。
 * 与 css-refs.resolveCssRef 同口径：允许 .. 上溯，normalize 后兜底限根。
 */
export function resolveTemplatePath(name: string, roots: TemplateRoots): string | null {
  const n = name.trim()
  if (/^(https?:|data:|file:)/i.test(n)) return null
  const pick = (base: string, rest: string, scope: string, guardRoot = base): string => {
    const resolved = path.resolve(path.resolve(base), rest.replace(/^\/+/, ''))
    const root = path.resolve(guardRoot)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`模板引用越出 ${scope} 根：${name}`)
    }
    return resolved
  }
  if (n.startsWith('@system/')) return pick(roots.systemRoot, n.slice('@system/'.length), '@system')
  if (n.startsWith('@custom/')) return pick(roots.customRoot, n.slice('@custom/'.length), '@custom')
  if (n.startsWith('@root/')) return pick(roots.sourceRoot, n.slice('@root/'.length), '@root')
  return pick(roots.versionDir, n.replace(/^\.\//, ''), '@root', roots.sourceRoot)
}

/** 磁盘优先 + 内存回落的 nunjucks Loader（getSource 同步，符合 nunjucks Loader 契约） */
export class TemplateLoader implements nunjucks.ILoader {
  constructor(
    private readonly roots: TemplateRoots,
    private readonly memory: MemoryTemplates = new Map(),
  ) {}

  getSource(name: string): { src: string; path: string; noCache: boolean } {
    // 内存模板显式优先命中（@mem/xxx 或注册名）
    const memKey = name.startsWith(MEM_PREFIX) ? name.slice(MEM_PREFIX.length) : name
    const mem = this.memory.get(memKey)
    if (mem !== undefined) return { src: mem, path: `${MEM_PREFIX}${memKey}`, noCache: true }
    try {
      const abs = resolveTemplatePath(name, this.roots)
      if (abs && existsSync(abs)) return { src: readFileSync(abs, 'utf8'), path: abs, noCache: true }
    } catch {
      // 越权路径按找不到处理（nunjucks Loader 契约：找不到抛错，不返回 null）
    }
    throw new Error(`Template not found: ${name}`)
  }
}

/** 生成一个内存模板注册名（与主模板 sourcePath 区分，避免磁盘路径冲突） */
export function memTemplateName(key: string): string {
  return `${MEM_PREFIX}${key}`
}
