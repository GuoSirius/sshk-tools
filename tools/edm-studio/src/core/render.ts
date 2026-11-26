import nunjucks from 'nunjucks'
import juice from 'juice'
import { EDM_JUICE_OPTIONS } from './juice-options.js'
import { htmlMinify } from './minify.js'
import { createHash } from 'node:crypto'
import { injectCss } from './css-bundle.js'
import { buildRenderMeta, EMPTY_RENDER_META, type RenderMeta } from './render-meta.js'
import { TemplateLoader, type TemplateRoots, type MemoryTemplates } from './template-loader.js'

export interface RenderInput {
  /** 模板版本 njk 源码（无落盘路径时直接用它 renderString；磁盘优先时仅作回落） */
  templateHtml: string
  /** 槽位绑定：slot key → 片段版本渲染产物（已渲染 HTML 字符串） */
  bindings: Record<string, string>
  data: Record<string, unknown>
  render: { strict: boolean; autoEscape: boolean }
  /** 已汇集的 css（uno → 显式 link 解析内容，css-bundle.collectCss）；空则跳过注入 */
  cssBundle?: string
  /** 模板四级元数据（2026-11-25 修订 1/13）：注入 meta.* 命名空间 + meta.favicon */
  meta?: RenderMeta
  /** 模板引用解析根（需求 2）：提供时挂 loader，模板内 extends/include/import 可走逻辑 URI */
  roots?: TemplateRoots
  /** 内存模板表（DB 字符串源码注册；磁盘优先、内存回落 Q2） */
  memoryTemplates?: MemoryTemplates
  /** 落盘模板名（磁盘优先）：提供时用 env.render(name) 走 loader，否则 renderString(templateHtml) */
  templateName?: string
}

export interface RenderStages {
  /** 组装好的模板源码（模板 + 片段源码按 slot 拼接、未渲染；Q4 保留 njk 变量原样） */
  assembledTemplate?: string
  assembled: string
  inlined: string
  final: string
  sourceHash: string
}

/** 每次渲染创建独立 Environment（消除 nunjucks.configure 全局单例的并发串扰隐患） */
function makeEnv(strict: boolean, autoEscape: boolean, loader?: nunjucks.ILoader): nunjucks.Environment {
  return new nunjucks.Environment(loader, { throwOnUndefined: strict, autoescape: autoEscape })
}

/**
 * 三阶段渲染（需求 17 / 数据契约 §7）：
 * ① assembled：nunjucks 渲染（槽位以声明式变量注入，片段产物作为已渲染 HTML 传入）
 * ② inlined：juice CSS 内联（邮件客户端兼容）
 * ③ final：html-minifier-terser 压缩 → 复制代码 / 分享链接指向它
 * 数据注入（修订 1/13）：data 字段平铺兼容存量 + meta.* 命名空间；ctx 允许含 slot_* HTML 字符串（方案 A 已敲定）
 */
export async function renderMail(input: RenderInput): Promise<RenderStages> {
  const context = {
    ...input.data,
    meta: buildRenderMeta(input.meta ?? EMPTY_RENDER_META),
    ...Object.fromEntries(Object.entries(input.bindings).map(([k, v]) => [`slot_${k}`, v])),
  }
  // 需求 2：有 roots 时挂 loader（extends/include/import 可解析）；有 templateName 走磁盘优先，否则字符串回落
  const loader = input.roots ? new TemplateLoader(input.roots, input.memoryTemplates) : undefined
  const env = makeEnv(input.render.strict, input.render.autoEscape, loader)
  const rendered = loader && input.templateName
    ? env.render(input.templateName, context)
    : env.renderString(input.templateHtml, context)
  // css 汇集结果放最前，juice 的 applyStyleTags 会把它内联到 style 属性
  const assembled = injectCss(rendered, input.cssBundle ?? '')

  // 全套邮件兼容选项见 juice-options.ts（对齐 juice-email-cli 默认配置，静态打进 exe）
  const inlined = juice(assembled, EDM_JUICE_OPTIONS)
  const final = await htmlMinify(inlined)
  return {
    assembled,
    inlined,
    final,
    sourceHash: `sha256:${createHash('sha256').update(final, 'utf8').digest('hex')}`,
  }
}

export interface RenderFragmentInput {
  /** 片段 njk 源码 */
  html: string
  /** 片段自身数据（平铺 + meta.*） */
  data: Record<string, unknown>
  /** 片段四级元数据 */
  meta?: RenderMeta
  /** 宿主模板 ctx，整体挂 template.*（不合并覆盖片段字段）；片段独立开发/预览时省略 */
  templateCtx?: Record<string, unknown>
  render: { strict: boolean; autoEscape: boolean }
}

/**
 * 片段版本渲染：片段 njk + 自己的数据（+ 可选模板 ctx） → HTML（供槽位绑定）。
 * ctx 结构（修订 13）：片段自身 data 平铺 + meta.* + template.*（模板 ctx 整体挂此命名空间）；
 * 模板 ctx 与片段字段不在同一层，不存在同名覆盖（Q7 规则自然消解）。
 */
export function renderFragmentHtml(input: RenderFragmentInput): string {
  const env = makeEnv(input.render.strict, input.render.autoEscape)
  const ctx: Record<string, unknown> = {
    ...input.data,
    meta: buildRenderMeta(input.meta ?? EMPTY_RENDER_META),
  }
  // 未选模板（片段独立开发/预览）时 template=null：nunjucks 中空对象 {} 为 truthy 会让守卫失效，
  // 必须用 null 使 {% if template %} 为假；有模板时整体挂模板 ctx（不合并覆盖片段字段）
  ctx.template = input.templateCtx ?? null
  return env.renderString(input.html, ctx)
}

/** 兼容旧签名：片段 njk + 数据 → HTML（不注入 meta/template，供既有调用点使用） */
export function renderFragment(fragmentHtml: string, data: Record<string, unknown>): string {
  return renderFragmentHtml({ html: fragmentHtml, data, render: { strict: false, autoEscape: true } })
}
