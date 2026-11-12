import { describe, expect, it } from 'vitest'
import { entityId, ulid } from './id'

describe('ulid', () => {
  it('长度 26 且仅含 Crockford Base32 字符', () => {
    const id = ulid()
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

  it('批量生成唯一', () => {
    const set = new Set(Array.from({ length: 2000 }, () => ulid()))
    expect(set.size).toBe(2000)
  })

  it('同毫秒单调递增（可按字典序排序）', () => {
    const fixed = 1_700_000_000_000
    const a = ulid(fixed)
    const b = ulid(fixed)
    expect(a < b).toBe(true)
  })

  it('entityId 携带业务前缀', () => {
    expect(entityId('mail')).toMatch(/^mail_[0-9a-z]{26}$/)
  })
})
