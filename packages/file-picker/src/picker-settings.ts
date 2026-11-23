import type { FilePickerLibrary, FilePickerSource, FilePickerTarget } from './types'

/**
 * 文件选择弹框设置（自 rich-text 图片库设置 2026-11-17 迁移泛化）：
 * - 默认来源优先级：云 → 远程 → 本地；
 * - 来源与桶/目录等专属项跨页面切换、应用重启回显；
 * - **全局统一一份**（plans/13 §三 D58，2026-11-23 敲板）：所有 FilePickerDialog/UploadTargetDialog
 *   实例读写同一份「上次位置」，任何一处确认后其余入口下次打开回显；废弃按 stateKey 隔离。
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

/** 全局统一键（D58）：所有实例共用一份「上次位置」 */
export const GLOBAL_SETTINGS_KEY = 'sshk:file-picker:global'

/**
 * @deprecated 全局统一后不再按 stateKey 分桶，形参保留只为兼容旧调用签名，内部一律忽略。
 */
export function settingsKey(_stateKey?: string): string {
  return GLOBAL_SETTINGS_KEY
}

/**
 * 旧版分桶存储键前缀（2026-11-23 起废弃）：首次读取按优先序迁移，命中即整链清理。
 * - `sshk:file-picker:<stateKey>`：分桶时代主键（stateKey 含动态键：edm:<字段>、内容记录 id 等，
 *   无法枚举，故按前缀全扫）；
 * - `sshk:rich-text:image-library:<stateKey>`：file-picker 立项前的 rich-text 图片库键。
 */
const LEGACY_PREFIXES = ['sshk:file-picker:', 'sshk:rich-text:image-library:']
/** 迁移优先序：越靠前越代表「用户最近手动选过的位置」语义（file-picker: 前缀内匹配） */
const LEGACY_PRIORITY = ['edm::image-field', 'template:a', 'template:b', 'edm::favicon', 'default']

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

/**
 * 从旧键整链迁移：全局键未命中时扫两个废弃前缀，按 LEGACY_PRIORITY 取优先命中者（无命中取扫到的第一个），
 * 命中后**整链 removeItem 清理**（含动态键），首次 persist 自然落全局键。
 */
function migrateFromLegacy(store: Storage): FilePickerSettings | null {
  const found: { key: string; priority: number; order: number }[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (!key) continue
    const prefix = LEGACY_PREFIXES.find((p) => key.startsWith(p))
    if (!prefix) continue
    const rest = key.slice(prefix.length)
    const priority = prefix === LEGACY_PREFIXES[0] ? LEGACY_PRIORITY.indexOf(rest) : -1
    found.push({ key, priority, order: found.length })
  }
  if (found.length === 0) return null
  const best =
    found.filter((f) => f.priority >= 0).sort((a, b) => a.priority - b.priority || a.order - b.order)[0] ?? found[0]!
  const parsed = parseSettings(store.getItem(best.key))
  // 迁移即清理：无论解析成败都摘掉整链旧键，避免每次打开重复扫描
  for (const f of found) {
    try { store.removeItem(f.key) } catch { /* 隐私模式等异常忽略 */ }
  }
  return parsed
}

/**
 * 读取全局「上次位置」。@param stateKey 已废弃，保留形参只为兼容旧调用签名，内部忽略。
 */
export function loadSettings(store: Storage | null | undefined, _stateKey?: string): FilePickerSettings | null {
  if (!store) return null
  const direct = parseSettings(store.getItem(GLOBAL_SETTINGS_KEY))
  if (direct) return direct
  return migrateFromLegacy(store)
}

export function saveSettings(store: Storage | null | undefined, _stateKey: string | undefined, settings: FilePickerSettings): void {
  if (!store) return
  try {
    store.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings))
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
 * 读取全局最近一次上传目标（source + target），供无交互场景（如富文本内联 data: 图片静默转存）复用。
 * 口径与弹框 useDirPicker.restoreSettings 一致：sourceId 失效时按 云→远程→本地 回落默认源；
 * 无保存记录同样回落默认源。返回 null 仅代表「没有任何可用来源」。
 * 旧签名第二参 stateKey 已废弃（D58 全局统一），本参直接是存储（缺省 safeStorage）。
 */
export async function resolveLastUploadTarget(
  library: FilePickerLibrary,
  store: Storage | null | undefined = safeStorage(),
): Promise<{ source: FilePickerSource; target: FilePickerTarget } | null> {
  const saved = loadSettings(store)
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
