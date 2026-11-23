import type { FilePickerLibrary, FilePickerSource, FilePickerTarget } from './types'

/**
 * 文件选择弹框设置（自 rich-text 图片库设置 2026-11-17 迁移泛化）：
 * - 默认来源优先级：云 → 远程 → 本地；
 * - 来源与桶/目录等专属项跨页面切换、应用重启回显；
 * - 多实例以 stateKey 隔离（template 双实例页 A/B、EDM 各字段各用独立 key）。
 */
export interface FilePickerSettings {
  sourceId: string
  /** 每个来源独立保存专属项：切换来源不会丢掉此前填过的桶/目录 */
  targets: Record<string, FilePickerTarget>
  tab?: 'upload' | 'gallery' | 'selected'
}

const PRIORITY: Record<FilePickerSource['type'], number> = { cloud: 0, remote: 1, local: 2 }

export function sortSourcesByDefault(sources: FilePickerSource[]): FilePickerSource[] {
  return [...sources].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])
}

/** 来源不存在（配置变更删除 profile）时回落到优先级最高的可用来源 */
export function defaultSourceId(sources: FilePickerSource[], savedId?: string): string {
  const ordered = sortSourcesByDefault(sources)
  return ordered.find((s) => s.id === savedId)?.id ?? ordered[0]?.id ?? ''
}

export function settingsKey(stateKey: string): string {
  return `sshk:file-picker:${stateKey || 'default'}`
}

/** 旧版 rich-text 图片库的存储键：首次读取从这里迁移，避免老用户丢已选来源/目录 */
const LEGACY_SETTINGS_KEY = (stateKey: string): string => `sshk:rich-text:image-library:${stateKey || 'default'}`

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

/**
 * 目录显示值：云/远程的桶根相对路径（如 bt_backup）补前导 /，与级联回显口径（/bt_backup）一致。
 * 级联框靠「根 label='' + separator='/'」拼出 /，并列的手输框直接绑内部值则显示 bt_backup，
 * 两个控件显示不一致（2026-11-20 用户反馈），故手输框非编辑态走本函数补显。
 * 仅用于展示，不改内部存储值（上传 prefix / scope / 校验仍用桶根相对路径）。
 * 本地路径与已带 / 的值原样返回。
 */
export function displayDirPath(raw: string, type: 'local' | 'remote' | 'cloud'): string {
  const v = String(raw ?? '')
  return type !== 'local' && v && !v.startsWith('/') ? `/${v}` : v
}

function parseSettings(raw: string | null): FilePickerSettings | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<FilePickerSettings>
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

/** localStorage 不可用（隐私模式/受限 webview）时静默降级为内存态，不阻断编辑 */
export function loadSettings(store: Storage | null | undefined, stateKey: string): FilePickerSettings | null {
  if (!store) return null
  const direct = parseSettings(store.getItem(settingsKey(stateKey)))
  if (direct) return direct
  // 新键未写入过：回落读旧版 rich-text 图片库键（读取不改写，等首次 saveSettings 自然迁移）
  return parseSettings(store.getItem(LEGACY_SETTINGS_KEY(stateKey)))
}

export function saveSettings(store: Storage | null | undefined, stateKey: string, settings: FilePickerSettings): void {
  if (!store) return
  try {
    store.setItem(settingsKey(stateKey), JSON.stringify(settings))
  } catch {
    // localStorage 满 / 被禁用：不影响主流程
  }
}

/** 安全取 localStorage（隐私模式 / 受限 webview 下静默降级） */
export function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 读取某 stateKey 的上传目标（source + target），供无交互场景（如富文本内联 data: 图片静默转存）复用。
 * 口径与弹框 useDirPicker.restoreSettings 一致：sourceId 失效时按 云→远程→本地 回落默认源；
 * 无保存记录同样回落默认源。返回 null 仅代表「没有任何可用来源」。
 */
export async function resolveLastUploadTarget(
  library: FilePickerLibrary,
  stateKey: string,
  store: Storage | null | undefined = safeStorage(),
): Promise<{ source: FilePickerSource; target: FilePickerTarget } | null> {
  const saved = loadSettings(store, stateKey)
  const sources = sortSourcesByDefault(await library.sources())
  const id = defaultSourceId(sources, saved?.sourceId)
  const source = sources.find((s) => s.id === id)
  if (!source) return null
  return { source, target: saved?.targets[id] ?? {} }
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
    return { level: 'warn', message: '包含 ? 或 # 可能影响文件访问链接，建议避免使用' }
  }
  if (value.startsWith('/') || value.endsWith('/') || /\/{2,}/.test(value) || /\s/.test(value)) {
    return { level: 'warn', message: '首尾/重复斜杠与空格会在确认时自动清理' }
  }
  return { level: 'ok', message: '' }
}

/**
 * 关键词匹配文件（文件名搜索）：忽略大小写，命中 name / key / url 任一即可。
 */
export function matchFileKeyword<T extends { name?: string; key?: string; url: string }>(
  item: T,
  keyword: string,
): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return [item.name, item.key, item.url].some((v) => (v ?? '').toLowerCase().includes(kw))
}
