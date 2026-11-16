/**
 * file:// 预览显示转换（用户反馈 2026-11-16：本地上传 profile 回填 file:// URL，
 * Chromium 禁止 http 页面加载本地资源，预览全部裂图）。
 *
 * 存储契约保持 file://（本地产物有效）；仅【渲染显示】把 file:/// 换成 localres:///
 * ——主进程 local-res.ts 白名单放行上传目录内的图片。转换必须双向对称：
 * 显示前 toDisplayHtml / toDisplaySrc，回写存储前 toStoredHtml。
 */
export const FILE_URL_PREFIX = 'file:///'
export const LOCAL_RES_PREFIX = 'localres:///'

/** 整段 HTML：存储 → 显示（编辑器 setHtml 前调用） */
export function toDisplayHtml(html: string): string {
  return html.replaceAll(FILE_URL_PREFIX, LOCAL_RES_PREFIX)
}

/** 整段 HTML：显示 → 存储（编辑器 onChange 回写前调用） */
export function toStoredHtml(html: string): string {
  return html.replaceAll(LOCAL_RES_PREFIX, FILE_URL_PREFIX)
}

/** 单个 src：存储 → 显示（el-image 等 <img> 场景） */
export function toDisplaySrc(src: string): string {
  return src?.startsWith(FILE_URL_PREFIX) ? LOCAL_RES_PREFIX + src.slice(FILE_URL_PREFIX.length) : src
}
