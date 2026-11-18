/**
 * 文件系统路径工具（X6）：通道根相对路径的规范化与安全校验。
 *
 * 路径契约（2026-11-18 用户拍板彻底根治）：
 * - **内部规范形式 = `/a/b/c`（开头带 /，结尾不带）；根 = `/`**。
 *   所有驱动、main、UI 之间传递的 FsEntry.path / path / destDir 一律用此形式。
 * - 输入兼容：`''`、`'/'`、`'a/b'`、`'/a/b/'` 都接受，normalizeRootRel 统一输出规范形式。
 *   这样用户手输少写开头 / 不会出错（体验），而存储/比较只有一种形式（不留歧义）。
 * - 边界剥离：本地绝对路径、云 SDK object key 不带前导 /，由 abs()/cloudKey() 在边界 strip。
 * - `..`、反斜杠、控制字符一律拒绝（§六 路径安全）。
 */

/** 断言并规范化通道根相对路径：输出 `/a/b/c`，根输出 `/`；非法输入直接抛错（越权拒绝） */
export function normalizeRootRel(raw: string): string {
  const s = String(raw ?? '')
  if (/[\u0000-\u001f]/.test(s)) throw new Error('路径含非法控制字符')
  if (s.includes('\\')) throw new Error('路径不允许包含反斜杠')
  const parts = s.split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new Error('路径不允许包含 . / ..（越出通道根）')
  return `/${parts.join('/')}`
}

/** 目录路径下拼子段：根（`/`）时输出 `/name` */
export function fsJoin(dir: string, name: string): string {
  const base = normalizeRootRel(dir)
  const seg = String(name ?? '').trim()
  if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) {
    throw new Error(`非法路径段：${seg}`)
  }
  return base === '/' ? `/${seg}` : `${base}/${seg}`
}

/** 父目录路径；根返回 `/` */
export function fsParent(path: string): string {
  const p = normalizeRootRel(path)
  if (p === '/') return '/'
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** 最后一段名称；根返回 '' */
export function fsBasename(path: string): string {
  const p = normalizeRootRel(path)
  return p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1)
}

/** 移动/复制到新目录后的目标完整路径（保留原文件名） */
export function fsDestPath(destDir: string, srcPath: string): string {
  const name = fsBasename(srcPath)
  if (!name) throw new Error('源路径不是文件')
  return fsJoin(destDir, name)
}

/** 云对象 key（SDK 侧不带前导斜杠）：目录语义带尾斜杠（marker 对象）；文件不加；根返回 '' */
export function cloudKey(path: string, kind: 'dir' | 'file'): string {
  const p = normalizeRootRel(path)
  if (p === '/') return ''
  const rel = p.slice(1) // 去掉内部规范的前导 /
  return kind === 'dir' ? `${rel}/` : rel
}
