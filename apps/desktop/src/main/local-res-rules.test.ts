import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { collectResRoots, isAllowedResPath } from './local-res-rules'

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
    expect(roots).toHaveLength(2) // 全局与 edm 覆盖相同 → 去重
    expect(collectResRoots(fakeConfig({}))).toEqual([])
  })

  it('collectResRoots：损坏配置不抛错（忽略该项）', () => {
    const roots = collectResRoots(fakeConfig({ 'app.upload': 'garbage' }))
    expect(roots).toEqual([])
  })

  it('isAllowedResPath：根内放行、根外拒绝、扩展名白名单', () => {
    const roots = [win('D:/upload')]
    expect(isAllowedResPath(win('D:/upload/a.png'), roots)).toBe(true)
    expect(isAllowedResPath(win('D:/upload/sub/b.webp'), roots)).toBe(true)
    expect(isAllowedResPath(win('D:/upload-backup/a.png'), roots)).toBe(false) // 前缀陷阱：非同目录段
    expect(isAllowedResPath(win('D:/upload/a.exe'), roots)).toBe(false) // 非图片扩展名
    expect(isAllowedResPath(win('D:/upload/a'), roots)).toBe(false) // 无扩展名
  })
})
