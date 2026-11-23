import { describe, expect, it } from 'vitest'
import { formatNodeLabel } from './node-label'

describe('左树标签：真实目录名（meta.name）', () => {
  it('有 name 且不同于目录名时拼接括号', () => {
    expect(formatNodeLabel('elabscience', '艾博抗')).toBe('elabscience（艾博抗）')
    expect(formatNodeLabel('v3', '双十一版')).toBe('v3（双十一版）')
  })

  it('name 缺失或与目录名相同时只显示目录名', () => {
    expect(formatNodeLabel('demo')).toBe('demo')
    expect(formatNodeLabel('demo', '  ')).toBe('demo')
    expect(formatNodeLabel('demo', 'demo')).toBe('demo')
  })
})
