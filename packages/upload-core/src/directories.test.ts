import { describe, expect, it } from 'vitest'
import { collectPrefixes, joinDir, normalizeDirPath, relativeDir } from './directories'

describe('normalizeDirPath', () => {
  it('统一斜杠、去首尾、压空段', () => {
    expect(normalizeDirPath('/a\\b//c/')).toBe('a/b/c')
    expect(normalizeDirPath('//')).toBe('')
    expect(normalizeDirPath('')).toBe('')
  })
})

describe('joinDir', () => {
  it('拼接并处理空段', () => {
    expect(joinDir('a/b', 'c')).toBe('a/b/c')
    expect(joinDir('', 'a')).toBe('a')
    expect(joinDir('a', '')).toBe('a')
    expect(joinDir('a/', '/b')).toBe('a/b')
  })
})

describe('relativeDir', () => {
  it('全前缀相对 base 取相对路径并去尾斜杠', () => {
    expect(relativeDir('blog/2026/', 'blog')).toBe('2026')
    expect(relativeDir('blog/2026/', '')).toBe('blog/2026')
    expect(relativeDir('Down_tmp/', '')).toBe('Down_tmp')
  })
  it('全前缀等于 base 时返回空（根本身不算子目录）', () => {
    expect(relativeDir('blog/', 'blog')).toBe('')
  })
})

describe('collectPrefixes', () => {
  it('兼容字符串数组形态（ali-oss / qiniu / azure 归一化后）', () => {
    expect(collectPrefixes({ prefixes: ['a/', 'b/'] })).toEqual(['a/', 'b/'])
  })
  it('兼容对象数组形态（COS / S3 / OBS / BOS）', () => {
    expect(collectPrefixes({ CommonPrefixes: [{ Prefix: 'a/' }, { Prefix: 'b/' }] })).toEqual(['a/', 'b/'])
    expect(collectPrefixes({ commonPrefixes: [{ prefix: 'x/' }] })).toEqual(['x/'])
    expect(collectPrefixes({ blobPrefixes: [{ name: 'y/' }] })).toEqual(['y/'])
  })
  it('嵌套层级（OBS InterfaceResult）也能向下找到', () => {
    expect(collectPrefixes({ InterfaceResult: { CommonPrefixes: [{ Prefix: 'deep/' }] } })).toEqual(['deep/'])
  })
  it('重复前缀去重，无前缀结构返回空', () => {
    expect(collectPrefixes({ prefixes: ['a/', 'a/'] })).toEqual(['a/'])
    expect(collectPrefixes({ Contents: [{ Key: 'a.png' }] })).toEqual([])
    expect(collectPrefixes(null)).toEqual([])
  })
})
