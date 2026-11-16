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

/**
 * 手输目录归一化：统一正斜杠、去首尾斜杠、压掉重复段。
 * - 对象存储前缀 / 远程路径：`/a/b/c`、`a/b/c/`、`a//b/c` → 统一 `a/b/c`，避免同一目录被当成不同作用域；
 * - 本地目录是文件系统路径，语义不同（绝对路径 /../、盘符），**不在此归一化**，由调用方原样保留。
 * 例：'/a/b/c' → 'a/b/c'；'a/b/c/' → 'a/b/c'；'//a//b//' → 'a/b'。
 */
export function normalizeDirInput(raw: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
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
 * 把「完整目录路径」列表转成级联树（el-cascader 用），每一级都可被选中（checkStrictly）。
 * 输入应是目录本身（不是文件 key）。例 ['blog/2026/06', 'blog/2025'] → blog → {2025, 2026 → 06}；
 * value 始终是完整路径。
 */
export function buildDirectoryTree(dirs: string[]): DirectoryTreeNode[] {
  const roots: DirectoryTreeNode[] = []
  const byValue = new Map<string, DirectoryTreeNode>()
  // 先按规范化完整路径排序，保证各级子节点顺序稳定（与旧的 directoriesFromKeys→directoryTree 一致）
  const sorted = dirs
    .map((d) => normalizeDirInput(d))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  for (const raw of sorted) {
    const segs = normalizeDirInput(raw).split('/').filter(Boolean)
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

/** 从已列图片 key 反推目录树（列目录能力不可用时的降级路径） */
export function directoryTree(keys: string[]): DirectoryTreeNode[] {
  return buildDirectoryTree(directoriesFromKeys(keys))
}

export type DirValidationLevel = 'ok' | 'warn' | 'error'
export interface DirValidation {
  level: DirValidationLevel
  /** 可直接展示给用户的中文提示；ok 时为空 */
  message: string
}

/**
 * 手输目录的实时合法性校验（不阻断输入，只给提示）。
 * - 对象存储 / 远程路径：拦截控制字符、'.'/'..' 段；对反斜杠、首尾/重复斜杠、URL 敏感字符给归一化提示；
 * - 本地文件系统路径：拦截控制字符与 Windows 保留字符（盘符 ':' 例外），其余交给 Provider 的 path.resolve。
 */
export function validateDirInput(raw: string, type: 'local' | 'remote' | 'cloud'): DirValidation {
  const value = String(raw ?? '')
  if (!value.trim()) return { level: 'ok', message: '' }

  // 控制字符（含换行/制表/NUL）：任何来源都不合法
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { level: 'error', message: '目录不能包含换行或不可见控制字符' }
  }

  if (type === 'local') {
    // Windows 保留字符 < > : " | ? *（盘符 C:\ 里的冒号放行）
    const body = value.replace(/^[A-Za-z]:/, '')
    if (/[<>"|?*]/.test(body)) {
      return { level: 'error', message: '本地路径不能包含 < > : " | ? * 等字符' }
    }
    return { level: 'ok', message: '' }
  }

  const segments = value.split(/[\\/]/).filter((s) => s !== '')
  if (segments.includes('.') || segments.includes('..')) {
    return { level: 'error', message: '目录不能包含 . 或 .. 这一级' }
  }
  if (value.includes('\\')) {
    return { level: 'warn', message: '反斜杠会在确认时自动转为 /' }
  }
  if (/[?#]/.test(value)) {
    return { level: 'warn', message: '包含 ? 或 # 可能影响图片访问链接，建议避免使用' }
  }
  if (value.startsWith('/') || value.endsWith('/') || /\/{2,}/.test(value) || /\s/.test(value)) {
    return { level: 'warn', message: '首尾/重复斜杠与空格会在确认时自动清理' }
  }
  return { level: 'ok', message: '' }
}

/**
 * 把一个目录路径展开成它自己 + 各级父目录（完整路径），用于把手输/已选目录并入候选集。
 * 例 'a/b/c' → ['a', 'a/b', 'a/b/c']；归一化后去重。
 */
export function expandDirPath(raw: string): string[] {
  const segs = normalizeDirInput(raw).split('/').filter(Boolean)
  const out: string[] = []
  let prefix = ''
  for (const seg of segs) {
    prefix = prefix ? `${prefix}/${seg}` : seg
    out.push(prefix)
  }
  return out
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
