import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { collectResRoots, isAllowedResPath, MEDIA_TMP_DIR, parseByteRange } from './local-res-rules'

/** 模拟配置读取：app.upload 全局 + tools.<id>.upload 覆盖 */
function fakeConfig(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] }
}

describe('localres 白名单（local-res-rules）', () => {
  const win = (p: string): string => path.resolve(p)

  it('collectResRoots：全局目录 + 工具覆盖目录，去重；无配置返回空', () => {
    const cfg = fakeConfig({
      'app.upload': { local: { defaultDir: 'D:/upload' } },
      'tools.edm-studio.upload': { overrides: { localDir: 'D:/upload' } },
      'tools.badge-studio.upload': { overrides: { localDir: 'D:/upload-badge' } },
    })
    const roots = collectResRoots(cfg)
    expect(roots).toContain(win('D:/upload'))
    expect(roots).toContain(win('D:/upload-badge'))
    expect(roots).toContain(MEDIA_TMP_DIR) // 媒体临时目录固定加入
    expect(roots).toHaveLength(3) // 全局与 edm 覆盖相同 → 去重；+ 媒体目录
    expect(collectResRoots(fakeConfig({}))).toEqual([MEDIA_TMP_DIR])
  })

  it('collectResRoots：损坏配置不抛错（忽略该项）', () => {
    const roots = collectResRoots(fakeConfig({ 'app.upload': 'garbage' }))
    expect(roots).toEqual([MEDIA_TMP_DIR])
  })

  it('isAllowedResPath：根内放行、根外拒绝、扩展名白名单', () => {
    const roots = [win('D:/upload')]
    expect(isAllowedResPath(win('D:/upload/a.png'), roots)).toBe(true)
    expect(isAllowedResPath(win('D:/upload/sub/b.webp'), roots)).toBe(true)
    expect(isAllowedResPath(win('D:/upload-backup/a.png'), roots)).toBe(false) // 前缀陷阱：非同目录段
    expect(isAllowedResPath(win('D:/upload/a.exe'), roots)).toBe(false) // 非白名单扩展名
    expect(isAllowedResPath(win('D:/upload/a'), roots)).toBe(false) // 无扩展名
  })

  it('isAllowedResPath：媒体临时目录放行音视频，不放行其它目录的视频', () => {
    expect(isAllowedResPath(path.join(MEDIA_TMP_DIR, 'abc123.mp4'), [MEDIA_TMP_DIR])).toBe(true)
    expect(isAllowedResPath(path.join(MEDIA_TMP_DIR, 'abc123.mp3'), [MEDIA_TMP_DIR])).toBe(true)
    expect(isAllowedResPath(path.join(MEDIA_TMP_DIR, 'abc123.exe'), [MEDIA_TMP_DIR])).toBe(false)
    expect(isAllowedResPath(win('D:/other/steal.mp4'), [MEDIA_TMP_DIR])).toBe(false) // 临时目录外的视频拒绝
  })

  it('parseByteRange：start-end / start- / -suffix / 非法 / 越界', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseByteRange('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 }) // 越界钳制
    expect(parseByteRange(null, 1000)).toBeNull()
    expect(parseByteRange('bytes=-', 1000)).toBeNull()
    expect(parseByteRange('garbage', 1000)).toBeNull()
    expect(parseByteRange('bytes=0-99', 0)).toBeNull()
  })
})
