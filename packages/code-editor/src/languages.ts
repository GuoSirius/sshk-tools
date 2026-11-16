/**
 * R27 B2：语言注册中心 + 扩展名→语言映射，供所有工具零配置复用。
 * P1=C：markdown 已注册；P2：njk / env 先沿用近似高亮（njk→html、env→ini），后续可换自定义 Monarch。
 */

export interface LanguageDef {
  /** 逻辑语言 id（工具侧传 language 时用） */
  id: string
  /** 实际交给 Monaco 的语言 id（近似高亮时与 id 不同） */
  monacoId: string
  /** 扩展名（含点、小写） */
  extensions: string[]
  /** 是否 Monaco 内置 basic-language（false 表示需额外注册，如 monaco-yaml） */
  builtin: boolean
}

export const LANGUAGES: readonly LanguageDef[] = [
  { id: 'html', monacoId: 'html', extensions: ['.html', '.htm'], builtin: true },
  { id: 'css', monacoId: 'css', extensions: ['.css'], builtin: true },
  { id: 'js', monacoId: 'javascript', extensions: ['.js', '.mjs', '.cjs'], builtin: true },
  { id: 'ts', monacoId: 'typescript', extensions: ['.ts', '.mts', '.cts'], builtin: true },
  { id: 'json', monacoId: 'json', extensions: ['.json'], builtin: true },
  { id: 'yaml', monacoId: 'yaml', extensions: ['.yaml', '.yml'], builtin: false },
  { id: 'python', monacoId: 'python', extensions: ['.py'], builtin: true },
  { id: 'java', monacoId: 'java', extensions: ['.java'], builtin: true },
  { id: 'php', monacoId: 'php', extensions: ['.php'], builtin: true },
  { id: 'markdown', monacoId: 'markdown', extensions: ['.md', '.markdown'], builtin: true },
  { id: 'njk', monacoId: 'html', extensions: ['.njk'], builtin: true },
  { id: 'env', monacoId: 'ini', extensions: ['.env'], builtin: true },
  { id: 'csv', monacoId: 'csv', extensions: ['.csv'], builtin: false },
  { id: 'tsv', monacoId: 'tsv', extensions: ['.tsv'], builtin: false },
]

export const DEFAULT_LANGUAGE = 'plaintext'

/** 按路径（或显式 language）解析为 Monaco 语言 id；未命中回落 plaintext */
export function monacoLanguageFor(input: { language?: string; path?: string } = {}): string {
  const explicit = input.language?.trim()
  if (explicit) {
    const hit = LANGUAGES.find((l) => l.id === explicit || l.monacoId === explicit)
    return hit?.monacoId ?? explicit
  }
  const lower = (input.path ?? '').toLowerCase()
  const hit = LANGUAGES.find((l) => l.extensions.some((ext) => lower.endsWith(ext)))
  return hit?.monacoId ?? DEFAULT_LANGUAGE
}

/** 按扩展名查逻辑语言定义（供 UI 显示语言名 / 判断是否需要额外注册） */
export function languageForPath(path: string): LanguageDef | undefined {
  const lower = path.toLowerCase()
  return LANGUAGES.find((l) => l.extensions.some((ext) => lower.endsWith(ext)))
}
