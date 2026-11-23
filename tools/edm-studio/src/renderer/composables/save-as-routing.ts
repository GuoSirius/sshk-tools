import type { NodeKind, Source } from './useContentTree'

/**
 * 另存为路由口径（纯函数，便于回归）：
 * - 只有实体（品牌/族/版本）system→custom 才走 system:derive 整棵派生；
 * - css 目录/文件无论源与目标根如何组合，一律逐文件拷贝——css 不属于品牌模型，
 *   旧实现把它送进 derive 会拿不到 brandCode，报「系统品牌「」不存在」。
 * - 是否允许另存为只看**目标根**的编辑权（系统根 dev 门控 / 自定义恒可写），源只读不影响复制。
 */

export function isEntityKind(kind: NodeKind | string): boolean {
  return kind === 'brand' || kind === 'family' || kind === 'version'
}

/** 是否走 system:derive 派生通道 */
export function shouldDerive(fromSource: Source, origin: Source, kind: NodeKind | string): boolean {
  return fromSource === 'system' && origin === 'custom' && isEntityKind(kind)
}

/** 默认新名称：css 文件保持 .css 后缀（foo.css → foo-copy.css），其余沿用 <末段>-copy */
export function defaultSaveAsName(kind: NodeKind | string, p: string): string {
  const base = p.split(/[/\\]/).filter(Boolean).pop() ?? p
  if (kind !== 'cssFile') return `${base}-copy`
  return `${base.replace(/\.css$/i, '')}-copy.css`
}

/** 切换目标根后，旧目标路径若不在新候选集中则回落到首个候选 */
export function pickValidTarget(target: string, candidates: string[]): string {
  return candidates.includes(target) ? target : (candidates[0] ?? '')
}
