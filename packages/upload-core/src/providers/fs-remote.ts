import { createWriteStream } from 'node:fs'
import { Readable, Transform, Writable } from 'node:stream'
import { Client as FtpClient } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import type { FsEntry, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'
import { fsBasename, fsJoin, fsParent, normalizeRootRel } from '../fs-paths'
import { deleteDeniedError, type FsDriver } from '../fs-driver'
import { nameMatches, sortFsEntries, walkRemote, type FsSearchBatchFn } from '../fs-driver'
import type { RemoteProfile } from './remote'

/**
 * F-2：FTP/SFTP 文件系统驱动（复用 basic-ftp / ssh2，与上传 Provider 同一套连接参数）。
 * 每个操作独立短连接（连接建立成本低、规避空闲超时与并发竞争）；大文件上传/下载走流式。
 */

/** 累计字节数统计流：传输进度回调 */
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

function bufferFromChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks)
}

function memorySink(onChunk?: (n: number) => void): Writable & { data: () => Buffer } {
  const chunks: Buffer[] = []
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk as Buffer)
      onChunk?.((chunk as Buffer).length)
      cb()
    },
  })
  ;(sink as Writable & { data: () => Buffer }).data = () => bufferFromChunks(chunks)
  return sink as Writable & { data: () => Buffer }
}

/** SFTP 单次会话封装：ready → sftp → 回调 → end */
function withSftp<T>(
  profile: RemoteProfile,
  fn: (sftp: import('ssh2').SFTPWrapper) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const conn = new SshClient()
    let settled = false
    const done = (err: unknown, value?: T): void => {
      if (settled) return
      settled = true
      conn.end()
      if (err) reject(err instanceof Error ? err : new Error(String(err)))
      else resolve(value as T)
    }
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { done(err); return }
        fn(sftp).then((v) => done(null, v), (e) => done(e))
      })
    })
    conn.on('error', (err) => done(err))
    conn.connect({
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.username,
      password: profile.password,
    })
  })
}

/** FTP 单次会话封装：access → 回调 → close */
async function withFtp<T>(profile: RemoteProfile, fn: (client: FtpClient) => Promise<T>): Promise<T> {
  const client = new FtpClient()
  try {
    await client.access({
      host: profile.host,
      port: profile.port ?? 21,
      user: profile.username,
      password: profile.password,
      secure: false,
    })
    return await fn(client)
  } finally {
    client.close()
  }
}

/** SFTP 递归建目录（mkdir -p 语义）；dir 为远程绝对路径 */
async function sftpMkdirp(sftp: import('ssh2').SFTPWrapper, dir: string): Promise<void> {
  const parts = dir.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
  let cur = ''
  for (const p of parts) {
    cur = `${cur}/${p}`
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(cur, (e) => {
        // 已存在不算失败（并发/重复创建常见）
        if (!e || /exist/i.test(String((e as Error).message))) resolve()
        else reject(e)
      })
    })
  }
}

/** SFTP 递归删目录：先列全（估总数），文件逐个删，目录自底向上删；带进度 */
async function sftpRmDir(
  sftp: import('ssh2').SFTPWrapper,
  root: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  interface Item { path: string; isDir: boolean }
  const items: Item[] = []
  const queue = [root]
  while (queue.length > 0 && items.length < 20_000) {
    const dir = queue.shift()!
    const list = await new Promise<{ filename: string; attrs: { isDirectory(): boolean } }[]>((res) => {
      sftp.readdir('/' + dir, (e, l) => res(e ? [] : (l ?? []) as never))
    })
    for (const i of list) {
      if (i.filename === '.' || i.filename === '..') continue
      const full = `${dir}/${i.filename}`
      let isDir = false
      try { isDir = i.attrs?.isDirectory?.() ?? false } catch { isDir = false }
      items.push({ path: full, isDir })
      if (isDir) queue.push(full)
    }
  }
  const dirs = items.filter((i) => i.isDir).sort((a, b) => b.path.length - a.path.length)
  const files = items.filter((i) => !i.isDir)
  const total = files.length + dirs.length + 1
  let done = 0
  for (const f of files) {
    await new Promise<void>((res, rej) => sftp.unlink('/' + f.path, (e) => e ? rej(e) : res()))
    onProgress?.(++done, total)
  }
  for (const d of dirs) {
    await new Promise<void>((res, rej) => sftp.rmdir('/' + d.path, (e) => e ? rej(e) : res()))
    onProgress?.(++done, total)
  }
  await new Promise<void>((res, rej) => sftp.rmdir('/' + root, (e) => e ? rej(e) : res()))
  onProgress?.(++done, total)
  return files.length
}

export class RemoteFsDriver implements FsDriver {
  readonly writable = true

  constructor(private readonly profile: RemoteProfile) {}

  private get isFtp(): boolean {
    return this.profile.protocol === 'ftp'
  }

  /** 远程绝对路径：profile.remoteDir 为根（缺省 /）；内部 `/a/b` 去掉前导 / 再拼 root */
  private abs(path: string): string {
    const rel = normalizeRootRel(path).replace(/^\//, '')
    const root = (this.profile.remoteDir?.replace(/\/+$/, '') || '')
    const joined = root && rel ? `${root}/${rel}` : (root || (rel ? `/${rel}` : '/'))
    return joined.startsWith('/') ? joined : `/${joined}`
  }

  async list(path: string, opts?: { pageSize?: number; cursor?: string | null }): Promise<FsListPage> {
    const offset = Math.max(0, Math.floor(Number(opts?.cursor) || 0))
    const pageSize = Math.max(1, Math.min(2000, Math.floor(opts?.pageSize ?? 1000)))
    const dir = this.abs(path)
    const all: FsEntry[] = this.isFtp
      ? await withFtp(this.profile, async (client) => {
          const raw = await client.list(dir)
          const out: FsEntry[] = []
          for (const i of raw) {
            if (i.name === '.' || i.name === '..') continue
            out.push({
              kind: i.isDirectory ? 'dir' : 'file',
              name: i.name,
              path: fsJoin(path, i.name),
              size: i.isDirectory ? undefined : (i.size ?? 0),
              modified: i.modifiedAt ? i.modifiedAt.getTime() : undefined,
            })
          }
          return out
        })
      : await withSftp(this.profile, async (sftp) => {
          const raw = await new Promise<{ filename: string; attrs: { isDirectory(): boolean; size?: number; mtime?: number; mode?: number; uid?: number; gid?: number } }[]>((res) => {
            sftp.readdir(dir, (e, l) => res(e ? [] : (l ?? []) as never))
          })
          const out: FsEntry[] = []
          for (const i of raw) {
            if (i.filename === '.' || i.filename === '..') continue
            let isDir = false
            try { isDir = i.attrs?.isDirectory?.() ?? false } catch { isDir = false }
            out.push({
              kind: isDir ? 'dir' : 'file',
              name: i.filename,
              path: fsJoin(path, i.filename),
              size: isDir ? undefined : Number(i.attrs?.size ?? 0) || 0,
              modified: Number(i.attrs?.mtime ?? 0) ? Number(i.attrs?.mtime) * 1000 : undefined,
              // §十一 扩展列：mode 补齐目录；属主/属组 uid/gid 读不到名称显示数字
              mode: i.attrs?.mode != null ? ((i.attrs.mode & 0o7777).toString(8).padStart(4, '0')) : undefined,
              owner: Number.isFinite(i.attrs?.uid) ? String(i.attrs?.uid) : undefined,
              group: Number.isFinite(i.attrs?.gid) ? String(i.attrs?.gid) : undefined,
            })
          }
          return out
        })
    const sorted = sortFsEntries(all)
    return {
      entries: sorted.slice(offset, offset + pageSize),
      nextCursor: offset + pageSize < sorted.length ? String(offset + pageSize) : null,
    }
  }

  async stat(path: string): Promise<FsStatResult> {
    const dir = this.abs(path)
    const parent = dir.slice(0, dir.lastIndexOf('/')) || '/'
    const name = fsBasename(path)
    if (this.isFtp) {
      return await withFtp(this.profile, async (client) => {
        const list = await client.list(parent)
        const hit = list.find((i) => i.name === name)
        if (!hit) return { exists: false }
        return {
          exists: true,
          isDir: hit.isDirectory,
          size: hit.size ?? 0,
          modified: hit.modifiedAt ? hit.modifiedAt.getTime() : undefined,
          etag: `${hit.size ?? 0}:${hit.modifiedAt ? hit.modifiedAt.getTime() : 0}`,
        }
      })
    }
    return await withSftp(this.profile, async (sftp) => {
      const st = await new Promise<{ size?: number; mtime?: number; isDirectory(): boolean } | null>((res) => {
        sftp.stat(dir, (e, s) => res(e ? null : s as never))
      })
      if (!st) return { exists: false }
      return {
        exists: true,
        isDir: st.isDirectory(),
        size: Number(st.size ?? 0) || 0,
        modified: Number(st.mtime ?? 0) ? Number(st.mtime) * 1000 : undefined,
        etag: `${st.size ?? 0}:${st.mtime ?? 0}`,
      }
    })
  }

  async mkdir(path: string): Promise<void> {
    const dir = this.abs(path)
    if (this.isFtp) {
      await withFtp(this.profile, (client) => client.ensureDir(dir))
      return
    }
    await withSftp(this.profile, (sftp) => sftpMkdirp(sftp, dir))
  }

  async rmFile(path: string): Promise<void> {
    const target = this.abs(path)
    if (this.isFtp) {
      await withFtp(this.profile, (client) => client.remove(target))
      return
    }
    await withSftp(this.profile, (sftp) => new Promise<void>((res, rej) => {
      sftp.unlink(target, (e) => e ? rej(e) : res())
    }))
  }

  /** 删除权限前置探测（用户 2026-11-18）：在目标目录真实「建 0 字节探测文件 + 删除」往返——
   *  同时证明目录可写与可删（单纯 unlink 不存在文件不可靠：Linux 先查存在性返回 ENOENT，
   *  探不出父目录权限）。探测文件零残留；任何一步失败都拒绝执行（失败原因如实附上） */
  async ensureCanDelete(op: string, dir = ''): Promise<void> {
    const probeRel = `${dir ? `${dir}/` : ''}.sshk-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await this.write(probeRel, Buffer.alloc(0))
    } catch (err) {
      throw deleteDeniedError(op, `远程目录「${dir || '(根)'}」不可写（${String((err as Error)?.message ?? err)}）`)
    }
    try {
      await this.rmFile(probeRel)
    } catch (err) {
      // 探测文件删不掉 = 无删除权限；探测文件会残留（.sshk-probe-* 前缀，便于识别清理）
      throw deleteDeniedError(op, `远程目录「${dir || '(根)'}」无删除权限（${String((err as Error)?.message ?? err)}）`)
    }
  }

  async rmDir(path: string, onProgress?: (done: number, total: number) => void): Promise<number> {
    // 递归删除不可逆：删除前先探测目录可写，无权限时一个文件都不动
    await this.ensureCanDelete('删除目录', path)
    const target = this.abs(path)
    if (this.isFtp) {
      // basic-ftp removeDir 即递归删；无法逐项计进度，整体一个进度脉冲
      await withFtp(this.profile, (client) => client.removeDir(target))
      onProgress?.(1, 1)
      return 1
    }
    return await withSftp(this.profile, (sftp) => sftpRmDir(sftp, path, onProgress))
  }

  async cp(src: string, dest: string): Promise<void> {
    const { data } = await this.readBuffer(src)
    await this.write(dest, data)
  }

  async mv(src: string, dest: string): Promise<void> {
    const from = this.abs(src)
    const to = this.abs(dest)
    // 先保证目标父目录存在（跨目录移动常见）
    const parentRel = fsParentOf(dest)
    if (parentRel !== '/') await this.mkdir(parentRel)
    if (this.isFtp) {
      await withFtp(this.profile, (client) => client.rename(from, to))
      return
    }
    await withSftp(this.profile, (sftp) => new Promise<void>((res, rej) => {
      sftp.rename(from, to, (e) => e ? rej(e) : res())
    }))
  }

  /** chmod（§十一 编辑权限）：仅 SFTP 支持（FTP 协议无 chmod）；modeOctal 3-4 位八进制 */
  async chmod(path: string, modeOctal: string): Promise<void> {
    if (this.isFtp) throw new Error('FTP 协议不支持 chmod（请改用 SFTP 通道）')
    if (!/^0?[0-7]{3,4}$/.test(modeOctal)) throw new Error(`非法权限串：${modeOctal}（须为 3-4 位八进制）`)
    const target = this.abs(path)
    await withSftp(this.profile, (sftp) => new Promise<void>((res, rej) => {
      sftp.chmod(target, parseInt(modeOctal, 8), (e) => e ? rej(e) : res())
    }))
  }

  async readBuffer(path: string): Promise<{ data: Buffer; size: number; modified?: number; etag?: string }> {
    const target = this.abs(path)
    if (this.isFtp) {
      return await withFtp(this.profile, async (client) => {
        const sink = memorySink()
        await client.downloadTo(sink, target)
        const data = sink.data()
        return { data, size: data.length }
      })
    }
    return await withSftp(this.profile, (sftp) => new Promise((res, rej) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(target)
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('error', (e: Error) => rej(e))
      stream.on('end', () => {
        const data = bufferFromChunks(chunks)
        res({ data, size: data.length })
      })
    }))
  }

  async write(path: string, body: Buffer | Readable, onProgress?: (bytes: number) => void): Promise<void> {
    const target = this.abs(path)
    const parentRel = fsParentOf(path)
    if (parentRel !== '/') await this.mkdir(parentRel)
    if (this.isFtp) {
      await withFtp(this.profile, async (client) => {
        if (Buffer.isBuffer(body)) {
          onProgress?.(body.length)
          await client.uploadFrom(Readable.from(body), target)
        } else {
          await client.uploadFrom(body.pipe(countingStream(onProgress)), target)
        }
      })
      return
    }
    await withSftp(this.profile, (sftp) => new Promise<void>((res, rej) => {
      const ws = sftp.createWriteStream(target)
      const src = Buffer.isBuffer(body) ? Readable.from(body) : body.pipe(countingStream(onProgress))
      src.on('error', (e: Error) => { ws.destroy(); rej(e) })
      ws.on('error', (e: Error) => rej(e))
      ws.on('close', () => res())
      src.pipe(ws)
    }))
  }

  async download(path: string, destFile: string, onProgress?: (bytes: number) => void): Promise<void> {
    const target = this.abs(path)
    const counter = countingStream(onProgress)
    if (this.isFtp) {
      await withFtp(this.profile, (client) => client.downloadTo(counter, target))
    } else {
      await withSftp(this.profile, (sftp) => new Promise<void>((res, rej) => {
        const rs = sftp.createReadStream(target)
        const out = createWriteStream(destFile)
        rs.on('error', (e: Error) => { out.destroy(); rej(e) })
        counter.on('error', (e: Error) => { out.destroy(); rej(e) })
        out.on('error', (e: Error) => rej(e))
        counter.on('finish', () => res())
        rs.pipe(counter).pipe(out)
      }))
    }
  }

  /** 递归搜索：单连接 BFS（限深 6 / 总量 2 万），名称子串匹配文件 */
  async search(path: string, keyword: string, opts?: { maxResults?: number; maxPages?: number; onBatch?: FsSearchBatchFn }): Promise<FsSearchResult> {
    const base = normalizeRootRel(path)
    const kw = keyword.trim().toLowerCase()
    const maxResults = Math.max(1, Math.min(1000, Math.floor(opts?.maxResults ?? 300)))
    const out: FsEntry[] = []
    let batch: FsEntry[] = []
    let scannedDirs = 0
    const flush = (done: boolean): void => {
      if (!done && batch.length === 0) return
      opts?.onBatch?.({ entries: batch, scannedDirs, done })
      batch = []
    }
    const listPageFn = (dirRel: string): Promise<FsEntry[]> => this.list(dirRel, { pageSize: 2000 }).then((p) => p.entries)
    const truncated = await walkRemote(base, listPageFn, ({ entry }) => {
      if (entry.kind !== 'file' || !nameMatches(entry.name, kw)) return
      out.push(entry)
      batch.push(entry)
      if (batch.length >= 20) flush(false) // 攒够一批立即推，界面边扫边显
      if (out.length >= maxResults) return 'stop'
    }, () => { scannedDirs += 1 })
    flush(true)
    return { entries: sortFsEntries(out), truncated }
  }

  /** 目录容量统计：BFS 求和（限深 6 / 总量 2 万，截断时 truncated=true） */
  async usage(path: string): Promise<FsUsageResult> {
    const base = normalizeRootRel(path)
    let size = 0
    let files = 0
    const listPageFn = (dirRel: string): Promise<FsEntry[]> => this.list(dirRel, { pageSize: 2000 }).then((p) => p.entries)
    const truncated = await walkRemote(base, listPageFn, ({ entry }) => {
      if (entry.kind !== 'file') return
      size += entry.size ?? 0
      files += 1
    })
    return { size, files, truncated }
  }
}

/** dest 的父目录（内部规范形式，根 = `/`） */
function fsParentOf(dest: string): string {
  return fsParent(dest)
}
