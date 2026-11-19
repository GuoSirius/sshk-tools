import { describe, expect, it, beforeEach } from 'vitest'
import {
  beginMediaDownload,
  finishMediaDownload,
  getMediaDownload,
  isMediaStreaming,
  removeMediaDownload,
  resetMediaDownloads,
  updateMediaDownload,
  waitForMediaBytes,
} from './media-stream'

describe('媒体边下边播会话表（media-stream）', () => {
  beforeEach(() => resetMediaDownloads())

  it('begin 注册 → update 单调钳制 → finish 置终态 → remove 移除', () => {
    beginMediaDownload('/tmp/a.mp4', 1000)
    expect(getMediaDownload('/tmp/a.mp4')).toMatchObject({ total: 1000, uploaded: 0, done: false })
    expect(isMediaStreaming('/tmp/a.mp4')).toBe(true)

    updateMediaDownload('/tmp/a.mp4', 300)
    updateMediaDownload('/tmp/a.mp4', 200) // 回退值忽略
    updateMediaDownload('/tmp/a.mp4', 99999) // 超总量钳制
    expect(getMediaDownload('/tmp/a.mp4')!.uploaded).toBe(1000)

    finishMediaDownload('/tmp/a.mp4')
    expect(getMediaDownload('/tmp/a.mp4')!.done).toBe(true)
    expect(isMediaStreaming('/tmp/a.mp4')).toBe(false)

    removeMediaDownload('/tmp/a.mp4')
    expect(getMediaDownload('/tmp/a.mp4')).toBeUndefined()
  })

  it('finish 带 error 时记录错误信息', () => {
    beginMediaDownload('/tmp/b.mp4', 500)
    updateMediaDownload('/tmp/b.mp4', 120)
    finishMediaDownload('/tmp/b.mp4', '网络中断')
    const st = getMediaDownload('/tmp/b.mp4')!
    expect(st.done).toBe(true)
    expect(st.error).toBe('网络中断')
    expect(st.uploaded).toBe(120) // 失败保留最后进度，不补满
  })

  it('waitForMediaBytes：数据到达即返回；不存在的会话立即返回 undefined', async () => {
    beginMediaDownload('/tmp/c.mp4', 1000)
    const sleep = async () => { updateMediaDownload('/tmp/c.mp4', 600) }
    const st = await waitForMediaBytes('/tmp/c.mp4', 500, { intervalMs: 1, sleep })
    expect(st!.uploaded).toBe(600)

    expect(await waitForMediaBytes('/nope', 100)).toBeUndefined()
  })

  it('waitForMediaBytes：下载失败时提前返回（不空等到超时）', async () => {
    beginMediaDownload('/tmp/d.mp4', 1000)
    let n = 0
    const sleep = async () => { if (++n === 2) finishMediaDownload('/tmp/d.mp4', '失败') }
    const st = await waitForMediaBytes('/tmp/d.mp4', 900, { timeoutMs: 5000, intervalMs: 1, sleep })
    expect(st!.error).toBe('失败')
    expect(n).toBe(2) // 第二次轮询就返回，未耗尽超时
  })
})
