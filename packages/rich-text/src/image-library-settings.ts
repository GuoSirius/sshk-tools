import type { RichTextImageSource, RichTextImageTarget } from './types'

/**
 * 富文本图片库设置（用户需求 2026-11-17）：
 * - 默认来源优先级：云 → 远程 → 本地；
 * - 来源与桶/目录等专属项跨页面切换、应用重启回显；
 * - 多实例以 stateKey 隔离（template 双实例页 A/B、EDM 各富文本字段各用独立 key）。
 */
export interface ImageLibrarySettings {
  sourceId: string
  /** 每个来源独立保存专属项：切换来源不会丢掉此前填过的桶/目录 */
  targets: Record<string, RichTextImageTarget>
  tab?: 'upload' | 'gallery'
}

const PRIORITY: Record<RichTextImageSource['type'], number> = { cloud: 0, remote: 1, local: 2 }

export function sortSourcesByDefault(sources: RichTextImageSource[]): RichTextImageSource[] {
  return [...sources].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])
}

/** 来源不存在（配置变更删除 profile）时回落到优先级最高的可用来源 */
export function defaultSourceId(sources: RichTextImageSource[], savedId?: string): string {
  const ordered = sortSourcesByDefault(sources)
  return ordered.find((s) => s.id === savedId)?.id ?? ordered[0]?.id ?? ''
}

export function settingsKey(stateKey: string): string {
  return `sshk:rich-text:image-library:${stateKey || 'default'}`
}

/** localStorage 不可用（隐私模式/受限 webview）时静默降级为内存态，不阻断编辑 */
export function loadSettings(store: Storage | null | undefined, stateKey: string): ImageLibrarySettings | null {
  if (!store) return null
  try {
    const raw = store.getItem(settingsKey(stateKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ImageLibrarySettings>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : '',
      targets: parsed.targets && typeof parsed.targets === 'object' ? parsed.targets : {},
      tab: parsed.tab === 'gallery' || parsed.tab === 'upload' ? parsed.tab : undefined,
    }
  } catch {
    return null
  }
}

export function saveSettings(store: Storage | null | undefined, stateKey: string, settings: ImageLibrarySettings): void {
  if (!store) return
  try {
    store.setItem(settingsKey(stateKey), JSON.stringify(settings))
  } catch {
    // localStorage 满 / 被禁用：不影响图片库主流程
  }
}

/**
 * 从已列图片 key 派生多级目录选项：
 * 每个路径段生成一条完整前缀（a / a/b / a/b/c），去重、排序，供下拉选择；
 * 不存在的目录仍可在下拉里手输（filterable + allow-create）。
 */
export function directoriesFromKeys(keys: string[]): string[] {
  const out = new Set<string>()
  for (const raw of keys) {
    const key = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const segments = key.split('/').filter(Boolean)
    segments.pop() // 末段是文件名
    let prefix = ''
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      out.add(prefix)
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}
