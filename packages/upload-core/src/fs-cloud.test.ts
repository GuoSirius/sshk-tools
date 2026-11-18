import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@sshk/shared'
import { CloudFsDriver } from './providers/fs-cloud'

/** 复刻用户现场：Bucket 允许 copy(PutObject) 但拒绝 delete(DeleteObject)。 */
vi.mock('ali-oss', () => {
  class FakeOSS {
    static calls: string[] = []
    /** denyDelete=false 时放行 delete（探测/删除均成功），用于探测通过后的完整移动链路 */
    static denyDelete = true
    /** 模拟 bucket 内容：demo 目录 1 个文件，另有 demo-2 / demo备份 两个同名字头兄弟目录 */
    static keys: Array<{ name: string; size: number }> = [
      { name: 'demo/index.html', size: 33 },
      { name: 'demo-2/index.html', size: 33 },
      { name: 'demo-2/extra.txt', size: 10 },
      { name: 'demo备份/x.html', size: 5 },
    ]
    constructor(_opts: Record<string, unknown>) {}
    async copy(dest: string, src: string): Promise<void> {
      FakeOSS.calls.push(`copy:${src}->${dest}`)
    }
    async delete(key: string): Promise<void> {
      FakeOSS.calls.push(`delete:${key}`)
      if (FakeOSS.denyDelete) {
        throw Object.assign(new Error('You have no right to access this object because of bucket acl.'), {
          code: 'AccessDenied', status: 403, name: 'AccessDeniedError',
        })
      }
    }
    async listV2(q: Record<string, unknown>): Promise<unknown> {
      FakeOSS.calls.push(`listV2:${String(q.prefix)}|delim:${String(q.delimiter)}`)
      const prefix = String(q.prefix ?? '')
      const objects = FakeOSS.keys
        .filter((k) => !prefix || k.name.startsWith(prefix))
        .map((k) => ({ name: k.name, size: k.size }))
      return { objects, isTruncated: false }
    }
  }
  return { default: FakeOSS }
})

function makeDriver(accessKeyId = 'ak'): CloudFsDriver {
  return new CloudFsDriver({
    provider: 'aliyun-oss', sdk: 'ali-oss', region: 'oss-cn-qingdao',
    bucket: 'elabcnfile', accessKeyId, accessKeySecret: 'sk',
  })
}

describe('CloudFsDriver.mv 云 ACL 拒绝删源', () => {
  it('删除权限预检：无权限直接拒绝，不产生任何复制（copy+delete 不再半程执行）', async () => {
    const sdk = (await import('ali-oss') as unknown as { default: { calls: string[]; denyDelete: boolean } }).default
    sdk.calls.length = 0

    const err = await makeDriver('ak-denied').mv('demo/index.html', 'demo/index-new.html').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('permission')
    expect((err as Error).message).toContain('已取消')
    expect((err as Error).message).toContain('没有删除权限')
    // 只应有权限探测的 delete 调用，绝不能出现 copy（源文件原样保留）
    expect(sdk.calls.every((c) => c.startsWith('delete:.sshk-probe/'))).toBe(true)
  })

  it('权限放行时探测在前、复制次之、删源最后（文件级原子化）', async () => {
    const sdk = (await import('ali-oss') as unknown as { default: { calls: string[]; denyDelete: boolean } }).default
    sdk.calls.length = 0
    sdk.denyDelete = false

    await makeDriver('ak-ok').mv('demo/index.html', 'demo/index-new.html')
    expect(sdk.calls[0]!.startsWith('delete:.sshk-probe/')).toBe(true)
    expect(sdk.calls[1]).toBe('copy:demo/index.html->demo/index-new.html')
    expect(sdk.calls[2]).toBe('delete:demo/index.html')
  })

  it('目录容量统计前缀必须带尾斜杠：不把 demo-2 / demo备份 的文件算进来', async () => {
    const sdk = (await import('ali-oss') as unknown as { default: { calls: string[]; denyDelete: boolean } }).default
    sdk.calls.length = 0
    sdk.denyDelete = false

    const r = await makeDriver('ak-usage').usage('demo')
    expect(r).toEqual({ size: 33, files: 1, truncated: false })
    expect(sdk.calls).toContain('listV2:demo/|delim:undefined')
  })

  it('递归搜索同前缀约束且包含子目录文件：根搜索命中三个目录里的 html', async () => {
    const sdk = (await import('ali-oss') as unknown as { default: { calls: string[]; denyDelete: boolean } }).default
    sdk.calls.length = 0
    sdk.denyDelete = false

    const driver = makeDriver('ak-search')
    const inDemo = await driver.search('demo', 'html')
    expect(inDemo.entries.map((e) => e.path)).toEqual(['/demo/index.html'])

    const whole = await driver.search('', 'html')
    expect(whole.entries.map((e) => e.path)).toEqual(['/demo/index.html', '/demo-2/index.html', '/demo备份/x.html'])
    expect(whole.entries.map((e) => e.name)).toEqual(['index.html', 'index.html', 'x.html'])
  })
})
