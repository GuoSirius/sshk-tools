/**
 * 渲染上下文元数据契约（2026-11-25「Nunjucks 数据继承」修订 13）：
 * - 四级 meta（品牌 / 类型 / 族 / 版本）以 meta.* 命名空间注入 njk，不与 data 平铺混用
 * - favicon 按继承链解析：版本 → 族 → 类型 → 品牌（自身有值优先）
 * - 片段渲染时模板 ctx 整体挂 template.*（含模板 data + 模板 meta），不与片段自身字段合并覆盖
 * 本模块为纯函数（无 fs），主进程按内容路径反查 meta.yaml 后构造 RenderMeta 传入渲染层。
 */
import { resolveFavicon } from './meta-contract.js'

/** 单级元数据（四级同构：code / name 必填，favicon 可继承） */
export interface RenderMetaLevel {
  code: string
  name: string
  favicon?: string
}

/** 四级渲染元数据 + 继承链解析后的最终 favicon */
export interface RenderMeta {
  brand?: RenderMetaLevel
  type?: RenderMetaLevel
  family?: RenderMetaLevel
  version?: RenderMetaLevel
  /** 解析后的最终 favicon（模板写 {{ meta.favicon }}）；空值不出空 link */
  favicon?: string
}

export const EMPTY_RENDER_META: Readonly<RenderMeta> = {}

/**
 * 构造注入 njk 的 meta 对象：四级原样保留 + 顶层 favicon 走继承链解析。
 * favicon 恒产出字符串键（可能为空串），便于 strict 模式 `{{ meta.favicon }}` 不抛错，
 * 模板侧用 `{% if meta.favicon %}` 守卫即不会渲染空 link。
 */
export function buildRenderMeta(meta: RenderMeta = EMPTY_RENDER_META): RenderMeta {
  const favicon = resolveFavicon(
    meta.version?.favicon,
    resolveFavicon(meta.family?.favicon, resolveFavicon(meta.type?.favicon, meta.brand?.favicon ?? '')),
  )
  return { ...meta, favicon }
}
