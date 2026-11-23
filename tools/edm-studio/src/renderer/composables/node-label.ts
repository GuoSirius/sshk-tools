/**
 * 左树标签统一格式（2026-11-23 用户拍板）：真实目录名 +（meta.name）。
 * - meta.name 为空、或与目录名相同 → 只显示目录名，不出现重复括号
 * - 目录名恒为第一段：真实文件系统身份；meta.name 只影响显示，不改路径
 */
export function formatNodeLabel(dirName: string, metaName?: unknown): string {
  const dir = String(dirName ?? '').trim()
  const name = typeof metaName === 'string' ? metaName.trim() : ''
  return name && name !== dir ? `${dir}（${name}）` : dir
}
