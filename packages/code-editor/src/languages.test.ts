import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, LANGUAGES, languageForPath, monacoLanguageFor } from './languages'

describe('扩展名→语言映射', () => {
  it('覆盖 R27 约定的全部语言与 markdown', () => {
    const ids = LANGUAGES.map((l) => l.id)
    for (const id of ['html', 'css', 'js', 'ts', 'json', 'yaml', 'python', 'java', 'php', 'markdown', 'njk', 'env', 'csv', 'tsv']) {
      expect(ids).toContain(id)
    }
    expect(monacoLanguageFor({ path: 'readme.md' })).toBe('markdown')
    expect(monacoLanguageFor({ path: 'meta.yaml' })).toBe('yaml')
    expect(monacoLanguageFor({ path: 'config.yml' })).toBe('yaml')
    expect(monacoLanguageFor({ path: 'index.ts' })).toBe('typescript')
    expect(monacoLanguageFor({ path: 'a.PHP' })).toBe('php')
  })

  it('csv / tsv 注册为独立语言（badge 统计粘贴等场景）', () => {
    expect(monacoLanguageFor({ path: 'stats.csv' })).toBe('csv')
    expect(monacoLanguageFor({ path: 'stats.tsv' })).toBe('tsv')
    expect(monacoLanguageFor({ language: 'csv' })).toBe('csv')
  })

  it('P2 近似：njk→html、env→ini', () => {
    expect(monacoLanguageFor({ path: 'source.njk' })).toBe('html')
    expect(monacoLanguageFor({ path: 'conf/.env' })).toBe('ini')
  })

  it('显式 language 优先于 path，且允许 Monaco 原生 id', () => {
    expect(monacoLanguageFor({ language: 'njk', path: 'a.json' })).toBe('html')
    expect(monacoLanguageFor({ language: 'python', path: 'a.ts' })).toBe('python')
    expect(monacoLanguageFor({ language: 'shell' })).toBe('shell')
  })

  it('未命中回落 plaintext，languageForPath 返回定义', () => {
    expect(monacoLanguageFor()).toBe(DEFAULT_LANGUAGE)
    expect(monacoLanguageFor({ path: 'unknown.xyz' })).toBe(DEFAULT_LANGUAGE)
    expect(languageForPath('a.md')?.id).toBe('markdown')
    expect(languageForPath('a.xyz')).toBeUndefined()
  })
})
