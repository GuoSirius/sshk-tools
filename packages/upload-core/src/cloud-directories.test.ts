import { describe, expect, it, vi } from 'vitest'
import { CloudUploadProvider } from './providers/cloud'

/**
 * 云列目录多级展开的实证测试：mock ali-oss，按 prefix 返回嵌套 CommonPrefixes，
 * 跑真实的 listDirectories 全路径（loadSdk → listPrefixesRaw → collectPrefixes → BFS）。
 * 目录树：根 → {blog → {2026 → 06, 2025}, news（空目录）}。
 */
const TREE: Record<string, string[]> = {
  '': ['blog/', 'news/'],
  blog: ['blog/2026/', 'blog/2025/'],
  'blog/2026': ['blog/2026/06/'],
  'blog/2025': [],
  news: [],
}

vi.mock('ali-oss', () => {
  class FakeOSS {
    static calls: string[] = []
    constructor(public opts: Record<string, unknown>) {}
    async listV2(q: { prefix?: string; delimiter?: string; 'max-keys'?: number }): Promise<unknown> {
      FakeOSS.calls.push(q.prefix ?? '')
      const key = (q.prefix ?? '').replace(/\/+$/, '')
      return { objects: [], prefixes: TREE[key] ?? [], isTruncated: false }
    }
  }
  return { default: FakeOSS }
})

function makeProvider(): CloudUploadProvider {
  return new CloudUploadProvider({
    provider: 'aliyun-oss',
    sdk: 'ali-oss',
    region: 'oss-cn-test',
    bucket: 'bkt',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
  })
}

describe('CloudUploadProvider.listDirectories 多级展开（mock ali-oss 实证）', () => {
  it('从根逐级 BFS，列出全部多级目录与空目录', async () => {
    const dirs = await makeProvider().listDirectories({ targetType: 'cloud', overrides: { bucket: 'bkt' } })
    expect(dirs).toEqual(['blog', 'blog/2025', 'blog/2026', 'blog/2026/06', 'news'])
    // 递归确实发生了：根 + blog + blog/2026 + news 各一次（blog/2025 是空目录也查了）
    const calls = (await import('ali-oss') as unknown as { default: { calls: string[] } }).default.calls
    expect(calls).toContain('')
    expect(calls).toContain('blog')
    expect(calls).toContain('blog/2026')
  })

  it('带 base prefix 时相对路径正确', async () => {
    const dirs = await makeProvider().listDirectories({
      targetType: 'cloud',
      overrides: { bucket: 'bkt', prefix: 'blog' },
    })
    expect(dirs).toEqual(['2025', '2026', '2026/06'])
  })
})
