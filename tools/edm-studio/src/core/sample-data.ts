/**
 * EDM 示例数据解析（#212）：覆盖层 > 版本目录 sample.yaml > {}。
 *
 * 单渲 / 组合预览 / 片段选中模板预览共用同一真相源，保证 njk 里的平铺变量
 * （如 `{{ leftGap }}`）在任意组合关系下都按固定语法生效；片段侧的
 * `{{ template.leftGap }}` 也随之取到模板数据（compose.ts 的 templateCtx）。
 */
import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as yaml from 'js-yaml'

/** 与 SystemSelector 结构兼容的选择器（不 import 以免 core 内部循环依赖） */
export interface EntitySelector {
  brandCode: string
  kind: string
  familyCode: string
  versionDir: string
}

export interface ResolveSampleOptions {
  /** 'system' 才读覆盖层；自定义库无覆盖概念 */
  source?: 'system' | 'custom'
  /** 用户数据覆盖层根 */
  overrideRoot?: string
  /** 调用方已解析好的覆盖数据，优先于一切磁盘读取 */
  sampleOverride?: Record<string, unknown>
}

/** selector → sample.yaml 相对路径（POSIX 分隔，与 ipc/content.ts 原 sampleRelOf 同口径） */
export function sampleRelOf(sel: EntitySelector): string {
  return `${[sel.brandCode, sel.kind, sel.familyCode, sel.versionDir].filter(Boolean).join('/')}/sample.yaml`
}

/** 与 main/sample-overlay.ts 的 overlayAbs 同口径：越权逃出覆盖根返回 null */
function overlayAbs(overlayRoot: string, file: string): string | null {
  const rootAbs = path.resolve(overlayRoot)
  const abs = path.resolve(rootAbs, file)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
  return abs
}

async function readYamlObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const obj = yaml.load(await fs.readFile(file, 'utf8'))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 解析实体示例数据，优先级：显式覆盖对象 > system 覆盖层 sample.yaml > 版本目录 sample.yaml > {}。
 * 覆盖层解析失败（越权/缺文件/YAML 非法）静默回落版本目录，不阻塞预览。
 */
export async function resolveEntitySample(
  root: string,
  sel: EntitySelector,
  opts: ResolveSampleOptions = {},
): Promise<Record<string, unknown>> {
  if (opts.sampleOverride) return opts.sampleOverride
  if (opts.source === 'system' && opts.overrideRoot) {
    const abs = overlayAbs(opts.overrideRoot, sampleRelOf(sel))
    if (abs) {
      const over = await readYamlObject(abs)
      if (over) return over
    }
  }
  return (await readYamlObject(path.join(root, sampleRelOf(sel)))) ?? {}
}
