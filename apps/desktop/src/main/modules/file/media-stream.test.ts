import { describe, expect, it, beforeEach } from 'vitest'
import {
  beginMediaDownload,
  finishMediaDownload,
  getMediaDownload,
  isMediaStreaming,
  removeMediaDownload,
  resetMediaDownloads,
  updateMediaDownload,
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
})
