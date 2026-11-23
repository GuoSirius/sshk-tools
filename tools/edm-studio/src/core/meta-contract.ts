/**
 * EDM 元数据统一契约（2026-11-23 用户拍板）：
 * - 品牌 / 类型 / 族 / 版本四级元数据一律有 code、name（必填）与 favicon（可继承）
 * - code 当前 = 真实目录名的只读镜像；保留 META_CODE_MODE 单点开关，后续要独立编辑成业务编码
 *   只需把模式切到 independent（数据层、后端校验均已按可独立值设计），无需再改调用方
 * - favicon 允许所有能当图标的图片类型（复用 shared 的 IMAGE_EXTS，含 ico/png/svg/webp/avif…）
 * - 品牌旧 logo 字段不做兼容，直接丢弃（读取、表单、schema 都不再出现）
 */
import { IMAGE_EXTS } from '@sshk/shared'

export type MetaCodeMode = 'mirror' | 'independent'

/** 单点开关：未来开放业务编码独立编辑时改这里（同步调整 rename 时的 code 自动写入策略） */
export const META_CODE_MODE: MetaCodeMode = 'mirror'

/** 所有可作为 favicon 的扩展名（与上传图片库白名单同源，避免两处漂移） */
export const FAVICON_EXTS: readonly string[] = IMAGE_EXTS

/** code 取值：mirror=目录名；independent=meta 里的业务编码（空则回落目录名） */
export function resolveMetaCode(dirName: string, metaCode?: unknown, mode: MetaCodeMode = META_CODE_MODE): string {
  if (mode === 'mirror') return dirName
  return typeof metaCode === 'string' && metaCode.trim() ? metaCode.trim() : dirName
}

/** 表单 code 控件是否只读（只受单点开关控制） */
export function isCodeReadonly(mode: MetaCodeMode = META_CODE_MODE): boolean {
  return mode === 'mirror'
}

/** 四级元数据必填校验（前端表单 + 后端 IPC 共用同一份口径） */
export function validateMetaIdentity(data: unknown): string[] {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const errors: string[] = []
  if (typeof obj['code'] !== 'string' || !obj['code'].trim()) errors.push('code 必填')
  if (typeof obj['name'] !== 'string' || !obj['name'].trim()) errors.push('name 必填')
  return errors
}

/** favicon 继承：版本 → 族 → 类型 → 品牌；自身有值优先，否则回退上级 */
export function resolveFavicon(own: unknown, parentFavicon = ''): string {
  return typeof own === 'string' && own.trim() ? own.trim() : parentFavicon
}
