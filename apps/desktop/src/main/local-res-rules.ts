import path from 'node:path'
import { TOOL_IDS, normalizeUploadConfig, resolveUploadTool } from '@sshk/shared'

/**
 * localres:// 白名单纯逻辑（无 electron 依赖，供单测）：
 * 允许根 = 全局本地上传目录 + 各工具 localDir 覆盖；仅放行图片扩展名，防目录遍历/任意读。
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
}

interface ConfigLike {
  get(key: string): unknown
}

export function collectResRoots(config: ConfigLike): string[] {
  const roots: string[] = []
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
