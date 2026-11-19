/**
 * 云 SDK 公共底座（X6 F-3 抽取）：文件系统驱动（fs-cloud.ts）与上传 Provider（cloud.ts）
 * 共用同一套 SDK 懒加载与列取原语，避免两个模块各写一份字面量 import() 导致 chunk 漂移。
 * 字面量 import() 绝不能改成变量 spec —— 否则构建器不解析，打包版运行时找不到 chunk。
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

export type SdkModule = Record<string, unknown>

export const SDK_FALLBACK: Record<string, string> = {
  'aliyun-oss': 'ali-oss',
  'tencent-cos': 'cos-nodejs-sdk-v5',
  qiniu: 'qiniu',
  'aws-s3': '@aws-sdk/client-s3',
  'huawei-obs': 'esdk-obs-nodejs',
  'baidu-bos': 'bce-sdk-js',
  'azure-blob': '@azure/storage-blob',
}

export function specOf(profile: CloudProfile): string {
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
 */
export async function loadSdk(spec: string): Promise<SdkModule> {
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
export function ctorOf(mod: SdkModule, names: string[], spec: string): unknown {
  for (const n of names) {
    const v = n === 'default' ? mod['default'] : mod[n]
    if (typeof v === 'function') return v
  }
  throw new Error(`云 SDK ${spec} 形态异常：未找到 ${names.join(' / ')} 构造函数`)
}

export function nsOf(mod: SdkModule): SdkModule {
  const d = mod['default']
  return (typeof d === 'object' && d !== null ? d : mod) as SdkModule
}

export function withScheme(host: string): string {
  const h = host.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(h) ? h : `https://${h}`
}

/** 云 SDK 请求超时兜底（2026-11-19 用户实测：本地切云偶发列目录永久挂起——SDK 请求无超时，
 *  连接僵死时永不 resolve，界面永远转圈且刷新也挂）。超时后 reject，刷新会新建客户端重连。 */
export async function withCloudTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label}：请求超过 ${Math.round(ms / 1000)}s 无响应，请刷新重试`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 各云 SDK 返回结构差异极大（Contents/contents/items/objects、大小写不一、
 * OBS 还多包一层 InterfaceResult），这里做深度兜底解析：浅层常见字段优先，
 * 否则按任意键名向下找「对象数组」，避免逐家写死猜错层级。
 */
export function collectObjects(res: unknown, depth = 0): Record<string, unknown>[] {
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

export function strOf(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

/** 单页列取结果：raw 交给 collectObjects / collectPrefixes 统一解析，nextCursor 用于翻页 */
export interface CloudPage {
  raw: unknown
  nextCursor: string | null
}

/**
 * 统一的单页列取原语（图片与目录共用）：delimiter=true 列直接子目录前缀，false 列对象。
 * cursor 传上一页返回的游标续拉下一页；各家翻页字段不同，逐家适配。单页失败向上抛，由调用方兜底。
 */
export async function listCloudPage(
  profile: CloudProfile,
  mod: SdkModule,
  q: { bucket: string; prefix: string; pageSize: number; cursor?: string | null; delimiter?: boolean },
): Promise<CloudPage> {
  const ep = profile.endpoint?.trim() ?? ''
  // delimiter 列目录时必须带尾斜杠：OSS/S3 系对 prefix='dir'（无斜杠）会把 'dir/'
  // 本身作为唯一 CommonPrefix 返回而非其子级，导致目录树只列得出第一层
  const prefix = q.prefix ? (q.delimiter ? `${q.prefix.replace(/\/+$/, '')}/` : q.prefix) || undefined : undefined
  const delimiter = q.delimiter ? '/' : undefined
  switch (profile.provider) {
    case 'aliyun-oss': {
      const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
        listV2(q: Record<string, unknown>): Promise<unknown>
      }
      const client = new OSS({ region: profile.region, endpoint: ep || undefined, bucket: q.bucket, accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret })
      const raw = await client.listV2({
        'max-keys': q.pageSize, prefix, delimiter,
        ...(q.cursor ? { 'continuation-token': q.cursor } : {}),
      })
      const r = raw as { isTruncated?: boolean | string; nextContinuationToken?: string }
      const truncated = r.isTruncated === true || r.isTruncated === 'true'
      return { raw, nextCursor: truncated ? (r.nextContinuationToken ?? null) : null }
    }
    case 'tencent-cos': {
      const COS = ctorOf(mod, ['default', 'COS'], 'cos-nodejs-sdk-v5') as new (o: Record<string, unknown>) => {
        listObjects(p: Record<string, unknown>, cb: (e: Error | null, d?: unknown) => void): void
      }
      const client = new COS({ SecretId: profile.accessKeyId, SecretKey: profile.accessKeySecret })
      const raw = await new Promise((resolve, reject) => {
        client.listObjects(
          { Bucket: q.bucket, Region: profile.region, Prefix: prefix, Delimiter: delimiter, MaxKeys: q.pageSize, ...(q.cursor ? { Marker: q.cursor } : {}) },
          (e, d) => e ? reject(e) : resolve(d),
        )
      })
      const r = raw as { IsTruncated?: boolean | string; NextMarker?: string }
      const truncated = r.IsTruncated === true || r.IsTruncated === 'true'
      return { raw, nextCursor: truncated ? (r.NextMarker ?? null) : null }
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
      const raw = await new Promise((resolve, reject) => {
        manager.listPrefix(q.bucket, { prefix, delimiter, limit: q.pageSize, marker: q.cursor || undefined }, (e, d) => e ? reject(e) : resolve(d))
      })
      const r = raw as { isTruncated?: boolean; marker?: string }
      return { raw, nextCursor: r.isTruncated ? (r.marker ?? null) : null }
    }
    case 'aws-s3': {
      const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
      const ListCommand = mod['ListObjectsV2Command'] as new (o: Record<string, unknown>) => unknown
      const client = new S3Client({
        region: profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
        credentials: { accessKeyId: profile.accessKeyId, secretAccessKey: profile.accessKeySecret },
      })
      const raw = await client.send(new ListCommand({
        Bucket: q.bucket, Prefix: prefix, Delimiter: delimiter, MaxKeys: q.pageSize,
        ...(q.cursor ? { ContinuationToken: q.cursor } : {}),
      }))
      const r = raw as { IsTruncated?: boolean; NextContinuationToken?: string }
      return { raw, nextCursor: r.IsTruncated ? (r.NextContinuationToken ?? null) : null }
    }
    case 'huawei-obs': {
      const ObsClient = ctorOf(mod, ['default', 'ObsClient'], 'esdk-obs-nodejs') as new (o: Record<string, unknown>) => {
        listObjects(p: Record<string, unknown>): Promise<unknown>
      }
      const client = new ObsClient({ access_key_id: profile.accessKeyId, secret_access_key: profile.accessKeySecret, server: withScheme(ep) })
      const raw = await client.listObjects({ Bucket: q.bucket, Prefix: prefix, Delimiter: delimiter, MaxKeys: q.pageSize, Marker: q.cursor || undefined })
      const ir = (raw as { InterfaceResult?: { IsTruncated?: boolean | string; NextMarker?: string } })?.InterfaceResult
      const truncated = ir?.IsTruncated === true || ir?.IsTruncated === 'true'
      return { raw, nextCursor: truncated ? (ir?.NextMarker ?? null) : null }
    }
    case 'baidu-bos': {
      const BosClient = ctorOf(mod, ['BosClient', 'default'], 'bce-sdk-js') as new (o: Record<string, unknown>) => {
        listObjects(b: string, o?: Record<string, unknown>): Promise<unknown>
      }
      const client = new BosClient({ endpoint: withScheme(ep || 'bj.bcebos.com'), credentials: { ak: profile.accessKeyId, sk: profile.accessKeySecret } })
      const raw = await client.listObjects(q.bucket, { prefix, delimiter, maxKeys: q.pageSize, marker: q.cursor || undefined })
      const r = raw as { isTruncated?: boolean; nextMarker?: string }
      return { raw, nextCursor: r.isTruncated ? (r.nextMarker ?? null) : null }
    }
    case 'azure-blob': {
      const BlobServiceClient = mod['BlobServiceClient'] as new (url: string, cred: unknown) => {
        getContainerClient(name: string): {
          listBlobsByHierarchy(d: string, o: Record<string, unknown>): { byPage(o: Record<string, unknown>): { next(): Promise<unknown> } }
          listBlobsFlat(o: Record<string, unknown>): { byPage(o: Record<string, unknown>): { next(): Promise<unknown> } }
        }
      }
      const Credential = mod['StorageSharedKeyCredential'] as new (account: string, key: unknown) => unknown
      const service = new BlobServiceClient(withScheme(ep), new Credential(profile.bucket, profile.accessKeySecret))
      const container = service.getContainerClient(q.bucket)
      const page = (q.delimiter
        ? await container
            .listBlobsByHierarchy('/', { prefix })
            .byPage({ pageSize: q.pageSize, ...(q.cursor ? { continuationToken: q.cursor } : {}) })
            .next()
        : await container
            .listBlobsFlat({ prefix, includeDeleted: false })
            .byPage({ pageSize: q.pageSize, ...(q.cursor ? { continuationToken: q.cursor } : {}) })
            .next()) as { value?: { continuationToken?: string; blobs?: Record<string, unknown>[] } }
      // 列图时把 Azure 的 properties 摊平成统一 Key/Size/LastModified 形态再走通用解析
      const blobs = q.delimiter ? [] : ((page.value?.blobs ?? []) as Record<string, unknown>[])
      const raw = q.delimiter
        ? page.value
        : {
            contents: blobs.map((b) => ({
              Key: String(b['name'] ?? ''),
              Size: (b['properties'] as Record<string, unknown> | undefined)?.['contentLength'],
              LastModified: (b['properties'] as Record<string, unknown> | undefined)?.['lastModified'],
            })),
          }
      return { raw, nextCursor: page.value?.continuationToken || null }
    }
    default:
      throw new Error(`不支持的云厂商：${profile.provider}`)
  }
}
