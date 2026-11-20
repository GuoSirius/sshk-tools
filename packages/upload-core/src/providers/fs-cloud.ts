import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { AppError } from '@sshk/shared'
import type { FsEntry, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'
import { cloudKey, normalizeRootRel } from '../fs-paths'
import { collectPrefixes } from '../directories'
import { deleteDeniedError, type FsDriver } from '../fs-driver'
import { sortFsEntries, type FsSearchBatchFn } from '../fs-driver'
import { CLOUD_REQUEST_TIMEOUT, collectObjects, ctorOf, listCloudPage, loadSdk, specOf, strOf, withCloudTimeout, withScheme, type CloudProfile, type SdkModule } from './cloud-sdk'

/**
 * F-3：云（对象存储）文件系统驱动。
 *
 * - 列目录：delimiter=true 的公共前缀即「虚拟目录」（OSS 无真实层级）；
 *   新建目录写 0 字节 marker（`dir/`）；删除目录 = 前缀批量删（分批 + 进度）；
 *   重命名 / 移动 = copyObject + 删原对象（§二能力矩阵的云侧语义）。
 * - 写操作完整支持 aliyun-oss 与 aws-s3（API 语义确定性最高）；其余厂商
 *   writable=false，仅可浏览，写操作给出明确错误而非静默失败。
 * - 上传大文件走 Buffer 收集（上限 200MB）——云侧流式直传各厂商 API 差异大，
 *   一期先保证正确性，内存换稳定。
 */

/** 云侧 Buffer 收集上限（写/复制） */
const MAX_CLOUD_BUFFER = 200 * 1024 * 1024
/** 递归删目录单批对象数（ali-oss deleteMulti / S3 DeleteObjects 上限 1000） */
const CLOUD_DELETE_BATCH = 500
/** 递归列前缀删的安全页数上限 */
const CLOUD_DELETE_MAX_PAGES = 200
/** 递归搜索 / 容量统计的安全页数上限（1000/页 → 最多扫 20 万 key；用户 2026-11-18：50 页太早截断，当前目录命中都漏掉） */
/** 云递归搜索/容量统计缺省扫描页数（用户 2026-11-18：默认 500，搜索可由配置传入 maxPages 覆盖，0=不限） */
const CLOUD_SCAN_MAX_PAGES = 500

/** OSS 客户端结构面（只用到的成员；multipart 系 XML 返回字段大写开头，防御性读取） */
interface OssClient {
  head(k: string): Promise<{ res: { headers: Record<string, string> } }>
  put(k: string, b: Buffer): Promise<unknown>
  delete(k: string): Promise<unknown>
  deleteMulti(ks: string[]): Promise<unknown>
  copy(dest: string, src: string): Promise<unknown>
  get(k: string, o?: Record<string, unknown>): Promise<{ content: Buffer; res: { headers: Record<string, string> } }>
  getStream(k: string): Promise<{ stream: Readable }>
  listV2(q: Record<string, unknown>): Promise<unknown>
  initMultipartUpload(k: string): Promise<{ uploadId?: string }>
  uploadPart(k: string, uploadId: string, partNumber: number, body: Buffer, start: number, end: number): Promise<{ etag?: string }>
  listParts(k: string, uploadId: string, o?: Record<string, unknown>): Promise<{
    parts?: { PartNumber?: number | string; partNumber?: number | string; Size?: number | string; size?: number | string; ETag?: string; etag?: string }[]
    isTruncated?: boolean | string
    nextPartNumberMarker?: number | string
  }>
  completeMultipartUpload(k: string, uploadId: string, parts: { number: number; etag: string }[]): Promise<unknown>
  abortMultipartUpload(k: string, uploadId: string): Promise<unknown>
  listUploads(o?: Record<string, unknown>): Promise<{
    uploads?: { name?: string; uploadId?: string; initiated?: string | Date }[]
    isTruncated?: boolean | string
    nextKeyMarker?: string
    nextUploadIdMarker?: string
  }>
}

interface S3ClientShape {
  send(cmd: unknown): Promise<unknown>
}

/** 内部路径（`/a/b`）→ 云 SDK prefix（无前导 /、无尾 /；根返回 ''） */
function sdkPrefix(path: string): string {
  return cloudKey(path, 'file') // file 形态即无前导 /、无尾 /，根为 ''
}

/** 云 SDK key → 内部规范路径（补回前导 /） */
function fromSdkKey(key: string): string {
  return normalizeRootRel(key)
}

function notWritable(provider: string, op: string): Error {
  return new Error(`文件系统暂不支持「${provider}」的${op}：当前支持阿里云 OSS 与 AWS S3（其余厂商仅可浏览）`)
}

/** SDK 错误是否为「无删除权限」类（AccessDenied / 403 / 常见文案），探测与 mv 共用 */
function isDeniedError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; message?: unknown }
  return e?.code === 'AccessDenied' || Number(e?.status) === 403 ||
    /no right to access|bucket acl|AccessDenied|permission denied|Forbidden/i.test(String(e?.message ?? err))
}

/**
 * 是否为「请求超时」类错误（服务端可能已落盘、客户端 ACK 慢导致误报）。
 * ali-oss：ResponseTimeoutError / ConnectionTimeoutError（name 或 status -1/-2）；
 * 通用兜底：超时字样。仅用于写后幂等复核，不掩盖真实 4xx/5xx。
 */
function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: unknown; status?: unknown; code?: unknown; message?: unknown }
  if (e?.name === 'ResponseTimeoutError' || e?.name === 'ConnectionTimeoutError') return true
  if (Number(e?.status) === -1 || Number(e?.status) === -2) return true
  return /timeout|超时/i.test(String(e?.message ?? err))
}

// ── 删除权限探测（用户 2026-11-18：写删组合操作先探测再执行，避免半程操作）──
// 探测方式：delete 一个必然不存在的 key。OSS/S3 系 DeleteObject 幂等——
// 权限允许时对不存在 key 也返回成功；Bucket ACL 拒绝时抛 AccessDenied。
// 探测 key 无内容、无副作用。driver 每次 resolve 重建，缓存必须 module 级。
const DELETE_PROBE_TTL = 5 * 60_000
const deleteProbeCache = new Map<string, { ok: boolean; at: number }>()

function deleteProbeCacheKey(p: CloudProfile): string {
  return [p.provider, p.sdk ?? '', p.region ?? '', String(p.bucket ?? ''), p.endpoint ?? '', p.accessKeyId].join('|')
}

function countingStream(onProgress?: (bytes: number) => void): Transform {
  let total = 0
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length
      onProgress?.(total)
      cb(null, chunk)
    },
  })
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of stream) {
    const buf = c as Buffer
    size += buf.length
    if (size > MAX_CLOUD_BUFFER) throw new Error('文件超过 200MB：云侧一期以 Buffer 收集写入，请改用更小文件')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/**
 * 各厂商修改时间归一成毫秒时间戳（用户反馈 2026-11-17：列表时间全 NaN）。
 * 根因：ali-oss/S3 返回的 LastModified 是 Date 对象，经 strOf 字符串化再剥数字
 * 会得到远超 Date 上限（±8.64e15 ms）的数 → Invalid Date。这里拿原始值分支处理：
 * Date 直接取值；七牛 putTime 为纳秒（>1e14 判定）转毫秒；字符串按 ISO 解析。
 */
function parseModified(o: unknown): number {
  const rec = o as Record<string, unknown>
  for (const k of ['LastModified', 'lastModified', 'putTime']) {
    const v = rec?.[k]
    if (v == null) continue
    if (v instanceof Date) return v.getTime()
    if (typeof v === 'number') return v > 1e14 ? Math.floor(v / 1e6) : v
    const s = String(v).trim()
    if (!s) continue
    if (/^\d+$/.test(s)) {
      const n = Number(s)
      return n > 1e14 ? Math.floor(n / 1e6) : n
    }
    const t = Date.parse(s)
    if (Number.isFinite(t)) return t
  }
  return 0
}

export class CloudFsDriver implements FsDriver {
  constructor(private readonly profile: CloudProfile) {}

  get writable(): boolean {
    return this.profile.provider === 'aliyun-oss' || this.profile.provider === 'aws-s3'
  }

  private bucketOf(): string {
    return this.profile.bucket
  }

  /**
   * 构造 ali-oss 客户端的唯一入口：统一带可配置超时（profile.requestTimeoutMs，
   * 缺省回落 cloud-sdk 单一事实源 CLOUD_REQUEST_TIMEOUT）。
   * 之前各操作各自 new OSS({...}) 漏了 timeout，默认 60s 导致「服务端已落盘、客户端 ACK 慢」
   * 时抛 ResponseTimeoutError（文件系统传 <50MB 小文件反复误报，2026-11-20 根治）。
   */
  private newOss(mod: SdkModule, ep = this.profile.endpoint?.trim() ?? ''): OssClient {
    const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => OssClient
    return new OSS({
      region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(),
      accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret,
      timeout: this.profile.requestTimeoutMs ?? CLOUD_REQUEST_TIMEOUT,
    })
  }

  async list(path: string, opts?: { pageSize?: number; cursor?: string | null }): Promise<FsListPage> {
    const mod = await loadSdk(specOf(this.profile))
    const base = sdkPrefix(path)
    const page = await withCloudTimeout(listCloudPage(this.profile, mod, {
      bucket: this.bucketOf(),
      prefix: base,
      pageSize: Math.max(1, Math.min(1000, Math.floor(opts?.pageSize ?? 500))),
      cursor: opts?.cursor ?? null,
      delimiter: true,
    }), 20_000, '云列目录失败')
    const dirs: FsEntry[] = []
    for (const raw of collectPrefixes(page.raw)) {
      const rel = toRelUnder(base, raw)
      if (rel) {
        dirs.push({ kind: 'dir', name: rel.name, path: rel.path })
      }
    }
    const files: FsEntry[] = []
    const marker = base ? `${base}/` : ''
    for (const o of collectObjects(page.raw)) {
      const key = strOf(o, ['Key', 'key', 'name'])
      if (!key) continue
      if (key.endsWith('/')) continue // 目录 marker / 前缀形态
      if (marker && key === marker) continue
      if (base && !key.startsWith(marker)) continue
      const name = key.slice(marker.length)
      if (!name) continue
      files.push({
        kind: 'file',
        name,
        path: fromSdkKey(marker + name),
        size: Number(strOf(o, ['Size', 'size', 'fsize'])) || 0,
        modified: parseModified(o),
      })
    }
    return { entries: sortFsEntries([...dirs, ...files]), nextCursor: page.nextCursor }
  }

  async stat(path: string): Promise<FsStatResult> {
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) return { exists: true, isDir: true }
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        try {
          const r = await client.head(key)
          const h = r.res?.headers ?? {}
          return {
            exists: true,
            size: Number(h['content-length'] ?? 0) || 0,
            modified: h['last-modified'] ? new Date(h['last-modified']).getTime() : undefined,
            etag: h['etag'] ?? '',
          }
        } catch {
          return { exists: false }
        }
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const HeadCommand = mod['HeadObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        try {
          const r = await client.send(new HeadCommand({ Bucket: this.bucketOf(), Key: key })) as { ContentLength?: number; LastModified?: string; ETag?: string }
          return { exists: true, size: r.ContentLength ?? 0, modified: r.LastModified ? new Date(r.LastModified).getTime() : undefined, etag: r.ETag ?? '' }
        } catch {
          return { exists: false }
        }
      }
      default:
        throw notWritable(this.profile.provider, 'stat')
    }
  }

  async mkdir(path: string): Promise<void> {
    this.assertWritable('新建目录')
    const mod = await loadSdk(specOf(this.profile))
    const marker = cloudKey(path, 'dir')
    if (!marker) throw new Error('根目录无需创建')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        await client.put(marker, Buffer.alloc(0))
        return
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const PutCommand = mod['PutObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        await client.send(new PutCommand({ Bucket: this.bucketOf(), Key: marker, Body: Buffer.alloc(0) }))
        return
      }
      default:
        throw notWritable(this.profile.provider, '新建目录')
    }
  }

  /** 删除权限前置探测：delete 必然不存在的 key（幂等，零副作用）。ACL 拒绝 → 直接拒绝执行；
   *  探测结果按 profile 缓存 5 分钟（driver 每次调用重建，实例级缓存无效）；
   *  非权限类探测失败（网络抖动等）不阻断——真实删除失败时 mv/rmDir 自身还有错误与回退兜底 */
  async ensureCanDelete(op: string, _dir?: string): Promise<void> {
    const cacheKey = deleteProbeCacheKey(this.profile)
    const cached = deleteProbeCache.get(cacheKey)
    if (cached && cached.ok && Date.now() - cached.at < DELETE_PROBE_TTL) return
    const probeKey = `.sshk-probe/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await this.rmFile(probeKey)
    } catch (err) {
      if (isDeniedError(err)) {
        deleteProbeCache.set(cacheKey, { ok: false, at: Date.now() })
        throw deleteDeniedError(op, `云 Bucket（${this.bucketOf()}）`)
      }
      // 非权限类错误：放行（后续真实删除失败仍有「移动未完成」提示与回退兜底）
    }
    deleteProbeCache.set(cacheKey, { ok: true, at: Date.now() })
  }

  async rmFile(path: string): Promise<void> {
    this.assertWritable('删除文件')
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) throw new Error('根目录不可删除')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        await client.delete(key)
        return
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const DelCommand = mod['DeleteObjectsCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        await client.send(new DelCommand({ Bucket: this.bucketOf(), Delete: { Objects: [{ Key: key }], Quiet: true } }))
        return
      }
      default:
        throw notWritable(this.profile.provider, '删除文件')
    }
  }

  /** 递归删目录：平铺列前缀下全部对象 → 按批删除（分批 + 进度） */
  async rmDir(path: string, onProgress?: (done: number, total: number) => void): Promise<number> {
    this.assertWritable('删除目录')
    const mod = await loadSdk(specOf(this.profile))
    const base = sdkPrefix(path)
    const marker = cloudKey(path, 'dir')
    if (!marker) throw new Error('根目录不可删除')
    await this.ensureCanDelete('删除目录')
    const ep = this.profile.endpoint?.trim() ?? ''
    // 1) 平铺收集前缀下全部 key（含 marker 本身）
    const keys: string[] = [marker]
    let cursor: string | null = null
    for (let page = 0; page < CLOUD_DELETE_MAX_PAGES; page++) {
      const p = await listCloudPage(this.profile, mod, { bucket: this.bucketOf(), prefix: base, pageSize: 1000, cursor, delimiter: false })
      for (const o of collectObjects(p.raw)) {
        const key = strOf(o, ['Key', 'key', 'name'])
        if (key && key.startsWith(marker)) keys.push(key)
      }
      cursor = p.nextCursor
      if (!cursor) break
    }
    const total = keys.length
    let done = 0
    // 2) 分批删除
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        for (let i = 0; i < keys.length; i += CLOUD_DELETE_BATCH) {
          await client.deleteMulti(keys.slice(i, i + CLOUD_DELETE_BATCH))
          done = Math.min(total, i + CLOUD_DELETE_BATCH)
          onProgress?.(done, total)
        }
        break
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const DelCommand = mod['DeleteObjectsCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        for (let i = 0; i < keys.length; i += CLOUD_DELETE_BATCH) {
          await client.send(new DelCommand({ Bucket: this.bucketOf(), Delete: { Objects: keys.slice(i, i + CLOUD_DELETE_BATCH).map((k) => ({ Key: k })), Quiet: true } }))
          done = Math.min(total, i + CLOUD_DELETE_BATCH)
          onProgress?.(done, total)
        }
        break
      }
      default:
        throw notWritable(this.profile.provider, '删除目录')
    }
    return total
  }

  async cp(src: string, dest: string): Promise<void> {
    this.assertWritable('复制')
    if (normalizeRootRel(src) === normalizeRootRel(dest)) throw new Error('源与目标相同，无需复制')
    const mod = await loadSdk(specOf(this.profile))
    const srcKey = cloudKey(src, 'file')
    const destKey = cloudKey(dest, 'file')
    if (!srcKey || !destKey) throw new Error('复制目标路径不合法')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        await client.copy(destKey, srcKey)
        return
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const CopyCommand = mod['CopyObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        await client.send(new CopyCommand({
          Bucket: this.bucketOf(),
          Key: destKey,
          CopySource: `${this.bucketOf()}/${srcKey.split('/').map(encodeURIComponent).join('/')}`,
        }))
        return
      }
      default:
        throw notWritable(this.profile.provider, '复制')
    }
  }

  /** 移动 = copyObject + 删源。执行顺序（用户 2026-11-18 定版）：
   *  ① 先探测删除权限（无权限直接拒绝，未做任何修改）；② copy；③ 删源失败 →
   *  回退还原（从目标复制回源 + 删目标），做到文件级原子化，再抛「移动未完成」 */
  async mv(src: string, dest: string): Promise<void> {
    this.assertWritable('移动')
    if (normalizeRootRel(src) === normalizeRootRel(dest)) throw new Error('源与目标相同，无需移动')
    await this.ensureCanDelete('移动')
    await this.cp(src, dest)
    try {
      await this.rmFile(src)
    } catch (err) {
      // 复制已成功但源不可删（权限已预检，多为瞬时故障）：先回退还原再报错
      let restored = false
      try {
        await this.cp(dest, src)
        await this.rmFile(dest)
        restored = true
      } catch { /* 回退失败如实报告，两处都保留待用户核对 */ }
      throw new AppError(
        `移动未完成：目标「${dest}」已生成，但源「${src}」删除失败` +
        (restored
          ? '。已自动回退（源文件已还原、目标副本已清理），未产生重复。'
          : '。自动回退也失败了——源与目标当前各有内容，请核对后手动处理。') +
        '原始错误：' + String((err as Error)?.message ?? err),
        'permission',
      )
    }
  }

  async readBuffer(path: string): Promise<{ data: Buffer; size: number; modified?: number; etag?: string }> {
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) throw new Error('目录无内容可读')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        const r = await client.get(key)
        const h = r.res?.headers ?? {}
        return { data: Buffer.from(r.content), size: r.content.length, etag: h['etag'], modified: h['last-modified'] ? new Date(h['last-modified']).getTime() : undefined }
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const GetCommand = mod['GetObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        const r = await client.send(new GetCommand({ Bucket: this.bucketOf(), Key: key })) as { Body: Readable; ContentLength?: number; ETag?: string; LastModified?: string }
        const data = await streamToBuffer(r.Body)
        return { data, size: data.length, etag: r.ETag, modified: r.LastModified ? new Date(r.LastModified).getTime() : undefined }
      }
      default:
        throw notWritable(this.profile.provider, '读取内容')
    }
  }

  async write(path: string, body: Buffer | Readable, onProgress?: (bytes: number) => void): Promise<void> {
    this.assertWritable('写入')
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) throw new Error('写入路径不合法')
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body)
    onProgress?.(buffer.length)
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        try {
          await client.put(key, buffer)
          return
        } catch (err) {
          // 根治「文件已在却报失败」：ali-oss Buffer put 是单次请求、无 retry，弱网 ACK 慢会在
          // 服务端已落盘后仍抛 ResponseTimeoutError。超时类错误先 head 幂等复核，大小一致即判成功，
          // 避免误报 + 重复上传冲突；非超时错误（4xx/5xx/权限）照常抛出。
          if (!isTimeoutError(err)) throw err
          try {
            const r = await client.head(key)
            const size = Number(r?.res?.headers?.['content-length'] ?? -1)
            if (size === buffer.length) return
          } catch {
            // head 复核失败（对象确实没落盘 / 网络仍不通）→ 落回抛原始超时错误
          }
          throw err
        }
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const PutCommand = mod['PutObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        await client.send(new PutCommand({ Bucket: this.bucketOf(), Key: key, Body: buffer }))
        return
      }
      default:
        throw notWritable(this.profile.provider, '写入')
    }
  }

  async download(path: string, destFile: string, onProgress?: (bytes: number) => void): Promise<void> {
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) throw new Error('下载路径不合法')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const client = this.newOss(mod, ep)
        const r = await client.getStream(key)
        await new Promise<void>((res, rej) => {
          const out = createWriteStream(destFile)
          const counter = countingStream(onProgress)
          r.stream.on('error', (e: Error) => { out.destroy(); rej(e) })
          counter.on('error', (e: Error) => { out.destroy(); rej(e) })
          out.on('error', (e: Error) => rej(e))
          counter.on('finish', () => res())
          r.stream.pipe(counter).pipe(out)
        })
        return
      }
      case 'aws-s3': {
        const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown> }
        const GetCommand = mod['GetObjectCommand'] as new (o: Record<string, unknown>) => unknown
        const client = new S3Client({
          region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
          credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
        })
        const r = await client.send(new GetCommand({ Bucket: this.bucketOf(), Key: key })) as { Body: Readable }
        await new Promise<void>((res, rej) => {
          const out = createWriteStream(destFile)
          const counter = countingStream(onProgress)
          r.Body.on('error', (e: Error) => { out.destroy(); rej(e) })
          counter.on('error', (e: Error) => { out.destroy(); rej(e) })
          out.on('error', (e: Error) => rej(e))
          counter.on('finish', () => res())
          r.Body.pipe(counter).pipe(out)
        })
        return
      }
      default:
        throw notWritable(this.profile.provider, '下载')
    }
  }

  // ── plans/10：分片上传（multipart）与 Range 下载（OSS / S3）──

  private ossCached: OssClient | null = null
  /** OSS 客户端（driver 每次 resolve 重建，实例级缓存即可；避免每个分片重复构造） */
  private async oss(): Promise<OssClient> {
    if (this.ossCached) return this.ossCached
    const mod = await loadSdk(specOf(this.profile))
    this.ossCached = this.newOss(mod)
    return this.ossCached
  }

  private s3Cached: { client: S3ClientShape; cmd: (name: string) => new (o: Record<string, unknown>) => unknown } | null = null
  /** S3 客户端 + 指令构造器（懒加载缓存） */
  private async s3(): Promise<{ client: S3ClientShape; cmd: (name: string) => new (o: Record<string, unknown>) => unknown }> {
    if (this.s3Cached) return this.s3Cached
    const mod = await loadSdk(specOf(this.profile))
    const S3Client = ctorOf(mod, ['S3Client'], '@aws-sdk/client-s3') as new (o: Record<string, unknown>) => S3ClientShape
    const ep = this.profile.endpoint?.trim() ?? ''
    const client = new S3Client({
      region: this.profile.region || 'auto', endpoint: ep ? withScheme(ep) : undefined, forcePathStyle: Boolean(ep),
      credentials: { accessKeyId: this.profile.accessKeyId, secretAccessKey: this.profile.accessKeySecret },
    })
    const cmd = (name: string) => mod[name] as new (o: Record<string, unknown>) => unknown
    this.s3Cached = { client, cmd }
    return this.s3Cached
  }

  /** 分片上传：语义对齐 S3 Multipart API；complete 内部按 partNumber 升序提交 */
  readonly multipart = {
    create: async (remotePath: string): Promise<{ uploadId: string }> => {
      this.assertWritable('分片上传')
      const key = cloudKey(remotePath, 'file')
      if (!key) throw new Error('分片上传路径不合法')
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        const r = await client.initMultipartUpload(key)
        return { uploadId: String(r.uploadId) }
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        const r = await client.send(new (cmd('CreateMultipartUploadCommand'))({ Bucket: this.bucketOf(), Key: key })) as { UploadId?: string }
        if (!r.UploadId) throw new Error('S3 分片上传初始化失败：未返回 UploadId')
        return { uploadId: r.UploadId }
      }
      throw notWritable(this.profile.provider, '分片上传')
    },

    uploadPart: async (remotePath: string, uploadId: string, partNumber: number, body: Buffer): Promise<{ etag: string }> => {
      const key = cloudKey(remotePath, 'file')
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        const r = await client.uploadPart(key, uploadId, partNumber, body, 0, body.length)
        return { etag: String(r.etag ?? '') }
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        const r = await client.send(new (cmd('UploadPartCommand'))({
          Bucket: this.bucketOf(), Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body,
        })) as { ETag?: string }
        return { etag: String(r.ETag ?? '') }
      }
      throw notWritable(this.profile.provider, '分片上传')
    },

    listParts: async (remotePath: string, uploadId: string): Promise<{ partNumber: number; size: number; etag: string }[]> => {
      const key = cloudKey(remotePath, 'file')
      const out: { partNumber: number; size: number; etag: string }[] = []
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        let marker = 0
        for (let page = 0; page < 100; page++) {
          const r = await client.listParts(key, uploadId, { 'part-number-marker': marker, 'max-parts': 1000 })
          for (const p of r.parts ?? []) {
            const pn = Number(p.PartNumber ?? p.partNumber)
            if (Number.isFinite(pn)) out.push({ partNumber: pn, size: Number(p.Size ?? p.size) || 0, etag: String(p.ETag ?? p.etag ?? '') })
          }
          if (!r.isTruncated || r.isTruncated === 'false') break
          marker = Number(r.nextPartNumberMarker ?? 0)
          if (!Number.isFinite(marker) || marker <= 0) break
        }
        return out
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        let marker: number | undefined
        for (let page = 0; page < 100; page++) {
          const r = await client.send(new (cmd('ListPartsCommand'))({
            Bucket: this.bucketOf(), Key: key, UploadId: uploadId, MaxParts: 1000,
            ...(marker ? { PartNumberMarker: marker } : {}),
          })) as { Parts?: { PartNumber?: number; Size?: number; ETag?: string }[]; IsTruncated?: boolean; NextPartNumberMarker?: number }
          for (const p of r.Parts ?? []) {
            if (p.PartNumber != null) out.push({ partNumber: p.PartNumber, size: Number(p.Size) || 0, etag: String(p.ETag ?? '') })
          }
          if (!r.IsTruncated || r.NextPartNumberMarker == null) break
          marker = r.NextPartNumberMarker
        }
        return out
      }
      throw notWritable(this.profile.provider, '分片查询')
    },

    complete: async (remotePath: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> => {
      const key = cloudKey(remotePath, 'file')
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        await client.completeMultipartUpload(key, uploadId, sorted.map((p) => ({ number: p.partNumber, etag: p.etag })))
        return
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        await client.send(new (cmd('CompleteMultipartUploadCommand'))({
          Bucket: this.bucketOf(), Key: key, UploadId: uploadId,
          MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }))
        return
      }
      throw notWritable(this.profile.provider, '分片完成')
    },

    /** 幂等：abort 不存在的 uploadId 由服务端报错，调用方自行吞错 */
    abort: async (remotePath: string, uploadId: string): Promise<void> => {
      const key = cloudKey(remotePath, 'file')
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        await client.abortMultipartUpload(key, uploadId)
        return
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        await client.send(new (cmd('AbortMultipartUploadCommand'))({ Bucket: this.bucketOf(), Key: key, UploadId: uploadId }))
        return
      }
      throw notWritable(this.profile.provider, '分片中止')
    },

    /** 列全 bucket 的 in-progress 分片上传（翻页拉满 1000/页 × 100 页） */
    listUploads: async (): Promise<{ uploadId: string; key: string; initiatedAt?: number }[]> => {
      const out: { uploadId: string; key: string; initiatedAt?: number }[] = []
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        let keyMarker = ''
        let idMarker = ''
        for (let page = 0; page < 100; page++) {
          const r = await client.listUploads({
            'max-uploads': 1000,
            ...(keyMarker ? { 'key-marker': keyMarker } : {}),
            ...(idMarker ? { 'upload-id-marker': idMarker } : {}),
          })
          for (const u of r.uploads ?? []) {
            out.push({
              uploadId: String(u.uploadId ?? ''),
              key: String(u.name ?? ''),
              initiatedAt: u.initiated instanceof Date ? u.initiated.getTime()
                : u.initiated && Number.isFinite(Date.parse(String(u.initiated))) ? Date.parse(String(u.initiated)) : undefined,
            })
          }
          if (!r.isTruncated || r.isTruncated === 'false') break
          keyMarker = String(r.nextKeyMarker ?? '')
          idMarker = String(r.nextUploadIdMarker ?? '')
          if (!keyMarker && !idMarker) break
        }
        return out
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        let keyMarker: string | undefined
        let idMarker: string | undefined
        for (let page = 0; page < 100; page++) {
          const r = await client.send(new (cmd('ListMultipartUploadsCommand'))({
            Bucket: this.bucketOf(), MaxUploads: 1000,
            ...(keyMarker ? { KeyMarker: keyMarker } : {}),
            ...(idMarker ? { UploadIdMarker: idMarker } : {}),
          })) as { Uploads?: { Key?: string; UploadId?: string; Initiated?: string | Date }[]; IsTruncated?: boolean; NextKeyMarker?: string; NextUploadIdMarker?: string }
          for (const u of r.Uploads ?? []) {
            out.push({
              uploadId: String(u.UploadId ?? ''),
              key: String(u.Key ?? ''),
              initiatedAt: u.Initiated instanceof Date ? u.Initiated.getTime()
                : u.Initiated && Number.isFinite(Date.parse(String(u.Initiated))) ? Date.parse(String(u.Initiated)) : undefined,
            })
          }
          if (!r.IsTruncated || !r.NextKeyMarker) break
          keyMarker = r.NextKeyMarker
          idMarker = r.NextUploadIdMarker
        }
        return out
      }
      throw notWritable(this.profile.provider, '分片清单')
    },
  }

  /** Range 下载：OSS/S3 均支持 bytes Range 头（分片下载 + 断点续传，plans/10 §6） */
  readonly range = {
    capabilities: async (): Promise<{ unit: 'bytes'; supportsRange: boolean }> =>
      ({ unit: 'bytes', supportsRange: this.profile.provider === 'aliyun-oss' || this.profile.provider === 'aws-s3' }),

    /** 指纹 = size:etag（同一对象上传覆盖后 etag 必变，续传自动废弃旧区间） */
    statForResume: async (remotePath: string): Promise<{ size: number; fingerprint: string }> => {
      const st = await this.stat(remotePath)
      if (!st.exists || st.isDir) throw new Error('远端文件不存在或为目录')
      return { size: st.size ?? 0, fingerprint: `${st.size ?? 0}:${st.etag ?? ''}` }
    },

    readRange: async (remotePath: string, start: number, end: number): Promise<Buffer> => {
      if (end <= start) return Buffer.alloc(0)
      const key = cloudKey(remotePath, 'file')
      if (this.profile.provider === 'aliyun-oss') {
        const client = await this.oss()
        const r = await client.get(key, { headers: { Range: `bytes=${start}-${end - 1}` } })
        return Buffer.from(r.content)
      }
      if (this.profile.provider === 'aws-s3') {
        const { client, cmd } = await this.s3()
        const r = await client.send(new (cmd('GetObjectCommand'))({
          Bucket: this.bucketOf(), Key: key, Range: `bytes=${start}-${end - 1}`,
        })) as { Body: Readable }
        const chunks: Buffer[] = []
        for await (const c of r.Body) chunks.push(c as Buffer)
        return Buffer.concat(chunks)
      }
      throw notWritable(this.profile.provider, 'Range 下载')
    },
  }

  private assertWritable(op: string): void {
    if (!this.writable) throw notWritable(this.profile.provider, op)
  }

  /** 递归搜索：listV2 无 delimiter 扫前缀（§3.3 既定路线），按文件名子串匹配。
   *  前缀必须带尾斜杠（marker）：裸前缀会把 demo-2、demo备份 等同名字头兄弟目录的文件混进来；
   *  且不再排除子目录文件——平铺扫前缀天然递归，与本地/远端驱动的 BFS 递归语义一致 */
  async search(path: string, keyword: string, opts?: { maxResults?: number; maxPages?: number; onBatch?: FsSearchBatchFn }): Promise<FsSearchResult> {
    const mod = await loadSdk(specOf(this.profile))
    const base = sdkPrefix(path)
    const marker = base ? `${base}/` : ''
    const kw = keyword.trim().toLowerCase()
    const maxResults = Math.max(1, Math.min(1000, Math.floor(opts?.maxResults ?? 300)))
    // 扫描页数上限：0 = 不限；负数/非数字回落默认；上限钳制 100000 防失控循环
    const rawPages = Number(opts?.maxPages)
    const pageCap = opts?.maxPages === undefined || !Number.isFinite(rawPages) || rawPages < 0
      ? CLOUD_SCAN_MAX_PAGES
      : rawPages === 0 ? Infinity : Math.min(100000, Math.floor(rawPages))
    const out: FsEntry[] = []
    let batch: FsEntry[] = []
    let scannedDirs = 0
    const flush = (done: boolean): void => {
      if (!done && batch.length === 0) return
      opts?.onBatch?.({ entries: batch, scannedDirs, done })
      batch = []
    }
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < pageCap; page++) {
      const p = await listCloudPage(this.profile, mod, { bucket: this.bucketOf(), prefix: marker, pageSize: 1000, cursor, delimiter: false })
      scannedDirs += 1 // 云按前缀分页扫，一页算一层进度
      for (const o of collectObjects(p.raw)) {
        const key = strOf(o, ['Key', 'key', 'name'])
        if (!key || key.endsWith('/')) continue
        const rel = key.slice(marker.length)
        if (!rel) continue
        const name = rel.slice(rel.lastIndexOf('/') + 1) // basename：与本地/远端搜索一致按文件名匹配
        if (!kw || !name.toLowerCase().includes(kw)) continue
        out.push({
          kind: 'file',
          name,
          path: fromSdkKey(marker + rel),
          size: Number(strOf(o, ['Size', 'size', 'fsize'])) || 0,
          modified: parseModified(o),
        })
        batch.push(out[out.length - 1]!)
        if (batch.length >= 20) flush(false) // 攒够一批立即推
        if (out.length >= maxResults) { truncated = true; break }
      }
      flush(false) // 每页收尾推剩余，避免整页攒着不显示
      cursor = p.nextCursor
      if (truncated || !cursor) break
    }
    if (cursor && !truncated && Number.isFinite(pageCap)) truncated = true // 扫到页数上限还有剩余（pageCap=Infinity 不限）
    flush(true)
    return { entries: out, truncated }
  }

  /** 目录容量统计：扫前缀求和（达页数上限 truncated=true，数值为已扫部分）。
   *  前缀必须带尾斜杠（marker）：裸前缀是字符串级匹配——统计 demo 会把 demo-2、demo备份 等
   *  同名字头兄弟目录的文件一起算进来（用户 2026-11-18 实测「1 个文件统计成 4 个」即此因） */
  async usage(path: string): Promise<FsUsageResult> {
    const mod = await loadSdk(specOf(this.profile))
    const base = sdkPrefix(path)
    const marker = base ? `${base}/` : ''
    let size = 0
    let files = 0
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < CLOUD_SCAN_MAX_PAGES; page++) {
      const p = await listCloudPage(this.profile, mod, { bucket: this.bucketOf(), prefix: marker, pageSize: 1000, cursor, delimiter: false })
      for (const o of collectObjects(p.raw)) {
        const key = strOf(o, ['Key', 'key', 'name'])
        if (!key) continue
        // 目录 marker（0 字节 'dir/'）不计入文件数
        if (key.endsWith('/')) continue
        size += Number(strOf(o, ['Size', 'size', 'fsize'])) || 0
        files += 1
      }
      cursor = p.nextCursor
      if (!cursor) break
    }
    if (cursor) truncated = true
    return { size, files, truncated }
  }
}

/** 把云 SDK 完整前缀（如 'a/b/'）折算成 base 之下的内部规范路径（`/a/b/x`）与末段名 */
function toRelUnder(base: string, fullPrefix: string): { path: string; name: string } | null {
  const marker = base ? `${base}/` : ''
  let p = fullPrefix.replace(/\/+$/, '')
  if (!p) return null
  if (marker && !p.startsWith(marker)) return null
  if (p === base) return null
  p = p.slice(marker.length)
  if (!p) return null
  const name = p.slice(p.lastIndexOf('/') + 1)
  if (!name) return null
  return { path: fromSdkKey(marker + name), name }
}
