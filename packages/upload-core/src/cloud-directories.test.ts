import { describe, expect, it, vi } from 'vitest'
import { CloudUploadProvider } from './providers/cloud'

/**
 * 云列目录的实证测试（mock ali-oss）：delimiter 列举，prefix 无尾斜杠会返回「目录自身」
 * 而非子级（真实 OSS 行为）；listCloudPage 对非空前缀补尾斜杠后单级列取正常。
 * 语义（2026-11-17 定版）：listDirectories 单级返回直接子目录、桶根相对路径；多级下钻由前端懒加载逐级发起。
 */
const TREE: Record<string, string[]> = {
  '': ['blog/', 'news/'],
  blog: ['blog/2026/', 'blog/2025/'],
  'blog/2026': ['blog/2026/06/'],
}

vi.mock('ali-oss', () => {
  class FakeOSS {
    static calls: string[] = []
    constructor(public opts: Record<string, unknown>) {}
    async listV2(q: { prefix?: string; delimiter?: string; 'max-keys'?: number }): Promise<unknown> {
      FakeOSS.calls.push(q.prefix ?? '')
      const raw = q.prefix ?? ''
      // 复刻 OSS 真实行为：delimiter 列举时 prefix 无尾斜杠会返回「目录自身」而非子级
      if (raw && !raw.endsWith('/')) return { objects: [], prefixes: [`${raw}/`], isTruncated: false }
      const key = raw.replace(/\/+$/, '')
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

describe('CloudUploadProvider.listDirectories 单级列取（mock ali-oss 实证）', () => {
  it('从根列出一级目录（桶根相对路径，无尾斜杠）', async () => {
    const dirs = await makeProvider().listDirectories({ targetType: 'cloud', overrides: { bucket: 'bkt' } })
    expect(dirs).toEqual(['blog', 'news'])
    // delimiter 列子目录带尾斜杠（OSS/S3 系无尾斜杠只会返回目录自身，列不出子级）
    const calls = (await import('ali-oss') as unknown as { default: { calls: string[] } }).default.calls
    expect(calls).toContain('')
  })

  it('带 base prefix 时返回该级直接子目录，仍是桶根相对路径', async () => {
    const dirs = await makeProvider().listDirectories({
      targetType: 'cloud',
      overrides: { bucket: 'bkt', prefix: 'blog' },
    })
    expect(dirs).toEqual(['blog/2025', 'blog/2026'])
    const calls = (await import('ali-oss') as unknown as { default: { calls: string[] } }).default.calls
    expect(calls).toContain('blog/')
  })
})
