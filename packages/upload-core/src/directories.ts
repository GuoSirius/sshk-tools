/**
 * 真实目录列举的共享工具（富文本图片库下拉用）。
 *
 * 与「从图片 key 反推目录」不同，对象存储的目录是 prefix + delimiter 列出来的
 * CommonPrefixes，本地/远程是文件系统里真实的 isDirectory 条目。各家 SDK 返回
 * 结构差异很大，这里做深度兜底解析，避免逐家写死猜错层级。
 */

/** 目录数量上限：防止超大 bucket 一次列爆弹窗（与 rich-text FETCH_LIMIT 同量级） */
export const MAX_DIRECTORIES = 500
/** 递归列图的文件数上限：超出后停止下钻（分页游标基于本次收集结果） */
export const MAX_LIST_FILES = 10_000
/** 远程递归列图的时间预算（毫秒）：超时先返回已收集的部分结果，避免用户干等 */
export const LIST_BUDGET_MS = 12_000
/** 递归列图的深度上限：目录树过深对体验无益，且放大请求数 */
export const MAX_LIST_DEPTH = 6

/** 统一斜杠、去首尾斜杠、压掉空段；返回 '' 表示根 */
export function normalizeDirPath(raw: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
}

/**
 * 从对象存储 delimiter 列目录的原始响应里抽取所有前缀。
 * 兼容三种形态：字符串数组 `prefixes`、对象数组 `CommonPrefixes:[{Prefix}]`、
 * 以及 Azure 的 `blobPrefixes:[{name}]`；并向下递归找嵌套层（如 OBS 的 InterfaceResult）。
 */
export function collectPrefixes(res: unknown, depth = 0): string[] {
  if (!res || typeof res !== 'object' || depth > 4) return []
  const r = res as Record<string, unknown>
  const out: string[] = []

  const strArray = r['prefixes'] ?? r['Prefixes']
  if (Array.isArray(strArray)) {
    for (const x of strArray) if (typeof x === 'string' && x) out.push(x)
  }
  for (const key of ['CommonPrefixes', 'commonPrefixes', 'blobPrefixes', 'Prefixes']) {
    const v = r[key]
    if (!Array.isArray(v)) continue
    for (const item of v) {
      if (typeof item === 'string' && item) out.push(item)
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        const name = o['Prefix'] ?? o['prefix'] ?? o['name'] ?? o['Name']
        if (typeof name === 'string' && name) out.push(name)
      }
    }
  }
  if (out.length) return [...new Set(out)]

  for (const v of Object.values(r)) {
    const found = collectPrefixes(v, depth + 1)
    if (found.length) return found
  }
  return []
}
