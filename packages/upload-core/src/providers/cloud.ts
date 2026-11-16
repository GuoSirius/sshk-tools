import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { byNewestFirst, isImageFileName } from '../image-files'
import type { UploadedImageInfo, UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

/**
 * T5 / 复核项 3：云上传 Provider，覆盖常见厂商与 S3 兼容服务。
 *
 * - 厂商清单、SDK 包名、预置地域唯一事实源在 @sshk/shared 的 upload-vendors.ts；
 *   本包不 import shared（保持 main 侧能力包独立），由宿主把 `sdk` 注入 profile。
 * - SDK 一律用字面量 import() 做代码分割：每家一个懒加载 chunk，不拖慢启动；
 *   chunk 落在 out/main/ 随安装包分发，安装包排除 node_modules 也照样可用。
 * - testConnection() 供「每个 profile 独立测试」按钮做只读连通性探测。
 */
export interface CloudProfile {
  provider: string
  /** npm 包名（宿主从厂商目录注入）；省略时按 provider 回退推导 */
  sdk?: string
  region: string
  endpoint?: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  baseUrl?: string
}

type SdkModule = Record<string, unknown>

const SDK_FALLBACK: Record<string, string> = {
  'aliyun-oss': 'ali-oss',
  'tencent-cos': 'cos-nodejs-sdk-v5',
  qiniu: 'qiniu',
  'aws-s3': '@aws-sdk/client-s3',
  'huawei-obs': 'esdk-obs-nodejs',
  'baidu-bos': 'bce-sdk-js',
  'azure-blob': '@azure/storage-blob',
}

function specOf(profile: CloudProfile): string {
  return profile.sdk || SDK_FALLBACK[profile.provider] || ''
}

async function importSdk(spec: string): Promise<unknown> {
  switch (spec) {
    case 'ali-oss': return import('ali-oss')
    case 'cos-nodejs-sdk-v5': return import('cos-nodejs-sdk-v5')
    case 'qiniu': return import('qiniu')
    case '@aws-sdk/client-s3': return import('@aws-sdk/client-s3')
    case 'esdk-obs-nodejs': return import('esdk-obs-nodejs')
    case 'bce-sdk-js': return import('bce-sdk-js')
    case '@azure/storage-blob': return import('@azure/storage-blob')
    default: throw new Error(`云 SDK 未就绪（未知包名 ${spec}）：请检查上传配置或执行 pnpm install`)
  }
}

/**
 * 字面量 import()：构建器为每个 SDK 生成独立 chunk（懒加载，不拖慢启动），
 * 且 chunk 位于 out/main/ 随安装包分发 —— 安装包排除 node_modules 也照样可用。
 * 绝不能改成变量 spec，否则 rolldown 不解析，打包版运行时会找不到包。
 */
async function loadSdk(spec: string): Promise<SdkModule> {
  if (!spec) throw new Error('未知的云厂商：请检查上传配置中的「云厂商」选项')
  let loaded: unknown
  try {
    try {
      loaded = await importSdk(spec)
    } catch (err) {
      // dev 热重载竞态：主进程重建会清空 chunks/ 并换内容 hash，仍在运行的旧进程
      // 懒加载引用旧 hash 会 ERR_MODULE_NOT_FOUND。短等一次让重建完成后再试；
      // 仍失败说明进程持有旧代码，只能重启 dev（错误信息里给指引）。
      if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(String((err as Error).message))) {
        await new Promise((r) => setTimeout(r, 1200))
        loaded = await importSdk(spec)
      } else {
        throw err
      }
    }
    const ns = (loaded as { default?: unknown }).default ?? loaded
    return (typeof ns === 'object' && ns !== null ? ns : loaded) as unknown as SdkModule
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    const stale = /Cannot find module/i.test(msg)
      ? '——主进程刚重编译过，懒加载 chunk 引用已失效，重启 pnpm dev 即可恢复'
      : ''
    throw new Error(`云 SDK 未就绪（${spec}）：${msg}${stale}`)
  }
}

/** CJS 包被 ESM import 后构造函数可能在 default 或命名导出上 */
function ctorOf(mod: SdkModule, names: string[], spec: string): unknown {
  for (const n of names) {
    const v = n === 'default' ? mod['default'] : mod[n]
    if (typeof v === 'function') return v
  }
  throw new Error(`云 SDK ${spec} 形态异常：未找到 ${names.join(' / ')} 构造函数`)
}

function nsOf(mod: SdkModule): SdkModule {
  const d = mod['default']
  return (typeof d === 'object' && d !== null ? d : mod) as SdkModule
}

function withScheme(host: string): string {
  const h = host.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(h) ? h : `https://${h}`
}

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
    default: return ''
  }
}

interface PutOutcome { url?: string }

/**
 * 各云 SDK 返回结构差异极大（Contents/contents/items/objects、大小写不一、
 * OBS 还多包一层 InterfaceResult），这里做深度兜底解析：浅层常见字段优先，
 * 否则按任意键名向下找「对象数组」，避免逐家写死猜错层级。
 */
function collectObjects(res: unknown, depth = 0): Record<string, unknown>[] {
  if (!res || typeof res !== 'object' || depth > 4) return []
  const r = res as Record<string, unknown>
  for (const k of ['objects', 'items', 'Contents', 'contents']) {
    const v = r[k]
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      return v as Record<string, unknown>[]
    }
  }
  for (const v of Object.values(r)) {
    const found = collectObjects(v, depth + 1)
    if (found.length > 0) return found
  }
  return []
}

function strOf(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

async function listObjects(
  profile: CloudProfile,
  mod: SdkModule,
  q: { bucket: string; prefix: string; limit: number },
): Promise<UploadedImageInfo[]> {
  const ep = profile.endpoint?.trim() ?? ''
  let raw: unknown
  switch (profile.provider) {
    case 'aliyun-oss': {
      const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
        listV2(q: Record<string, unknown>): Promise<unknown>
      }
      const client = new OSS({ region: profile.region, endpoint: ep || undefined, bucket: q.bucket, accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret })
      raw = await client.listV2({ 'max-keys': q.limit, prefix: q.prefix || undefined })
      break
    }
    case 'tencent-cos': {
      const COS = ctorOf(mod, ['default', 'COS'], 'cos-nodejs-sdk-v5') as new (o: Record<string, unknown>) => {
        listObjects(p: Record<string, unknown>, cb: (e: Error | null, d?: unknown) => void): void
      }
      const client = new COS({ SecretId: profile.accessKeyId, SecretKey: profile.accessKeySecret })
      raw = await new Promise((resolve, reject) => {
        client.listObjects({ Bucket: q.bucket, Region: profile.region, Prefix: q.prefix || undefined, MaxKeys: q.limit }, (e, d) => e ? reject(e) : resolve(d))
      })
      break
    }
    case 'qiniu': {
      const qn = nsOf(mod) as unknown as {
        auth: { digest: { Mac: new (ak: string, sk: string) => unknown } }
        conf: { Config: new (o: Record<string, unknown>) => unknown }
        rs: { BucketManager: new (mac: unknown, c: unknown) => { listPrefix(b: string, o: Record<string, unknown>, cb: (e: Error | null, d?: unknown) => void): void } }
        zone: Record<string, unknown>
      }
      const mac = new qn.auth.digest.Mac(profile.accessKeyId, profile.accessKeySecret)
      const config = new qn.conf.Config({ zone: qn.zone[`Zone_${profile.region || 'z0'}`] ?? qn.zone['Zone_z0'] })
      const manager = new qn.rs.BucketManager(mac, config)
      raw = await new Promise((resolve, reject) => {
        manager.listPrefix(q.bucket, { prefix: q.prefix || undefined, limit: q.limit }, (e, d) => e ? reject(e) : resolve(d))
      })
      break
    }
    case 'aws-s3': {
      const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
      const ListCommand = mod['ListObjectsV2Command'] as new (o: Record<string, unknown>) => unknown
      const client = new S3Client({
        region: profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
        credentials: { accessKeyId: profile.accessKeyId, secretAccessKey: profile.accessKeySecret },
      })
      raw = await client.send(new ListCommand({ Bucket: q.bucket, Prefix: q.prefix || undefined, MaxKeys: q.limit }))
      break
    }
    case 'huawei-obs': {
      const ObsClient = ctorOf(mod, ['default', 'ObsClient'], 'esdk-obs-nodejs') as new (o: Record<string, unknown>) => {
        listObjects(p: Record<string, unknown>): Promise<unknown>
      }
      const client = new ObsClient({ access_key_id: profile.accessKeyId, secret_access_key: profile.accessKeySecret, server: withScheme(ep) })
      raw = await client.listObjects({ Bucket: q.bucket, Prefix: q.prefix || undefined, MaxKeys: q.limit })
      break
    }
    case 'baidu-bos': {
      const BosClient = ctorOf(mod, ['BosClient', 'default'], 'bce-sdk-js') as new (o: Record<string, unknown>) => {
        listObjects(b: string, o?: Record<string, unknown>): Promise<unknown>
      }
      const client = new BosClient({ endpoint: withScheme(ep || 'bj.bcebos.com'), credentials: { ak: profile.accessKeyId, sk: profile.accessKeySecret } })
      raw = await client.listObjects(q.bucket, { prefix: q.prefix || undefined, limit: q.limit })
      break
    }
    case 'azure-blob': {
      const BlobServiceClient = mod['BlobServiceClient'] as new (url: string, cred: unknown) => {
        getContainerClient(name: string): {
          listBlobsFlat(o: Record<string, unknown>): { byPage(o: Record<string, unknown>): { next(): Promise<unknown> } }
        }
      }
      const Credential = mod['StorageSharedKeyCredential'] as new (account: string, key: string) => unknown
      const service = new BlobServiceClient(withScheme(ep), new Credential(profile.accessKeyId, profile.accessKeySecret))
      const page = (await service
        .getContainerClient(q.bucket)
        .listBlobsFlat({ prefix: q.prefix || undefined, includeDeleted: false })
        .byPage({ pageSize: q.limit })
        .next()) as { value?: { blobs?: Record<string, unknown>[] } }
      const blobs = (page.value?.blobs ?? []) as Record<string, unknown>[]
      // Azure 字段嵌在 properties 里，先摊平成 key/size/modified 再走统一解析
      raw = {
        contents: blobs.map((b) => ({
          Key: String(b['name'] ?? ''),
          Size: (b['properties'] as Record<string, unknown> | undefined)?.['contentLength'],
          LastModified: (b['properties'] as Record<string, unknown> | undefined)?.['lastModified'],
        })),
      }
      break
    }
    default:
      throw new Error(`不支持的云厂商：${profile.provider}`)
  }
  const limit = q.limit
  const out: UploadedImageInfo[] = []
  for (const o of collectObjects(raw)) {
    const key = strOf(o, ['Key', 'key', 'name'])
    if (!key || !isImageFileName(key)) continue
    out.push({
      url: publicUrl(profile, key),
      key,
      name: key.slice(key.lastIndexOf('/') + 1),
      size: Number(strOf(o, ['Size', 'size', 'fsize'])) || 0,
      // 七牛 putTime 是 100ns 单位，其他家是 ISO/时间戳；仅用于排序展示，不做换算
      modified: Number(strOf(o, ['LastModified', 'lastModified', 'putTime']).replace(/[^0-9]/g, '')) || 0,
    })
  }
  return out.sort(byNewestFirst).slice(0, limit)
}

async function put(profile: CloudProfile, mod: SdkModule, key: string, body: Buffer, ctx: UploadContext): Promise<PutOutcome> {
  const bucket = ctx.overrides?.bucket || profile.bucket
  const ep = profile.endpoint?.trim() ?? ''
  switch (profile.provider) {
    case 'aliyun-oss': {
      const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
        put(k: string, b: Buffer): Promise<{ url: string }>
        listV2(q: Record<string, unknown>): Promise<unknown>
      }
      const client = new OSS({
        region: profile.region, endpoint: ep || undefined, bucket,
        accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret,
      })
      return { url: (await client.put(key, body)).url }
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
      const client = new OSS({ region: profile.region, endpoint: ep || undefined, bucket, accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret })
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

  /** 富文本图片库：列出 bucket（可被 overrides.bucket / overrides.prefix 覆盖）下已有图片 */
  async listImages(ctx: UploadContext & { limit?: number }): Promise<UploadedImageInfo[]> {
    const mod = await loadSdk(specOf(this.profile))
    return await listObjects(this.profile, mod, {
      bucket: ctx.overrides?.bucket || this.profile.bucket,
      prefix: (ctx.overrides?.prefix ?? '').replace(/^\/+|\/+$/g, ''),
      limit: ctx.limit ?? 200,
    })
  }
}
