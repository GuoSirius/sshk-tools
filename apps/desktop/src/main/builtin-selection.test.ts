import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectBuiltinToolInfo, parseBuiltinSpec, resolveBuiltinSelection } from './builtin-selection'

const M = [
  { id: 'a', dependsOn: ['c'] },
  { id: 'b', dependsOn: [] },
  { id: 'c', dependsOn: [] },
  { id: 'd', dependsOn: ['a'] },
  { id: 'e', dependsOn: ['x'] },
]

describe('parseBuiltinSpec', () => {
  it('空 / all / * → 全量；分隔符容忍逗号分号空白并去重', () => {
    expect(parseBuiltinSpec(undefined)).toBe('all')
    expect(parseBuiltinSpec('')).toBe('all')
    expect(parseBuiltinSpec('all')).toBe('all')
    expect(parseBuiltinSpec('*')).toBe('all')
    expect(parseBuiltinSpec('  ')).toBe('all')
    expect(parseBuiltinSpec('a, b；c  a')).toEqual(['a', 'b', 'c'])  })
})

describe('resolveBuiltinSelection（依赖闭包）', () => {
  it('选 a、b：a 依赖的 c 自动搭进去（用户拍板语义）', () => {
    const sel = resolveBuiltinSelection(['a', 'b'], M)
    expect(sel.mode).toBe('list')
    expect(sel.ids).toEqual(['a', 'b', 'c'])
    expect(sel.excluded).toEqual(['d', 'e'])
    expect(sel.pulledIn).toEqual(['c'])
  })

  it('被依赖者单独选中时不重复计 pulledIn；环不栈溢出', () => {
    const cyclic = [
      { id: 'p', dependsOn: ['q'] },
      { id: 'q', dependsOn: ['p'] },
    ]
    const sel = resolveBuiltinSelection(['p'], cyclic)
    expect(sel.ids).toEqual(['p', 'q'])
    expect(sel.pulledIn).toEqual(['q'])
  })

  it('未知依赖容忍（运行时按 dep-missing 报），未知 root 直接抛错并列出可用 id', () => {
    const sel = resolveBuiltinSelection(['e'], M)
    expect(sel.ids).toEqual(['e'])
    expect(() => resolveBuiltinSelection(['zzz'], M)).toThrow(/zzz.*可用：a、b、c、d、e/)
  })

  it('全量模式零行为变化', () => {
    expect(resolveBuiltinSelection('all', M)).toEqual({ mode: 'all', ids: null, excluded: [], pulledIn: [] })
  })
})

describe('collectBuiltinToolInfo', () => {
  it('真实仓库扫描：只剩纯工具（P4-8b 三基础模块退役），id 与目录一致、dependsOn 为字符串数组', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const info = collectBuiltinToolInfo(repoRoot)
    expect(info.map((m) => m.id).sort()).toEqual(['badge-studio', 'edm-studio', 'template-tool'])
    expect(info.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true)
    expect(info.every((m) => Array.isArray(m.dependsOn))).toBe(true)
  })

  it('不存在的仓库根返回空数组', () => {
    expect(collectBuiltinToolInfo('Z:/definitely/not/exist')).toEqual([])
  })
})
