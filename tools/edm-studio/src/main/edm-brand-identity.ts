/**
 * 统一品牌身份（2026-11-23 方案 B）：跨根同目录名品牌合并为同一 brandId。
 *
 * 旧：系统 `brd_sys_<code>` / 自定义 `cus_brd_<code>` 两个 ID → 候选片段按 brandId
 * 硬过滤，自定义补的同名品牌片段用不上系统模板。新：统一 `brd_<code>`；
 * 族/版本仍保留来源前缀 ID（避免双根同路径冲突），只把 brandId 指向统一品牌，
 * 于是系统模板 + 自定义片段天然互通，邮件编辑器无需改动。
 *
 * 迁移幂等：启动时在两次播种之前跑；旧 cus_brd_* 品牌并入已存在的系统品牌时
 * 保留系统品牌的 origin/name，只把引用（含已归档实体）改指过去。
 */
import type { BaseEntity, Brand, Repository } from '@sshk/repository'

export const unifiedBrandId = (code: string): string => `brd_${code}`

const LEGACY_PREFIX = 'cus_brd_'
/** 仅需迁移 brandId 的引用文档（不改其余字段） */
interface BrandRef extends BaseEntity { brandId: string }
/** 持有 brandId 引用的集合（含 mails，历史邮件选过的品牌也要跟过来） */
const REF_COLLECTIONS = ['fragments', 'templates', 'fragmentVersions', 'templateVersions', 'mails'] as const

export async function migrateBrandIdentity(repo: Repository): Promise<{ merged: number }> {
  const legacy = await repo.list<Brand>('brands', { origin: 'custom' })
  let merged = 0
  for (const old of legacy) {
    if (!old._id?.startsWith(LEGACY_PREFIX)) continue
    const code = old.code || old._id.slice(LEGACY_PREFIX.length)
    const targetId = unifiedBrandId(code)
    if (targetId === old._id) continue
    if (!(await repo.get<Brand>('brands', targetId))) {
      // 纯自定义品牌（系统没有同名）→ 保留原品牌文档内容，只换 ID
      const { _id, createdAt, updatedAt, archived, ...rest } = old
      await repo.insert<Brand>('brands', { ...rest, _id: targetId })
    }
    for (const coll of REF_COLLECTIONS) {
      const rows = await repo.list<BrandRef>(coll, { brandId: old._id })
      for (const row of rows) await repo.update<BrandRef>(coll, row._id, { brandId: targetId })
    }
    await repo.remove('brands', old._id)
    merged++
  }
  return { merged }
}
