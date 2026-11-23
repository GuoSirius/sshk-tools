/**
 * 更新下载进度归一（纯函数，便于单测）：
 * 129MB 安装包在慢速镜像下首分钟常不足 1%，整数取整会让 UI 长期显示 0%——低于 1% 保留一位小数。
 * 非有限值返回 null，由调用方忽略，避免 NaN 污染进度条。
 */
export function normalizeUpdatePercent(raw: number): number | null {
  if (!Number.isFinite(raw)) return null
  if (raw <= 0) return 0
  if (raw < 1) return Math.max(0.1, Math.round(raw * 10) / 10)
  return Math.round(raw)
}
