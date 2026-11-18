import { describe, expect, it } from 'vitest'
import { cloudKey, fsBasename, fsDestPath, fsJoin, fsParent, normalizeRootRel } from './fs-paths'

/**
 * X6 路径安全 + 路径契约（plans/08 §六；2026-11-18 用户拍板根治）：
 * 内部统一 `/a/b/c`（根 `/`），输入兼容无前导 / 的旧形式，输出恒为规范形式。
 * `..` / 反斜杠 / 控制字符一律拒绝。
 */
describe('normalizeRootRel', () => {
  it('规范化：统一前导斜杠、去首尾与空段', () => {
    expect(normalizeRootRel('')).toBe('/')
    expect(normalizeRootRel('/')).toBe('/')
    expect(normalizeRootRel('///')).toBe('/')
    expect(normalizeRootRel('a//b/')).toBe('/a/b')
    expect(normalizeRootRel('/a/b/')).toBe('/a/b')
    expect(normalizeRootRel('  /a/b  ')).toBe('/a/b')
  })

  it('拒绝越权路径（.. 与 .）', () => {
    expect(() => normalizeRootRel('../etc/passwd')).toThrow()
    expect(() => normalizeRootRel('a/../b')).toThrow()
    expect(() => normalizeRootRel('a/./b')).toThrow()
    expect(() => normalizeRootRel('..')).toThrow()
  })

  it('拒绝反斜杠与控制字符', () => {
    expect(() => normalizeRootRel('a\\b')).toThrow()
    expect(() => normalizeRootRel('a\u0000b')).toThrow()
    expect(() => normalizeRootRel('a\u0007b')).toThrow()
  })
})

describe('fsJoin / fsParent / fsBasename / fsDestPath', () => {
  it('fsJoin：根与深层目录都正确拼接', () => {
    expect(fsJoin('/', 'x.png')).toBe('/x.png')
    expect(fsJoin('', 'x.png')).toBe('/x.png') // 兼容旧输入
    expect(fsJoin('/a/b', 'x.png')).toBe('/a/b/x.png')
    expect(() => fsJoin('/a', '../x')).toThrow()
    expect(() => fsJoin('/a', 'x/y')).toThrow()
  })

  it('fsParent：根返回 /，深层逐级回退', () => {
    expect(fsParent('/a/b/c.txt')).toBe('/a/b')
    expect(fsParent('/a.txt')).toBe('/')
    expect(fsParent('/')).toBe('/')
    expect(fsParent('')).toBe('/')
  })

  it('fsBasename：根返回空串', () => {
    expect(fsBasename('/a/b/c.txt')).toBe('c.txt')
    expect(fsBasename('/')).toBe('')
    expect(fsBasename('')).toBe('')
  })

  it('fsDestPath：移动/复制保留原文件名', () => {
    expect(fsDestPath('/d1', '/a/b/c.png')).toBe('/d1/c.png')
    expect(fsDestPath('/', '/a/b/c.png')).toBe('/c.png')
    expect(() => fsDestPath('/d1', '/')).toThrow()
  })
})

describe('cloudKey', () => {
  it('云 key 不带前导斜杠：目录带尾斜杠（marker 语义），文件不带', () => {
    expect(cloudKey('/a/b', 'dir')).toBe('a/b/')
    expect(cloudKey('/a/b/c.png', 'file')).toBe('a/b/c.png')
    expect(cloudKey('/', 'dir')).toBe('')
    expect(cloudKey('', 'dir')).toBe('')
    expect(() => cloudKey('/../x', 'file')).toThrow()
  })
})
