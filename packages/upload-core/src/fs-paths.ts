/**
 * 文件系统路径工具（X6）：通道根相对路径的规范化与安全校验。
 * main 侧所有 fs 操作入参必须先过 normalizeRootRel —— `..`、反斜杠、控制字符一律拒绝（§六 路径安全）。
 */

/** 断言并规范化通道根相对路径：返回 '' 表示根；非法输入直接抛错（越权拒绝） */
export function normalizeRootRel(raw: string): string {
  const s = String(raw ?? '')
  if (/[\u0000-\u001f]/.test(s)) throw new Error('路径含非法控制字符')
  if (s.includes('\\')) throw new Error('路径不允许包含反斜杠')
  const parts = s.split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new Error('路径不允许包含 . / ..（越出通道根）')
  return parts.join('/')
}

/** 目录路径下拼子段：根（''）时不带前导斜杠 */
export function fsJoin(dir: string, name: string): string {
  const base = normalizeRootRel(dir)
  const seg = String(name ?? '').trim()
  if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) {
    throw new Error(`非法路径段：${seg}`)
  }
  return base ? `${base}/${seg}` : seg
}

/** 父目录路径；根返回 '' */
export function fsParent(path: string): string {
  const p = normalizeRootRel(path)
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** 最后一段名称；根返回 '' */
export function fsBasename(path: string): string {
  const p = normalizeRootRel(path)
  return p.slice(p.lastIndexOf('/') + 1)
}

/** 移动/复制到新目录后的目标完整路径（保留原文件名） */
export function fsDestPath(destDir: string, srcPath: string): string {
  return fsJoin(destDir, fsBasename(srcPath))
}

/** 云对象 key：目录语义带尾斜杠（marker 对象）；文件不加 */
export function cloudKey(path: string, kind: 'dir' | 'file'): string {
  const p = normalizeRootRel(path)
  if (!p) return ''
  return kind === 'dir' ? `${p}/` : p
}
