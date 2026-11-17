import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@sshk/shared'
import { CloudFsDriver } from './providers/fs-cloud'

/** 复刻用户现场：Bucket 允许 copy(PutObject) 但拒绝 delete(DeleteObject)。 */
vi.mock('ali-oss', () => {
  class FakeOSS {
    static calls: string[] = []
    constructor(_opts: Record<string, unknown>) {}
    async copy(dest: string, src: string): Promise<void> {
      FakeOSS.calls.push(`copy:${src}->${dest}`)
    }
    async delete(key: string): Promise<void> {
      FakeOSS.calls.push(`delete:${key}`)
      throw Object.assign(new Error('You have no right to access this object because of bucket acl.'), {
        code: 'AccessDenied', status: 403, name: 'AccessDeniedError',
      })
    }
  }
  return { default: FakeOSS }
})

function makeDriver(): CloudFsDriver {
  return new CloudFsDriver({
    provider: 'aliyun-oss', sdk: 'ali-oss', region: 'oss-cn-qingdao',
    bucket: 'elabcnfile', accessKeyId: 'ak', accessKeySecret: 'sk',
  })
}

describe('CloudFsDriver.mv 云 ACL 拒绝删源', () => {
  it('复制已成功时给出「移动未完成」提示，不把裸 SDK 异常抛到 IPC', async () => {
    const sdk = (await import('ali-oss') as unknown as { default: { calls: string[] } }).default
    sdk.calls.length = 0

    const err = await makeDriver().mv('demo/index.html', 'demo/index-new.html').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('permission')
    expect((err as Error).message).toContain('移动未完成')
    expect((err as Error).message).toContain('等同复制成功')
    // 证明顺序：先 copy 后 delete，回滚不了目标写入，所以文案必须说清部分完成
    expect(sdk.calls).toEqual([
      'copy:demo/index.html->demo/index-new.html',
      'delete:demo/index.html',
    ])
  })
})
