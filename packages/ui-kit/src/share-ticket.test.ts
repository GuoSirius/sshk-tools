import { afterEach, describe, expect, it, vi } from 'vitest'
import { findShareTicketById, readShareTicket, shareDialogStorageKey, shareFileDirectUrl } from './share-ticket'

/** 简易 localStorage mock（Node 环境无 DOM） */
function mockStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const ls = {
    get length() { return store.size },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', ls)
  return store
}

afterEach(() => vi.unstubAllGlobals())

const ticket = (id: string, url: string) => ({ id, token: `tok-${id}`, urls: [url], expiresAt: Date.now() + 3600_000 })

describe('分享凭证按 id 反查', () => {
  it('entry 带/不带前导斜杠都能按 id 命中（修复四元组哈希对不上的误报失效）', () => {
    const store = mockStorage()
    // 创建时 entry 用带前导 / 的路径，route.entry 被内核 strip 成无前导 /
    const createEntry = '/photos/a.jpg'
    const routeEntry = 'photos/a.jpg'
    store.set(shareDialogStorageKey('upload-manager', '文件：a.jpg', '/root', createEntry), JSON.stringify(ticket('r-1', 'http://x/s/tok-1')))
    // 旧做法：用 route.entry 反推键 → 取不到
    expect(readShareTicket('upload-manager', '文件：a.jpg', '/root', routeEntry)).toBeNull()
    // 新做法：按 id 反查 → 命中
    expect(findShareTicketById('r-1')?.urls[0]).toBe('http://x/s/tok-1')
  })

  it('文件直达 URL：base 去尾斜杠 + 相对 root 路径逐段编码', () => {
    expect(shareFileDirectUrl('http://192.168.1.5:8787/abc/', '/photos/子目录/a b.jpg'))
      .toBe('http://192.168.1.5:8787/abc/photos/%E5%AD%90%E7%9B%AE%E5%BD%95/a%20b.jpg')
    expect(shareFileDirectUrl('http://x/t/', 'a/b.txt')).toBe('http://x/t/a/b.txt')
    expect(shareFileDirectUrl('http://x/t/', '')).toBe('http://x/t')
  })

  it('多条凭证中精确匹配目标 id，跳过损坏键', () => {
    const store = mockStorage()
    store.set('sshk:share-dialog:aaa', 'not-json')
    store.set(shareDialogStorageKey('upload-manager', '文件：b', '/r', 'b'), JSON.stringify(ticket('r-2', 'http://x/tok-2')))
    store.set(shareDialogStorageKey('upload-manager', '文件：c', '/r', 'c'), JSON.stringify(ticket('r-3', 'http://x/tok-3')))
    expect(findShareTicketById('r-3')?.urls[0]).toBe('http://x/tok-3')
    expect(findShareTicketById('r-2')?.urls[0]).toBe('http://x/tok-2')
    expect(findShareTicketById('missing')).toBeNull()
    expect(findShareTicketById('')).toBeNull()
  })
})
