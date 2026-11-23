import os from 'node:os'
import path from 'node:path'
import { TOOL_IDS } from '@sshk/shared'
import { normalizeUploadConfig, resolveUploadTool } from '@sshk/upload-core/types'

/**
 * localres:// 白名单纯逻辑（无 electron 依赖，供单测）：
 * 允许根 = 全局本地上传目录 + 各工具 localDir 覆盖 + 媒体临时目录（readMedia 下载落点）；
 * 仅放行图片/音视频扩展名，防目录遍历/任意读。
 */
export const RES_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  // 音视频（readMedia 流式落盘到媒体临时目录，localres 回放；Range 由 local-res.ts 处理）
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
}

/** 媒体临时目录（fs.readMedia 下载落点）：精确固定到这一个子目录，不放行整个 tmp */
export const MEDIA_TMP_DIR = path.resolve(os.tmpdir(), 'sshk-media')

interface ConfigLike {
  get(key: string): unknown
}

export function collectResRoots(config: ConfigLike): string[] {
  const roots: string[] = [MEDIA_TMP_DIR]
  try {
    const cfg = normalizeUploadConfig(config.get('app.upload'))
    if (cfg.local.defaultDir) roots.push(path.resolve(cfg.local.defaultDir))
  } catch {
    // 配置缺失/损坏时忽略，剩余根目录继续生效
  }
  for (const id of Object.values(TOOL_IDS)) {
    try {
      const tool = resolveUploadTool(config.get(`tools.${id}.upload`))
      if (tool.overrides.localDir) roots.push(path.resolve(tool.overrides.localDir))
    } catch {
      // 工具未配置上传通道时忽略
    }
  }
  return [...new Set(roots)]
}

export function isAllowedResPath(p: string, roots: string[]): boolean {
  if (!RES_MIME_BY_EXT[path.extname(p).toLowerCase()]) return false
  return roots.some((root) => p === root || p.startsWith(root + path.sep))
}

/** 解析 HTTP Range 头（bytes=start-end / bytes=start- / bytes=-suffix），返回闭区间。
 *  非法/空返回 null（调用方回 200 全量）；越界按文件尺寸钳制。仅服务于媒体回放拖进度条。 */
export function parseByteRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    // bytes=-N：末尾 N 字节
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Math.min(Number(m[1]), size - 1)
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  if (start > end || start >= size) return null
  return { start, end }
}
