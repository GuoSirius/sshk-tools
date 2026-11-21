/**
 * 文件卡片展示小工具（P6-3 自 FilePickerDialog 拆出）：
 * 扩展名解析与字节简短中文展示，上传池（大小拦截文案）与缩略网格（文件卡）共用。
 */

/** 文件扩展名（小写、含点；无扩展名返回空串） */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** 字节数的简短中文展示（文件卡片用） */
export function formatSize(size?: number): string {
  if (!size || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = size
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]!}`
}
