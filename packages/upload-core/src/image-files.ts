/**
 * 图片文件判定（图床列图 / 富文本图片库用）。
 * 扩展名白名单已统一迁至 @sshk/shared/src/file-kinds.ts（upload-core 与
 * file-picker 弹框共用一份，保持「能传的」与「能列的」口径一致）；本文件保留
 * 图片判定与图库排序两个便捷出口。
 */
import { isKindFileName } from '@sshk/shared'

export function isImageFileName(name: string): boolean {
  return isKindFileName('image', name)
}

/** 图库统一排序：新（修改时间大）在前，时间未知按名称倒序兜底 */
export function byNewestFirst(a: { modified?: number; name: string }, b: { modified?: number; name: string }): number {
  return (b.modified ?? 0) - (a.modified ?? 0) || b.name.localeCompare(a.name)
}
