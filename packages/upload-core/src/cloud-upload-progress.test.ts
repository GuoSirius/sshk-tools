import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudUploadProvider } from './providers/cloud'

/**
 * 大视频上传回归（2026-11-20）：
 * - ali-oss 简单 put 60s ResponseTimeout → 大文件走 multipartUpload（分片 + 5min 超时 + 真实进度）
 * - 进度回调经 ctx.onProgress 逐次上报，供文件选择弹框逐项显示各自进度
 */
const calls: {
  put: { key: string; opts?: Record<string, unknown> }[]
  multipart: { key: string; opts?: Record<string, unknown> }[]
  ctorOpts: Record<string, unknown>[]
} = { put: [], multipart: [], ctorOpts: [] }

vi.mock('ali-oss', () => {
  class FakeOSS {
    constructor(public opts: Record<string, unknown>) {
      calls.ctorOpts.push(opts)
    }
    async put(k: string, _b: Buffer, opts?: Record<string, unknown>): Promise<{ url: string }> {
      calls.put.push({ key: k, opts })
      return { url: `https://oss.test/${k}` }
    }
    async multipartUpload(k: string, _b: Buffer, opts?: Record<string, unknown>): Promise<{ url?: string }> {
      calls.multipart.push({ key: k, opts })
      // 模拟 ali-oss progress(0→0.5→1)，返回体不带 url（版本差异场景）
      const progress = opts?.progress as ((p: number) => void) | undefined
      progress?.(0.5)
      progress?.(1)
      return {}
    }
  }
  return { default: FakeOSS }
})

const base = {
  provider: 'aliyun-oss',
  sdk: 'ali-oss',
  region: 'oss-cn-test',
  bucket: 'bkt',
  accessKeyId: 'ak',
  accessKeySecret: 'sk',
}

function makeProvider(): CloudUploadProvider {
  return new CloudUploadProvider(base)
}

beforeEach(() => {
  calls.put.length = 0
  calls.multipart.length = 0
  calls.ctorOpts.length = 0
})

describe('CloudUploadProvider.aliyun-oss 大文件分片 + 进度', () => {
  it('小文件走简单 put，不触发分片', async () => {
    const r = await makeProvider().upload(
      { name: 'a.png', size: 10, data: new Uint8Array(10) },
      { targetType: 'cloud' },
    )
    expect(calls.put).toHaveLength(1)
    expect(calls.multipart).toHaveLength(0)
    expect(r.url).toContain('a.png')
  })

  it('大文件（>=10MB）走分片，逐次上报 0–100 真实进度，url 走域名兜底', async () => {
    const percent: number[] = []
    const big = new Uint8Array(11 * 1024 * 1024)
    const r = await makeProvider().upload(
      { name: 'big.mp4', size: big.byteLength, data: big },
      { targetType: 'cloud', onProgress: (p) => percent.push(p) },
    )
    expect(calls.put).toHaveLength(0)
    expect(calls.multipart).toHaveLength(1)
    expect(calls.multipart[0]!.opts).toMatchObject({ partSize: 5 * 1024 * 1024, parallel: 4 })
    expect(percent).toEqual([50, 100])
    // multipart 返回体无 url → 按标准 OSS 域名兜底，不因缺 url 报错
    expect(r.url).toBe('https://bkt.oss-oss-cn-test.aliyuncs.com/big.mp4')
  })

  it('OSS 客户端配置 5 分钟超时（默认 60s 会触发大视频 ResponseTimeoutError）', async () => {
    await makeProvider().upload({ name: 'a.png', size: 10, data: new Uint8Array(10) }, { targetType: 'cloud' })
    expect(calls.ctorOpts[0]!.timeout).toBe(5 * 60 * 1000)
    expect(calls.put[0]!.opts).toMatchObject({ timeout: 5 * 60 * 1000 })
  })
})
