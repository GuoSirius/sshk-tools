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
  tab?: 'upload' | 'gallery' | 'selected'
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
      tab: parsed.tab === 'gallery' || parsed.tab === 'upload' || parsed.tab === 'selected' ? parsed.tab : undefined,
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

/** 级联目录节点：label 是本级名，value 是完整路径（可直接写回 target），children 为子级 */
export interface DirectoryTreeNode {
  value: string
  label: string
  children?: DirectoryTreeNode[]
}

/**
 * 把完整路径列表转成级联树（el-cascader 用），每一级都可被选中（checkStrictly）。
 * 例 ['blog/2026/06', 'blog/2025'] → blog → {2025, 2026 → 06}；value 始终是完整路径。
 */
export function directoryTree(keys: string[]): DirectoryTreeNode[] {
  const roots: DirectoryTreeNode[] = []
  const byValue = new Map<string, DirectoryTreeNode>()
  for (const full of directoriesFromKeys(keys)) {
    const segs = full.split('/').filter(Boolean)
    let prefix = ''
    let siblings = roots
    for (const seg of segs) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      let node = byValue.get(prefix)
      if (!node) {
        node = { value: prefix, label: seg }
        byValue.set(prefix, node)
        siblings.push(node)
      }
      // 下一层的父节点可能是刚建的，children 延迟创建
      siblings = node.children ?? (node.children = [])
    }
  }
  // el-cascader 遇到空 children 数组会显示「无数据的下一级」箭头，叶子删掉
  const prune = (nodes: DirectoryTreeNode[]): void => {
    for (const n of nodes) {
      if (n.children && n.children.length) prune(n.children)
      else delete n.children
    }
  }
  prune(roots)
  return roots
}

/**
 * 关键词匹配图片（文件名搜索）：忽略大小写，命中 name / key / url 任一即可。
 * 搜索只作用于已加载项，不额外发起列图请求（后端 limit 已保证一次拿足）。
 */
export function matchImageKeyword<T extends { name?: string; key?: string; url: string }>(
  item: T,
  keyword: string,
): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return [item.name, item.key, item.url].some((v) => (v ?? '').toLowerCase().includes(kw))
}
