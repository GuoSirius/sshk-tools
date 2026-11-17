import { describe, expect, it } from 'vitest'
import { cloudKey, fsBasename, fsDestPath, fsJoin, fsParent, normalizeRootRel } from './fs-paths'

/**
 * X6 路径安全（plans/08 §六）：main 侧所有 fs 操作入参都要过 normalizeRootRel，
 * `..` / 反斜杠 / 控制字符一律拒绝；这里固化这些边界行为。
 */
describe('normalizeRootRel', () => {
  it('规范化：统一斜杠、去首尾与空段', () => {
    expect(normalizeRootRel('')).toBe('')
    expect(normalizeRootRel('/')).toBe('')
    expect(normalizeRootRel('a//b/')).toBe('a/b')
    expect(normalizeRootRel('/a/b/')).toBe('a/b')
    expect(normalizeRootRel('  a/b  ')).toBe('a/b')
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
    expect(fsJoin('', 'x.png')).toBe('x.png')
    expect(fsJoin('a/b', 'x.png')).toBe('a/b/x.png')
    expect(() => fsJoin('a', '../x')).toThrow()
    expect(() => fsJoin('a', 'x/y')).toThrow()
  })

  it('fsParent / fsBasename：根返回空串', () => {
    expect(fsParent('a/b/c.txt')).toBe('a/b')
    expect(fsParent('a.txt')).toBe('')
    expect(fsBasename('a/b/c.txt')).toBe('c.txt')
    expect(fsBasename('')).toBe('')
  })

  it('fsDestPath：移动/复制保留原文件名', () => {
    expect(fsDestPath('d1', 'a/b/c.png')).toBe('d1/c.png')
    expect(fsDestPath('', 'a/b/c.png')).toBe('c.png')
  })
})

describe('cloudKey', () => {
  it('目录带尾斜杠（marker 语义），文件不带', () => {
    expect(cloudKey('a/b', 'dir')).toBe('a/b/')
    expect(cloudKey('a/b/c.png', 'file')).toBe('a/b/c.png')
    expect(cloudKey('', 'dir')).toBe('')
    expect(() => cloudKey('../x', 'file')).toThrow()
  })
})
