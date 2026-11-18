import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { FsEntry, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'
import { fsJoin, normalizeRootRel } from '../fs-paths'
import { deleteDeniedError, type FsDriver } from '../fs-driver'
import { nameMatches, sortFsEntries, walkRemote, type FsSearchBatchFn } from '../fs-driver'

/**
 * 本地目录文件系统驱动（二期，2026-11-17 用户定版：通道顺序 云→远端→本地）。
 * 根 = 上传配置的「本地默认目录」（cfg.local.defaultDir）；路径语义与远程/云一致（根相对）。
 */

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

async function pipeToFile(src: Readable, destFile: string, onProgress?: (bytes: number) => void): Promise<void> {
  await new Promise<void>((res, rej) => {
    const out = createWriteStream(destFile)
    const counter = countingStream(onProgress)
    src.on('error', (e: Error) => { out.destroy(); rej(e) })
    counter.on('error', (e: Error) => { out.destroy(); rej(e) })
    out.on('error', (e: Error) => rej(e))
    counter.on('finish', () => res())
    src.pipe(counter).pipe(out)
  })
}

export class LocalFsDriver implements FsDriver {
  readonly writable = true

  constructor(private readonly rootDir: string) {}

  /** 本地绝对路径：rootDir 为根；内部路径 `/a/b` 去掉前导 / 后拼接（本地绝对路径不带该 /） */
  private abs(p: string): string {
    const rel = normalizeRootRel(p).replace(/^\//, '')
    const root = this.rootDir.replace(/[\\/]+$/, '')
    return rel ? path.join(root, ...rel.split('/')) : root
  }

  async list(p: string, opts?: { pageSize?: number; cursor?: string | null }): Promise<FsListPage> {
    const offset = Math.max(0, Math.floor(Number(opts?.cursor) || 0))
    const pageSize = Math.max(1, Math.min(2000, Math.floor(opts?.pageSize ?? 1000)))
    const dir = this.abs(p)
    const out: FsEntry[] = []
    let names: string[] = []
    try { names = readdirSync(dir).sort() } catch { /* 目录不存在/无权限：空列表 */ }
    for (const name of names) {
      let st
      try { st = statSync(path.join(dir, name)) } catch { continue }
      const isDir = st.isDirectory()
      // §十一 扩展列：创建时间 birthtime / 权限 mode / 属主属组 uid/gid（读不到名称显示数字）
      out.push({
        kind: isDir ? 'dir' : 'file',
        name,
        path: fsJoin(p, name),
        size: isDir ? undefined : st.size,
        modified: st.mtimeMs,
        createdAt: st.birthtimeMs > 0 ? st.birthtimeMs : undefined,
        mode: (st.mode & 0o7777).toString(8).padStart(4, '0'),
        owner: Number.isFinite(st.uid) ? String(st.uid) : undefined,
        group: Number.isFinite(st.gid) ? String(st.gid) : undefined,
      })
    }
    const sorted = sortFsEntries(out)
    return {
      entries: sorted.slice(offset, offset + pageSize),
      nextCursor: offset + pageSize < sorted.length ? String(offset + pageSize) : null,
    }
  }

  async stat(p: string): Promise<FsStatResult> {
    let st
    try { st = statSync(this.abs(p)) } catch { return { exists: false } }
    const isDir = st.isDirectory()
    return {
      exists: true,
      isDir,
      size: isDir ? undefined : st.size,
      modified: st.mtimeMs,
      etag: `${st.size}:${st.mtimeMs}`,
    }
  }

  async mkdir(p: string): Promise<void> {
    mkdirSync(this.abs(p), { recursive: true })
  }

  async rmFile(p: string): Promise<void> {
    rmSync(this.abs(p), { force: true })
  }

  /** 删除权限前置探测（用户 2026-11-18）：本地删除权限 = 目录可写——在目标目录内
   *  试建+试删一个空探测文件（Windows/POSIX 通用，同时证明写与删），零残留零副作用 */
  async ensureCanDelete(op: string, dir = ''): Promise<void> {
    const base = this.abs(dir || '')
    const probe = path.join(base, `.sshk-probe-${process.pid}-${Date.now().toString(36)}.tmp`)
    try {
      writeFileSync(probe, '')
      rmSync(probe, { force: true })
    } catch (err) {
      throw deleteDeniedError(op, `本地目录「${base}」不可写（${String((err as Error)?.message ?? err)}）`)
    }
  }

  async rmDir(p: string, onProgress?: (done: number, total: number) => void): Promise<number> {
    // rmSync recursive 一次完成；无法逐项计进度，整体一个进度脉冲。
    // 删除前先探测目录可写（递归删除不可逆，无权限时一个文件都不该动）
    await this.ensureCanDelete('删除目录', p)
    rmSync(this.abs(p), { recursive: true, force: true })
    onProgress?.(1, 1)
    return 1
  }

  async cp(src: string, dest: string): Promise<void> {
    copyFileSync(this.abs(src), this.abs(dest))
  }

  /** chmod（§十一 编辑权限）：Windows 实际只影响只读位，POSIX 全量生效 */
  async chmod(p: string, modeOctal: string): Promise<void> {
    if (!/^0?[0-7]{3,4}$/.test(modeOctal)) throw new Error(`非法权限串：${modeOctal}（须为 3-4 位八进制）`)
    chmodSync(this.abs(p), parseInt(modeOctal, 8))
  }

  async mv(src: string, dest: string): Promise<void> {
    const to = this.abs(dest)
    mkdirSync(path.dirname(to), { recursive: true })
    renameSync(this.abs(src), to)
  }

  async readBuffer(p: string): Promise<{ data: Buffer; size: number; modified?: number }> {
    const data = readFileSync(this.abs(p))
    return { data, size: data.length }
  }

  async write(p: string, body: Buffer | Readable, onProgress?: (bytes: number) => void): Promise<void> {
    const target = this.abs(p)
    mkdirSync(path.dirname(target), { recursive: true })
    if (Buffer.isBuffer(body)) {
      writeFileSync(target, body)
      onProgress?.(body.length)
      return
    }
    await pipeToFile(body, target, onProgress)
  }

  async download(p: string, destFile: string, onProgress?: (bytes: number) => void): Promise<void> {
    await pipeToFile(createReadStream(this.abs(p)), destFile, onProgress)
  }

  /** 递归搜索：复用 walkRemote BFS（限深 6 / 总量 2 万） */
  async search(p: string, keyword: string, opts?: { maxResults?: number; onBatch?: FsSearchBatchFn }): Promise<FsSearchResult> {
    const base = normalizeRootRel(p)
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
    const truncated = await walkRemote(base, (dirRel) => this.list(dirRel, { pageSize: 2000 }).then((r) => r.entries), ({ entry }) => {
      if (entry.kind !== 'file' || !nameMatches(entry.name, kw)) return
      out.push(entry)
      batch.push(entry)
      if (batch.length >= 20) flush(false) // 攒够一批立即推，界面边扫边显
      if (out.length >= maxResults) return 'stop'
    }, () => { scannedDirs += 1 })
    flush(true)
    return { entries: sortFsEntries(out), truncated }
  }

  /** 目录容量统计：BFS 求和（截断时 truncated=true） */
  async usage(p: string): Promise<FsUsageResult> {
    const base = normalizeRootRel(p)
    let size = 0
    let files = 0
    const truncated = await walkRemote(base, (dirRel) => this.list(dirRel, { pageSize: 2000 }).then((r) => r.entries), ({ entry }) => {
      if (entry.kind !== 'file') return
      size += entry.size ?? 0
      files += 1
    })
    return { size, files, truncated }
  }
}
