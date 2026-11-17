import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { AppError } from '@sshk/shared'
import type { FsEntry, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'
import { cloudKey, normalizeRootRel } from '../fs-paths'
import { collectPrefixes } from '../directories'
import type { FsDriver } from '../fs-driver'
import { sortFsEntries } from '../fs-driver'
import { collectObjects, ctorOf, listCloudPage, loadSdk, specOf, strOf, withScheme, type CloudProfile } from './cloud-sdk'

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
/** 递归搜索 / 容量统计的安全页数上限（1000/页 → 最多扫 5 万 key） */
const CLOUD_SCAN_MAX_PAGES = 50

function notWritable(provider: string, op: string): Error {
  return new Error(`文件系统暂不支持「${provider}」的${op}：当前支持阿里云 OSS 与 AWS S3（其余厂商仅可浏览）`)
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

  async list(path: string, opts?: { pageSize?: number; cursor?: string | null }): Promise<FsListPage> {
    const mod = await loadSdk(specOf(this.profile))
    const base = normalizeRootRel(path)
    const page = await listCloudPage(this.profile, mod, {
      bucket: this.bucketOf(),
      prefix: base,
      pageSize: Math.max(1, Math.min(1000, Math.floor(opts?.pageSize ?? 500))),
      cursor: opts?.cursor ?? null,
      delimiter: true,
    })
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
        path: marker + name,
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => {
          head(k: string): Promise<{ res: { headers: Record<string, string> } }>
        }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { put(k: string, b: Buffer): Promise<unknown> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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

  async rmFile(path: string): Promise<void> {
    this.assertWritable('删除文件')
    const mod = await loadSdk(specOf(this.profile))
    const key = cloudKey(path, 'file')
    if (!key) throw new Error('根目录不可删除')
    const ep = this.profile.endpoint?.trim() ?? ''
    switch (this.profile.provider) {
      case 'aliyun-oss': {
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { delete(k: string): Promise<unknown> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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
    const base = normalizeRootRel(path)
    const marker = cloudKey(path, 'dir')
    if (!marker) throw new Error('根目录不可删除')
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { deleteMulti(ks: string[]): Promise<unknown> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { copy(dest: string, src: string): Promise<unknown> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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

  async mv(src: string, dest: string): Promise<void> {
    this.assertWritable('移动')
    if (normalizeRootRel(src) === normalizeRootRel(dest)) throw new Error('源与目标相同，无需移动')
    await this.cp(src, dest)
    try {
      await this.rmFile(src)
    } catch (err) {
      const e = err as { code?: unknown; status?: unknown; message?: unknown }
      const denied = e?.code === 'AccessDenied' || Number(e?.status) === 403 ||
        /no right to access|bucket acl|AccessDenied|permission denied|Forbidden/i.test(String(e?.message ?? err))
      if (!denied) throw err
      // 复制已成功但源不可删：必须说清「部分完成」，否则用户以为整个移动失败会重试产生重复对象
      throw new AppError(
        `移动未完成：目标「${dest}」已生成，但源「${src}」删除失败（Bucket ACL 不允许 DeleteObject，等同复制成功）。` +
        '操作已中止，请开通删除权限后重试，或手动删除原对象；已复制的文件请核对。',
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { get(k: string): Promise<{ content: Buffer; res: { headers: Record<string, string> } }> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { put(k: string, b: Buffer): Promise<unknown> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
        await client.put(key, buffer)
        return
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
        const OSS = ctorOf(mod, ['default', 'OSS'], 'ali-oss') as new (o: Record<string, unknown>) => { getStream(k: string): Promise<{ stream: Readable }> }
        const client = new OSS({ region: this.profile.region, endpoint: ep || undefined, bucket: this.bucketOf(), accessKeyId: this.profile.accessKeyId, accessKeySecret: this.profile.accessKeySecret })
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

  private assertWritable(op: string): void {
    if (!this.writable) throw notWritable(this.profile.provider, op)
  }

  /** 递归搜索：listV2 无 delimiter 扫前缀（§3.3 既定路线），按名称子串匹配文件 */
  async search(path: string, keyword: string, opts?: { maxResults?: number }): Promise<FsSearchResult> {
    const mod = await loadSdk(specOf(this.profile))
    const base = normalizeRootRel(path)
    const marker = base ? `${base}/` : ''
    const kw = keyword.trim().toLowerCase()
    const maxResults = Math.max(1, Math.min(1000, Math.floor(opts?.maxResults ?? 300)))
    const out: FsEntry[] = []
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < CLOUD_SCAN_MAX_PAGES; page++) {
      const p = await listCloudPage(this.profile, mod, { bucket: this.bucketOf(), prefix: base, pageSize: 1000, cursor, delimiter: false })
      for (const o of collectObjects(p.raw)) {
        const key = strOf(o, ['Key', 'key', 'name'])
        if (!key || key.endsWith('/') || (marker && key === marker)) continue
        const name = key.slice(marker.length)
        if (!name || name.includes('/')) continue
        if (!kw || !name.toLowerCase().includes(kw)) continue
        out.push({
          kind: 'file',
          name,
          path: marker + name,
          size: Number(strOf(o, ['Size', 'size', 'fsize'])) || 0,
          modified: parseModified(o),
        })
        if (out.length >= maxResults) { truncated = true; break }
      }
      cursor = p.nextCursor
      if (truncated || !cursor) break
    }
    if (cursor && !truncated) truncated = true // 扫到页数上限还有剩余
    return { entries: out, truncated }
  }

  /** 目录容量统计：扫前缀求和（达页数上限 truncated=true，数值为已扫部分） */
  async usage(path: string): Promise<FsUsageResult> {
    const mod = await loadSdk(specOf(this.profile))
    const base = normalizeRootRel(path)
    const marker = base ? `${base}/` : ''
    let size = 0
    let files = 0
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < CLOUD_SCAN_MAX_PAGES; page++) {
      const p = await listCloudPage(this.profile, mod, { bucket: this.bucketOf(), prefix: base, pageSize: 1000, cursor, delimiter: false })
      for (const o of collectObjects(p.raw)) {
        const key = strOf(o, ['Key', 'key', 'name'])
        if (!key) continue
        // 目录 marker（0 字节 'dir/'）不计入文件数
        if (key.endsWith('/')) continue
        if (marker && key === marker) continue
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

/** 把完整前缀（如 'a/b/'）折算成 base 之下的相对路径与末段名 */
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
  return { path: marker + name, name }
}
