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
    /** 写测试注入：put 是否抛超时错误（模拟服务端已落盘但 ACK 慢） */
    static putTimeout = false
    /** 写测试注入：超时后 head 是否查得到对象（模拟确实未落盘） */
    static headAfterTimeout: { size: number } | null = null
    /** 记录构造参数，断言 timeout 已配置 */
    static lastOptions: Record<string, unknown> = {}
    constructor(opts: Record<string, unknown>) { FakeOSS.lastOptions = opts }
    async put(key: string, body: Buffer): Promise<void> {
      if (FakeOSS.putTimeout) {
        throw Object.assign(new Error('Response timeout for 60000ms'), { name: 'ResponseTimeoutError' })
      }
      FakeOSS.keys.push({ name: key, size: body.length })
    }
    async head(key: string): Promise<{ res: { headers: Record<string, string> } }> {
      if (FakeOSS.headAfterTimeout) {
        return { res: { headers: { 'content-length': String(FakeOSS.headAfterTimeout.size) } } }
      }
      const found = FakeOSS.keys.find((k) => k.name === key)
      if (!found) throw new Error('NotFound')
      return { res: { headers: { 'content-length': String(found.size) } } }
    }
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

describe('CloudFsDriver.write 超时幂等复核（2026-11-20 根治「文件已在却报失败」）', () => {
  it('OSS 客户端构造必须带 5 分钟 timeout（不再用默认 60s）', async () => {
    const s = (await import('ali-oss') as unknown as { default: { lastOptions: Record<string, unknown> } }).default
    await makeDriver('ak-timeout-opt').stat('/probe')
    expect(s.lastOptions.timeout).toBe(5 * 60 * 1000)
  })

  it('传输设置的自定义超时（requestTimeoutMs）注入客户端', async () => {
    const s = (await import('ali-oss') as unknown as { default: { lastOptions: Record<string, unknown> } }).default
    const driver = new CloudFsDriver({
      provider: 'aliyun-oss', sdk: 'ali-oss', region: 'oss-cn-qingdao',
      bucket: 'elabcnfile', accessKeyId: 'ak', accessKeySecret: 'sk',
      requestTimeoutMs: 600_000, // 用户把请求超时调到 10 分钟
    })
    await driver.stat('/probe')
    expect(s.lastOptions.timeout).toBe(600_000)
  })

  it('put 抛超时但服务端已落盘且大小一致 → 判成功不抛错', async () => {
    const s = (await import('ali-oss') as unknown as { default: { putTimeout: boolean; headAfterTimeout: { size: number } | null } }).default
    s.putTimeout = true
    s.headAfterTimeout = { size: 8 }
    try {
      await expect(makeDriver('ak-time-ok').write('/timeout/synced.bin', Buffer.from('12345678'))).resolves.toBeUndefined()
    } finally {
      s.putTimeout = false
      s.headAfterTimeout = null
    }
  })

  it('put 抛超时且对象未落盘（head 大小不符）→ 照常抛超时错误', async () => {
    const s = (await import('ali-oss') as unknown as { default: { putTimeout: boolean; headAfterTimeout: { size: number } | null } }).default
    s.putTimeout = true
    s.headAfterTimeout = { size: 99 } // 大小不一致，说明不是本次内容
    try {
      const err = await makeDriver('ak-time-fail').write('/timeout/lost.bin', Buffer.from('12345678')).catch((e: unknown) => e)
      expect(err).toBeTruthy()
      expect((err as Error).name).toBe('ResponseTimeoutError')
    } finally {
      s.putTimeout = false
      s.headAfterTimeout = null
    }
  })

  it('正常 put（无超时）成功落盘', async () => {
    const s = (await import('ali-oss') as unknown as { default: { putTimeout: boolean; headAfterTimeout: { size: number } | null } }).default
    s.putTimeout = false
    s.headAfterTimeout = null
    await expect(makeDriver('ak-normal').write('/normal.bin', Buffer.from('ok'))).resolves.toBeUndefined()
  })
})
