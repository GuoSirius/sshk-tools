/**
 * R19 统一组合引擎：模板 + 片段摆放（placements）+ 数据 + css 链 → 三阶段产物。
 * system:render（预览）与 mail:generate（生成）共用，杜绝两套渲染逻辑（Q15）。
 * 区块契约（B1/Q11）：模板族 meta `slots:` 声明区块清单；模板 njk 内 `{{ slot_<key> | safe }}` 引用；
 * 同区块多 placement 按 order 排序拼接、repeat>1 重复追加（兼容数据契约 §7 的 slot_* 变量注入，
 * 现有模板资产 njk 零改动）。
 * 2026-11-25 修订 1/13：模板/片段四级 meta 分别注入 meta.*；片段渲染时模板 ctx 整体挂 template.*
 * （不合并覆盖片段字段），未传模板 ctx 则片段独立渲染照常。
 */
import { buildRenderMeta, EMPTY_RENDER_META, type RenderMeta } from './render-meta.js'
import { renderFragmentHtml, renderMail, type RenderStages } from './render.js'
import type { TemplateRoots, MemoryTemplates } from './template-loader.js'
import { collectCss, type CssSource } from './css-bundle.js'

export interface ComposePlacement {
  /** 片段 njk 源码 */
  html: string
  /** 片段 css 内容（inline；空跳过） */
  css?: string
  /** 该 placement 独立数据（缺省回落 input.data） */
  data?: Record<string, unknown>
  /** 片段四级元数据（修订 1/13：注入片段 ctx 的 meta.*） */
  meta?: RenderMeta
  /** 区块 key（模板 slots 声明） */
  slot: string
  /** 同区块内顺序，缺省按传入顺序 */
  order?: number
  /** 重复次数（≥1，缺省 1） */
  repeat?: number
}

export interface ComposeInput {
  templateHtml: string
  templateCss?: string
  placements: ComposePlacement[]
  /** 模板级数据（placement 未带 data 时回落） */
  data: Record<string, unknown>
  /** 模板四级元数据（注入 meta.*，并作为片段 template.meta.*） */
  meta?: RenderMeta
  /** 片段渲染 strict（缺字段抛错）；预览 false 容错、生成 true */
  strict?: boolean
  unoEnabled?: boolean
  /** 产物根（normalize + uno 框架自动注入汇集）；缺省纯拼接 css 不扫原子类 */
  outputRoot?: string
  /** 已由 resolveCssBundle 解析好的完整 css（含框架自动注入 + 显式 link css）；传入时跳过本层汇集，避免重复 */
  resolvedCss?: string
  /** 模板引用解析根（需求 2：extends/include/import） */
  roots?: TemplateRoots
  /** 内存模板表（DB 字符串源码注册；磁盘优先、内存回落） */
  memoryTemplates?: MemoryTemplates
  /** 落盘模板名（磁盘优先；提供时 renderMail 走 env.render） */
  templateName?: string
}

export interface ComposeResult extends RenderStages {
  /** slot → 拼接后 HTML（单测断言 / 调试用） */
  bindings: Record<string, string>
}

/** placements → slot_* 绑定：分组 → 排序 → repeat 展开 → 拼接 */
export function buildBindings(
  placements: ComposePlacement[],
  fallback: Record<string, unknown>,
  strict: boolean,
  templateCtx?: Record<string, unknown>,
): Record<string, string> {
  const grouped = new Map<string, { order: number; html: string }[]>()
  placements.forEach((p, i) => {
    if (!p.slot || !p.html.trim()) return
    const repeat = Math.max(1, Math.floor(p.repeat ?? 1))
    const html = renderFragmentHtml({
      html: p.html,
      data: p.data ?? fallback,
      meta: p.meta ?? EMPTY_RENDER_META,
      templateCtx,
      render: { strict, autoEscape: true },
    })
    const list = grouped.get(p.slot) ?? []
    for (let r = 0; r < repeat; r++) list.push({ order: p.order ?? i, html })
    grouped.set(p.slot, list)
  })
  const out: Record<string, string> = {}
  for (const [slot, list] of grouped) {
    list.sort((a, b) => a.order - b.order)
    out[slot] = list.map((x) => x.html).join('\n')
  }
  return out
}

/** 组合渲染主入口：placements → slot 绑定 → css 汇集 → njk → juice → minify */
export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const strict = input.strict ?? true
  const templateMeta = buildRenderMeta(input.meta ?? EMPTY_RENDER_META)
  // 模板 ctx = 模板 data 平铺 + meta.*；片段整份挂 template.*，不合并覆盖片段自身字段
  const templateCtx: Record<string, unknown> = { ...input.data, meta: templateMeta }
  const bindings = buildBindings(input.placements, input.data, strict, templateCtx)

  const cssSources: CssSource[] = []
  const scanCodes = [input.templateHtml]
  if (input.templateCss?.trim()) cssSources.push({ mode: 'inline', content: input.templateCss })
  for (const p of input.placements) {
    if (!p.html.trim()) continue
    scanCodes.push(p.html)
    if (p.css?.trim()) cssSources.push({ mode: 'inline', content: p.css })
  }

  let cssBundle = input.resolvedCss ?? cssSources.map((s) => s.content ?? '').join('\n\n')
  if (input.resolvedCss === undefined && input.outputRoot) {
    const bundle = await collectCss({
      outputRoot: input.outputRoot,
      sources: cssSources,
      scanCodes,
      unoEnabled: input.unoEnabled ?? true,
    })
    for (const w of bundle.warnings) console.warn(`[edm] css 汇集警告：${w}`)
    cssBundle = bundle.css
  }

  const stages = await renderMail({
    templateHtml: input.templateHtml,
    bindings,
    data: input.data,
    meta: templateMeta,
    render: { strict, autoEscape: true },
    cssBundle,
    roots: input.roots,
    memoryTemplates: input.memoryTemplates,
    templateName: input.templateName,
  })
  return { ...stages, bindings }
}
