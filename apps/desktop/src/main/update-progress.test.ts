import { describe, expect, it } from 'vitest'
import { normalizeUpdatePercent } from './update-progress'

describe('更新下载进度归一', () => {
  it('慢速链路下不足 1% 保留一位小数，UI 不再长期显示 0%', () => {
    expect(normalizeUpdatePercent(0.2)).toBe(0.2)
    expect(normalizeUpdatePercent(0.04)).toBe(0.1)
    expect(normalizeUpdatePercent(0.99)).toBe(1)
  })

  it('常规进度取整、完成为 100', () => {
    expect(normalizeUpdatePercent(37.4)).toBe(37)
    expect(normalizeUpdatePercent(100)).toBe(100)
  })

  it('零值与非有限值安全处理', () => {
    expect(normalizeUpdatePercent(0)).toBe(0)
    expect(normalizeUpdatePercent(-1)).toBe(0)
    expect(normalizeUpdatePercent(Number.NaN)).toBeNull()
    expect(normalizeUpdatePercent(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
