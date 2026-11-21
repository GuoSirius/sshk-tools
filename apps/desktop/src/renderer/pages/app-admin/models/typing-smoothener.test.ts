import { describe, expect, it, vi } from 'vitest'
import { createTypingSmoothener } from './typing-smoothener'

describe('createTypingSmoothener（D-V3-2 打字平滑）', () => {
  it('push 后按节拍逐段释放，全部释放完自动停止', () => {
    vi.useFakeTimers()
    const out: string[] = []
    const s = createTypingSmoothener((t) => out.push(t), { intervalMs: 10, baseStep: 2 })
    s.push('abcdefgh') // 8 字符
    vi.advanceTimersByTime(10)
    expect(out.join('')).toBe('ab') // 首拍 2 字符
    vi.advanceTimersByTime(20)
    expect(out.join('')).toBe('abcdef')
    vi.advanceTimersByTime(10)
    expect(out.join('')).toBe('abcdefgh')
    expect(s.pending()).toBe(0)
    // 队列空后节拍停止，时间推进不再追加
    const len = out.join('').length
    vi.advanceTimersByTime(50)
    expect(out.join('').length).toBe(len)
    vi.useRealTimers()
  })

  it('积压越大步长越大（追赶系数），长回复不会被拖太慢', () => {
    vi.useFakeTimers()
    const out: string[] = []
    // 120 字积压：首拍步长 = max(2, ceil(120/12)) = 10
    const s = createTypingSmoothener((t) => out.push(t), { intervalMs: 10, baseStep: 2, catchUpRatio: 12 })
    s.push('x'.repeat(120))
    vi.advanceTimersByTime(10)
    expect(out[0]!.length).toBe(10)
    vi.advanceTimersByTime(10)
    // 剩 110 → 步长 ceil(110/12)=10
    expect(out[1]!.length).toBe(10)
    vi.useRealTimers()
  })

  it('flush 立即释放全部积压并停止节拍', () => {
    vi.useFakeTimers()
    const out: string[] = []
    const s = createTypingSmoothener((t) => out.push(t), { intervalMs: 10 })
    s.push('abc')
    s.flush()
    expect(out.join('')).toBe('abc')
    expect(s.pending()).toBe(0)
    vi.advanceTimersByTime(50)
    expect(out.join('')).toBe('abc') // 不再追加
    vi.useRealTimers()
  })

  it('空串 push 被忽略，不启动节拍；多次 push 累积同队列', () => {
    vi.useFakeTimers()
    const out: string[] = []
    const s = createTypingSmoothener((t) => out.push(t), { intervalMs: 10, baseStep: 100 })
    s.push('')
    vi.advanceTimersByTime(30)
    expect(out).toEqual([])
    s.push('a')
    s.push('bc')
    vi.advanceTimersByTime(10)
    expect(out.join('')).toBe('abc')
    vi.useRealTimers()
  })
})
