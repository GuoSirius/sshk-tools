/**
 * favicon 继承链（2026-11-23 定版）：版本 → 族 → 类型 → 品牌。
 * 只算「继承值」——自身 favicon 优先（由 meta-contract.resolveFavicon 处理），
 * 这里给出当前节点在自身为空时应该回退的上一级有效值。
 */
import { resolveFavicon } from '../../core/meta-contract'
import type { NodeKind } from './useContentTree'

export interface FaviconChain {
  brand?: string
  category?: string
  family?: string
}

export function inheritedFavicon(kind: NodeKind, chain: FaviconChain): string {
  const brand = chain.brand ?? ''
  if (kind === 'category') return brand
  if (kind === 'family') return resolveFavicon(chain.category, brand)
  if (kind === 'version') return resolveFavicon(chain.family, resolveFavicon(chain.category, brand))
  return ''
}
