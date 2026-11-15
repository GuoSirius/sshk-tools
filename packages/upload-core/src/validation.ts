import type { UploadFile, UploadValidation } from './types'

export const DEFAULT_VALIDATION: Required<UploadValidation> = { accept: [], maxSize: 0 }

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

/**
 * 全局默认 + 工具可收紧：
 * - 扩展名取交集（全局为空=不限制时，工具可自行设限；工具未设则沿用全局）
 * - 大小上限取更小值（0 视为不限制）
 * 任何情况下工具都不能放宽全局规则。
 */
export function mergeValidation(
  global: UploadValidation,
  tool?: UploadValidation,
): Required<UploadValidation> {
  const gAccept = (global.accept ?? []).map((e) => e.toLowerCase())
  const tAccept = tool?.accept?.map((e) => e.toLowerCase())
  const accept = tAccept
    ? (gAccept.length === 0 ? tAccept : gAccept.filter((e) => tAccept.includes(e)))
    : gAccept

  const gSize = global.maxSize ?? 0
  const tSize = tool?.maxSize ?? 0
  const maxSize = tSize > 0 ? (gSize > 0 ? Math.min(gSize, tSize) : tSize) : gSize

  return { accept: [...new Set(accept)], maxSize }
}

export interface ValidationFailure { ok: false; reason: string }
export interface ValidationSuccess { ok: true }
export type ValidationOutcome = ValidationFailure | ValidationSuccess

export function validateFile(file: UploadFile, rule: Required<UploadValidation>): ValidationOutcome {
  const ext = extOf(file.name)
  if (rule.accept.length > 0 && !rule.accept.includes(ext)) {
    return { ok: false, reason: `文件类型不允许：${ext || '(无扩展名)'}，仅允许 ${rule.accept.join(', ')}` }
  }
  if (rule.maxSize > 0 && file.size > rule.maxSize) {
    return { ok: false, reason: `文件超过大小上限：${file.size} > ${rule.maxSize} 字节` }
  }
  return { ok: true }
}
