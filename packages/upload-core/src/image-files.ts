/**
 * 图片文件判定（图床列图 / 富文本图片库用）。
 * 三类 Provider 共用一份扩展名白名单，保持「能传的」与「能列的」口径一致。
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif'])

export function isImageFileName(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i > 0 && IMAGE_EXTS.has(name.slice(i).toLowerCase())
}

/** 图库统一排序：新（修改时间大）在前，时间未知按名称倒序兜底 */
export function byNewestFirst(a: { modified?: number; name: string }, b: { modified?: number; name: string }): number {
  return (b.modified ?? 0) - (a.modified ?? 0) || b.name.localeCompare(a.name)
}
