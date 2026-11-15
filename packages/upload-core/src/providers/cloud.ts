import { existsSync } from 'node:fs'
import path from 'node:path'
import OSS from 'ali-oss'
import type { UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

/** T5：云 profile（首期阿里云 OSS；其他厂商留抽象扩展点，不预装 SDK） */
export interface CloudProfile {
  provider: string
  region: string
  endpoint?: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  baseUrl?: string
}

export class CloudUploadProvider implements UploadProvider {
  readonly type = 'cloud' as const

  constructor(private readonly profile: CloudProfile) {}

  async upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult> {
    if (this.profile.provider !== 'aliyun-oss') {
      throw new Error(`云 Provider 尚未实现：${this.profile.provider}（首期仅 aliyun-oss，其余留扩展点）`)
    }
    const name = path.basename(file.name)
    const prefix = (ctx.overrides?.prefix ?? '').replace(/^\/+|\/+$/g, '')
    const key = prefix ? `${prefix}/${name}` : name
    const client = new OSS({
      region: this.profile.region,
      endpoint: this.profile.endpoint,
      bucket: ctx.overrides?.bucket ?? this.profile.bucket,
      accessKeyId: this.profile.accessKeyId,
      accessKeySecret: this.profile.accessKeySecret,
    })
    const body = file.source && existsSync(file.source)
      ? file.source
      : Buffer.from(file.data ?? new Uint8Array())
    const result = await client.put(key, body)
    const url = this.profile.baseUrl
      ? `${this.profile.baseUrl.replace(/\/+$/, '')}/${key}`
      : result.url
    return { url, key, name: file.name }
  }
}
