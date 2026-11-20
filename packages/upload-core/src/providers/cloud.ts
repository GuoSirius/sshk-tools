import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { byNewestFirst } from '../image-files'
import { isKindFileName, type FileKind } from '@sshk/shared'
import { collectPrefixes, MAX_DIRECTORIES, normalizeDirPath } from '../directories'
import type { UploadedImageInfo, UploadedImagePage, UploadContext, UploadFile, UploadListQuery, UploadProvider, UploadResult } from '../types'
import {
  CLOUD_REQUEST_TIMEOUT,
  ctorOf,
  listCloudPage,
  loadSdk,
  nsOf,
  specOf,
  strOf,
  withScheme,
  collectObjects,
  type CloudPage,
  type CloudProfile,
  type SdkModule,
} from './cloud-sdk'

/**
 * T5 / 复核项 3：云上传 Provider，覆盖常见厂商与 S3 兼容服务。
 *
 * - 厂商清单、SDK 包名、预置地域唯一事实源在 @sshk/shared 的 upload-vendors.ts；
 *   本包不 import shared（保持 main 侧能力包独立），由宿主把 `sdk` 注入 profile。
 * - SDK 懒加载 / 列取原语在 cloud-sdk.ts（X6 F-3 抽取）：与文件系统驱动共用同一份
 *   字面量 import() chunk，避免打包 chunk 漂移。
 * - testConnection() 供「每个 profile 独立测试」按钮做只读连通性探测。
 */
export type { CloudProfile } from './cloud-sdk'

function bodyOf(file: UploadFile): Buffer {
  if (file.source && existsSync(file.source)) return readFileSync(file.source)
  return Buffer.from(file.data ?? new Uint8Array())
}

function keyOf(file: UploadFile, ctx: UploadContext): string {
  const name = path.basename(file.name)
  const prefix = (ctx.overrides?.prefix ?? '').replace(/^\/+|\/+$/g, '')
  return prefix ? `${prefix}/${name}` : name
}

function publicUrl(profile: CloudProfile, key: string, sdkUrl?: string): string {
  const base = profile.baseUrl?.trim().replace(/\/+$/, '')
  if (base) return `${base}/${key}`
  if (sdkUrl) return sdkUrl
  const ep = profile.endpoint ? withScheme(profile.endpoint) : ''
  switch (profile.provider) {
    case 'tencent-cos': return `https://${profile.bucket}.cos.${profile.region}.myqcloud.com/${key}`
    case 'aws-s3': return ep
      ? `${ep}/${profile.bucket}/${key}`
      : `https://${profile.bucket}.s3.${profile.region}.amazonaws.com/${key}`
    case 'huawei-obs': return `${ep}/${profile.bucket}/${key}`
    case 'baidu-bos': return `https://${profile.bucket}.${(profile.endpoint ?? 'bj.bcebos.com').replace(/^https?:\/\//i, '')}/${key}`
    case 'azure-blob': return `${ep}/${profile.bucket}/${key}`
    // ali-oss 的 multipartUpload 返回体可能不带 url（版本差异），按标准 OSS 域名兜底，避免大视频传成功却报「缺访问域名」
    case 'aliyun-oss': return ep
      ? `${ep.replace(/\/+$/, '')}/${key}`
      : `https://${profile.bucket}.oss-${profile.region}.aliyuncs.com/${key}`
    default: return ''
  }
}

interface PutOutcome { url?: string }

/** 分片上传阈值：超过此大小走 ali-oss multipartUpload（单请求不会 60s 超时，且能报真实进度） */
const MULTIPART_THRESHOLD = 10 * 1024 * 1024
/**
 * 单请求超时：优先用 profile 注入的传输设置，缺省回落云 SDK 单一事实源（5min）。
 * 与 fs-cloud.newOss / cloud-sdk.listCloudPage 同口径，杜绝「有的路径吃配置、有的写死」。
 */
function requestTimeoutOf(profile: CloudProfile): number {
  return profile.requestTimeoutMs ?? CLOUD_REQUEST_TIMEOUT
}

async function put(profile: CloudProfile, mod: SdkModule, key: string, body: Buffer, ctx: UploadContext): Promise<PutOutcome> {
  const bucket = ctx.overrides?.bucket || profile.bucket
  const ep = profile.endpoint?.trim() ?? ''
  switch (profile.provider) {
    case 'aliyun-oss': {
      const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
        put(k: string, b: Buffer, opts?: Record<string, unknown>): Promise<{ url: string }>
        multipartUpload(k: string, b: Buffer, opts?: Record<string, unknown>): Promise<{ url?: string }>
        listV2(q: Record<string, unknown>): Promise<unknown>
      }
      const client = new OSS({
        region: profile.region, endpoint: ep || undefined, bucket,
        accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret,
        timeout: requestTimeoutOf(profile),
      })
      if (body.byteLength >= MULTIPART_THRESHOLD) {
        // ali-oss progress(percentage, checkpoint)：percentage 0–1；每片独立请求，避免大文件整体超时
        const r = await client.multipartUpload(key, body, {
          partSize: 5 * 1024 * 1024,
          parallel: 4,
          timeout: requestTimeoutOf(profile),
          progress: (percentage: number) => ctx.onProgress?.(Math.min(100, Math.round(percentage * 100))),
        })
        return { url: r.url }
      }
      const r = await client.put(key, body, { timeout: requestTimeoutOf(profile) })
      return { url: r.url }
    }
    case 'tencent-cos': {
      const COS = ctorOf(mod, ['default', 'COS'], 'cos-nodejs-sdk-v5') as new (o: Record<string, unknown>) => {
        putObject(p: Record<string, unknown>, cb: (e: Error | null, d?: unknown) => void): void
        headBucket(p: Record<string, unknown>, cb: (e: Error | null, d?: unknown) => void): void
      }
      const client = new COS({ SecretId: profile.accessKeyId, SecretKey: profile.accessKeySecret })
      await new Promise<void>((resolve, reject) => {
        client.putObject({ Bucket: bucket, Region: profile.region, Key: key, Body: body }, (e) => e ? reject(e) : resolve())
      })
      return {}
    }
    case 'qiniu': {
      const q = nsOf(mod) as unknown as {
        auth: { digest: { Mac: new (ak: string, sk: string) => unknown } }
        conf: { Config: new (o: Record<string, unknown>) => unknown }
        rs: { PutPolicy: new (o: Record<string, unknown>) => { uploadToken(mac: unknown): string } }
        form_up: {
          FormUploader: new (c: unknown) => {
            put(token: string, k: string, b: Buffer, extra: unknown, cb: (e: Error | null, body: unknown, info: { statusCode: number }) => void): void
          }
        }
        zone: Record<string, unknown>
      }
      const mac = new q.auth.digest.Mac(profile.accessKeyId, profile.accessKeySecret)
      const token = new q.rs.PutPolicy({ scope: bucket }).uploadToken(mac)
      const zoneKey = `Zone_${profile.region || 'z0'}`
      const config = new q.conf.Config({ zone: q.zone[zoneKey] ?? q.zone['Zone_z0'] })
      const uploader = new q.form_up.FormUploader(config)
      await new Promise<void>((resolve, reject) => {
        uploader.put(token, key, body, null, (e, _body, info) => {
          if (e) reject(e)
          else if (info?.statusCode !== 200) reject(new Error(`七牛上传返回 HTTP ${info?.statusCode ?? '?'}`))
          else resolve()
        })
      })
      if (!profile.baseUrl) throw new Error('七牛云必须配置「访问域名」才能生成图片 URL（Kodo 默认域名不固定）')
      return {}
    }
    case 'aws-s3': {
      const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => {
        send(cmd: unknown): Promise<unknown>
      }
      const PutObjectCommand = mod['PutObjectCommand'] as new (o: Record<string, unknown>) => unknown
      const client = new S3Client({
        region: profile.region || 'auto',
        endpoint: ep ? withScheme(ep) : undefined,
        forcePathStyle: Boolean(ep),
        credentials: { accessKeyId: profile.accessKeyId, secretAccessKey: profile.accessKeySecret },
      })
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }))
      return {}
    }
    case 'huawei-obs': {
      const ObsClient = ctorOf(mod, ['default', 'ObsClient'], 'esdk-obs-nodejs') as new (o: Record<string, unknown>) => {
        putObject(p: Record<string, unknown>): Promise<unknown>
        listObjects(p: Record<string, unknown>): Promise<unknown>
      }
      const client = new ObsClient({
        access_key_id: profile.accessKeyId, secret_access_key: profile.accessKeySecret,
        server: withScheme(ep),
      })
      await client.putObject({ Bucket: bucket, Key: key, Body: body })
      return {}
    }
    case 'baidu-bos': {
      const BosClient = ctorOf(mod, ['BosClient', 'default'], 'bce-sdk-js') as new (o: Record<string, unknown>) => {
        putObject(b: string, k: string, data: Buffer): Promise<unknown>
        listObjects(b: string): Promise<unknown>
      }
      const client = new BosClient({
        endpoint: withScheme(ep || 'bj.bcebos.com'),
        credentials: { ak: profile.accessKeyId, sk: profile.accessKeySecret },
      })
      await client.putObject(bucket, key, body)
      return {}
    }
    case 'azure-blob': {
      const BlobServiceClient = mod['BlobServiceClient'] as new (url: string, cred: unknown) => {
        getContainerClient(name: string): {
          getProperties(): Promise<unknown>
          getBlockBlobClient(key: string): { upload(b: Buffer, n: number): Promise<unknown>; url: string }
        }
      }
      const Credential = mod['StorageSharedKeyCredential'] as new (account: string, key: string) => unknown
      const service = new BlobServiceClient(withScheme(ep), new Credential(profile.accessKeyId, profile.accessKeySecret))
      const blob = service.getContainerClient(bucket).getBlockBlobClient(key)
      await blob.upload(body, body.byteLength)
      return { url: blob.url }
    }
    default:
      throw new Error(`不支持的云厂商：${profile.provider}（请在「上传配置」中重新选择）`)
  }
}

async function probe(profile: CloudProfile, mod: SdkModule): Promise<string> {
  const bucket = profile.bucket
  const ep = profile.endpoint?.trim() ?? ''
  switch (profile.provider) {
    case 'aliyun-oss': {
      const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
        listV2(q: Record<string, unknown>): Promise<unknown>
      }
      const client = new OSS({ region: profile.region, endpoint: ep || undefined, bucket, accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret, timeout: requestTimeoutOf(profile) })
      await client.listV2({ 'max-keys': 1 })
      return `阿里云 OSS 连通：bucket ${bucket} 可读`
    }
    case 'tencent-cos': {
      const COS = ctorOf(mod, ['default', 'COS'], 'cos-nodejs-sdk-v5') as new (o: Record<string, unknown>) => {
        headBucket(p: Record<string, unknown>, cb: (e: Error | null) => void): void
      }
      const client = new COS({ SecretId: profile.accessKeyId, SecretKey: profile.accessKeySecret })
      await new Promise<void>((resolve, reject) => client.headBucket({ Bucket: bucket, Region: profile.region }, (e) => e ? reject(e) : resolve()))
      return `腾讯云 COS 连通：bucket ${bucket} 存在且有权限`
    }
    case 'qiniu': {
      const q = nsOf(mod) as unknown as {
        auth: { digest: { Mac: new (ak: string, sk: string) => unknown } }
        conf: { Config: new (o: Record<string, unknown>) => unknown }
        rs: { BucketManager: new (mac: unknown, c: unknown) => {
          listPrefix(b: string, o: Record<string, unknown>, cb: (e: Error | null) => void): void
        } }
        zone: Record<string, unknown>
      }
      const mac = new q.auth.digest.Mac(profile.accessKeyId, profile.accessKeySecret)
      const config = new q.conf.Config({ zone: q.zone[`Zone_${profile.region || 'z0'}`] ?? q.zone['Zone_z0'] })
      const manager = new q.rs.BucketManager(mac, config)
      await new Promise<void>((resolve, reject) => manager.listPrefix(bucket, { limit: 1 }, (e) => e ? reject(e) : resolve()))
      return `七牛云 Kodo 连通：空间 ${bucket} 可列举`
    }
    case 'aws-s3': {
      const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
      const HeadBucketCommand = mod['HeadBucketCommand'] as new (o: Record<string, unknown>) => unknown
      const client = new S3Client({
        region: profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
        credentials: { accessKeyId: profile.accessKeyId, secretAccessKey: profile.accessKeySecret },
      })
      await client.send(new HeadBucketCommand({ Bucket: bucket }))
      return `S3 连通：bucket ${bucket} 存在且有权限`
    }
    case 'huawei-obs': {
      const ObsClient = ctorOf(mod, ['default', 'ObsClient'], 'esdk-obs-nodejs') as new (o: Record<string, unknown>) => {
        listObjects(p: Record<string, unknown>): Promise<unknown>
      }
      const client = new ObsClient({ access_key_id: profile.accessKeyId, secret_access_key: profile.accessKeySecret, server: withScheme(ep) })
      await client.listObjects({ Bucket: bucket, MaxKeys: 1 })
      return `华为云 OBS 连通：桶 ${bucket} 可读`
    }
    case 'baidu-bos': {
      const BosClient = ctorOf(mod, ['BosClient', 'default'], 'bce-sdk-js') as new (o: Record<string, unknown>) => {
        listObjects(b: string): Promise<unknown>
      }
      const client = new BosClient({ endpoint: withScheme(ep || 'bj.bcebos.com'), credentials: { ak: profile.accessKeyId, sk: profile.accessKeySecret } })
      await client.listObjects(bucket)
      return `百度智能云 BOS 连通：bucket ${bucket} 可读`
    }
    case 'azure-blob': {
      const BlobServiceClient = mod['BlobServiceClient'] as new (url: string, cred: unknown) => {
        getContainerClient(name: string): { getProperties(): Promise<unknown> }
      }
      const Credential = mod['StorageSharedKeyCredential'] as new (account: string, key: string) => unknown
      const service = new BlobServiceClient(withScheme(ep), new Credential(profile.accessKeyId, profile.accessKeySecret))
      await service.getContainerClient(bucket).getProperties()
      return `Azure Blob 连通：容器 ${bucket} 存在且有权限`
    }
    default:
      throw new Error(`不支持的云厂商：${profile.provider}`)
  }
}

/**
 * 列图片（跟随翻页）：按 limit 收集，每页走 listCloudPage 续拉游标。
 * 一次调用最多翻 20 页（每页 ≤1000 个），防止异常游标导致死循环；游标未尽时返回 nextCursor 交给调用方续拉。
 */
async function listObjects(
  profile: CloudProfile,
  mod: SdkModule,
  q: { bucket: string; prefix: string; limit: number; cursor?: string | null; kind?: FileKind },
): Promise<{ items: UploadedImageInfo[]; nextCursor: string | null }> {
  const out: UploadedImageInfo[] = []
  let cursor: string | null = q.cursor ?? null
  for (let page = 0; page < 20 && out.length < q.limit; page++) {
    const p = await listCloudPage(profile, mod, {
      bucket: q.bucket,
      prefix: q.prefix,
      pageSize: Math.min(q.limit - out.length, 1000),
      cursor,
      delimiter: false,
    })
    for (const o of collectObjects(p.raw)) {
      const key = strOf(o, ['Key', 'key', 'name'])
      if (!key || !isKindFileName(q.kind ?? 'image', key)) continue
      out.push({
        url: publicUrl(profile, key),
        key,
        name: key.slice(key.lastIndexOf('/') + 1),
        size: Number(strOf(o, ['Size', 'size', 'fsize'])) || 0,
        // 七牛 putTime 是 100ns 单位，其他家是 ISO/时间戳；仅用于排序展示，不做换算
        modified: Number(strOf(o, ['LastModified', 'lastModified', 'putTime']).replace(/[^0-9]/g, '')) || 0,
      })
    }
    cursor = p.nextCursor
    if (!cursor) break
  }
  return { items: out.sort(byNewestFirst), nextCursor: cursor }
}

export class CloudUploadProvider implements UploadProvider {
  readonly type = 'cloud' as const

  constructor(private readonly profile: CloudProfile) {}

  async upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult> {
    const key = keyOf(file, ctx)
    const mod = await loadSdk(specOf(this.profile))
    const outcome = await put(this.profile, mod, key, bodyOf(file), ctx)
    const url = publicUrl(this.profile, key, outcome.url)
    if (!url) throw new Error('该云厂商需要配置「访问域名」才能生成可访问 URL，请在上传配置中补全')
    return { url, key, name: file.name }
  }

  /** N4：只读探测，验证账号密钥 / 地域 / Endpoint / bucket 是否正确，不写任何对象 */
  async testConnection(): Promise<string> {
    const p = this.profile
    if (!p.bucket.trim()) throw new Error('Bucket / 容器 / 空间名不能为空')
    if (!p.accessKeyId.trim() || !p.accessKeySecret.trim()) throw new Error('AccessKey ID / Secret 未配置完整')
    const mod = await loadSdk(specOf(p))
    return await probe(p, mod)
  }

  /** 图库/文件库：按前缀列已有文件（跟随翻页收集）；kind=image（缺省）只列图片，document/code 按白名单，all 全部 */
  async listImages(ctx: UploadListQuery): Promise<UploadedImagePage> {
    const mod = await loadSdk(specOf(this.profile))
    return await listObjects(this.profile, mod, {
      bucket: ctx.overrides?.bucket || this.profile.bucket,
      prefix: (ctx.overrides?.prefix ?? '').replace(/^\/+|\/+$/g, ''),
      limit: ctx.limit ?? 500,
      cursor: ctx.cursor ?? null,
      kind: ctx.kind,
    })
  }

  /** 富文本图片库：列出某前缀下的直接子目录（单级，配合前端懒加载逐级下钻），跟随翻页取全 */
  async listDirectories(ctx: UploadContext): Promise<string[]> {
    const mod = await loadSdk(specOf(this.profile))
    const bucket = ctx.overrides?.bucket || this.profile.bucket
    const base = (ctx.overrides?.prefix ?? '').replace(/^\/+|\/+$/g, '')
    const out = new Set<string>()
    let cursor: string | null = null
    for (let page = 0; page < 20 && out.size < MAX_DIRECTORIES; page++) {
      let p: CloudPage
      try {
        p = await listCloudPage(this.profile, mod, { bucket, prefix: base, pageSize: MAX_DIRECTORIES, cursor, delimiter: true })
      } catch (err) {
        console.warn(`[upload-core] 列云目录失败（prefix=${base || '(根)'}）：${(err as Error).message}`)
        throw err
      }
      for (const full of collectPrefixes(p.raw)) {
        // 单级语义：返回桶根相对的完整前缀（根调用 → 一级目录；深层调用 → 同样是桶根相对路径）
        const rel = normalizeDirPath(full)
        if (rel) out.add(rel)
      }
      cursor = p.nextCursor
      if (!cursor) break
    }
    return [...out].sort((a, b) => a.localeCompare(b))
  }
}
