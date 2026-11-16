import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Client as FtpClient } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import { byNewestFirst, isImageFileName } from '../image-files'
import { joinDir, MAX_DIRECTORIES, MAX_DIRECTORY_DEPTH, DIRECTORY_LIST_BUDGET_MS } from '../directories'
import type { UploadedImageInfo, UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

/** T4：远程 profile（ftp | sftp 合并，protocol 区分）。连接信息由 main 进程从 settings/safeStorage 解析后注入 */
export interface RemoteProfile {
  protocol: 'ftp' | 'sftp'
  host: string
  port?: number
  username: string
  password: string
  remoteDir?: string
  passive?: boolean
  /** 可选：拼接可访问 URL 的基址 */
  baseUrl?: string
}

export class RemoteUploadProvider implements UploadProvider {
  readonly type = 'remote' as const

  constructor(private readonly profile: RemoteProfile) {}

  async upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult> {
    const name = path.basename(file.name)
    const dir = ctx.overrides?.remotePath || this.profile.remoteDir || '/'
    const remotePath = `${dir.replace(/\/+$/, '')}/${name}`
    const payload = this.payloadOf(file)

    if (this.profile.protocol === 'ftp') await this.ftpUpload(file, payload, remotePath)
    else await this.sftpUpload(file, payload, remotePath)

    const url = this.profile.baseUrl
      ? `${this.profile.baseUrl.replace(/\/+$/, '')}/${name}`
      : `${this.profile.protocol}://${this.profile.host}${remotePath}`
    return { url, key: remotePath, name: file.name }
  }

  /** 列出远端目录下已有图片（新在前）；无 baseUrl 时回填 protocol://host 形式 URL */
  async listImages(ctx: UploadContext & { limit?: number }): Promise<UploadedImageInfo[]> {
    const dir = (ctx.overrides?.remotePath || this.profile.remoteDir || '/').replace(/\/+$/, '') || '/'
    const limit = ctx.limit ?? 200
    if (this.profile.protocol === 'ftp') {
      const client = new FtpClient()
      try {
        await client.access({
          host: this.profile.host,
          port: this.profile.port ?? 21,
          user: this.profile.username,
          password: this.profile.password,
          secure: false,
        })
        const list = await client.list(dir)
        return list
          .filter((i) => !i.isDirectory && isImageFileName(i.name))
          .slice(0, limit)
          .map((i) => ({
            url: this.urlFor(dir, i.name),
            key: `${dir}/${i.name}`,
            name: i.name,
            size: i.size ?? 0,
            modified: i.modifiedAt ? i.modifiedAt.getTime() : 0,
          }))
          .sort(byNewestFirst)
      } finally {
        client.close()
      }
    }
    return await new Promise<UploadedImageInfo[]>((resolve, reject) => {
      const conn = new SshClient()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end()
            reject(err)
            return
          }
          sftp.readdir(dir, (e, list) => {
            conn.end()
            if (e) {
              reject(e)
              return
            }
            resolve(
              (list ?? [])
                .filter((i) => isImageFileName(i.filename))
                .slice(0, limit)
                .map((i) => {
                  const attrs = i.attrs as { size?: number; mtime?: number } | undefined
                  return {
                    url: this.urlFor(dir, i.filename),
                    key: `${dir}/${i.filename}`,
                    name: i.filename,
                    size: Number(attrs?.size ?? 0) || 0,
                    modified: Number(attrs?.mtime ?? 0) ? Number(attrs?.mtime) * 1000 : 0,
                  }
                })
                .sort(byNewestFirst),
            )
          })
        })
      })
      conn.on('error', reject)
      conn.connect({
        host: this.profile.host,
        port: this.profile.port ?? 22,
        username: this.profile.username,
        password: this.profile.password,
      })
    })
  }

  /** 列出远端根目录下所有真实子目录的完整相对路径（可多级，含空目录），带深度/数量上限 */
  async listDirectories(ctx: UploadContext): Promise<string[]> {
    const root = (ctx.overrides?.remotePath || this.profile.remoteDir || '/').replace(/\/+$/, '') || '/'
    if (this.profile.protocol === 'ftp') {
      const client = new FtpClient()
      try {
        await client.access({
          host: this.profile.host,
          port: this.profile.port ?? 21,
          user: this.profile.username,
          password: this.profile.password,
          secure: false,
        })
        return await this.ftpWalkDirs(client, root)
      } finally {
        client.close()
      }
    }
    return await this.sftpWalkDirs(root)
  }

  /** FTP 递归列目录（BFS，串行，带上限与时间预算：超时先返回已收集的部分结果） */
  private async ftpWalkDirs(client: FtpClient, root: string): Promise<string[]> {
    const out: string[] = []
    const deadline = Date.now() + DIRECTORY_LIST_BUDGET_MS
    const queue: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: '', depth: 0 }]
    while (queue.length && out.length < MAX_DIRECTORIES && Date.now() < deadline) {
      const cur = queue.shift()!
      if (cur.depth > MAX_DIRECTORY_DEPTH) continue
      let list: Awaited<ReturnType<FtpClient['list']>>
      try { list = await client.list(cur.dir) } catch { continue }
      for (const e of list) {
        if (out.length >= MAX_DIRECTORIES) break
        if (!e.isDirectory || e.name === '.' || e.name === '..') continue
        const full = joinDir(cur.rel, e.name)
        out.push(full)
        queue.push({ dir: `${cur.dir.replace(/\/+$/, '')}/${e.name}`, rel: full, depth: cur.depth + 1 })
      }
    }
    return out.sort((a, b) => a.localeCompare(b))
  }

  /** SFTP 递归列目录（BFS，单连接，带上限与时间预算：超时先返回已收集的部分结果） */
  private sftpWalkDirs(root: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const conn = new SshClient()
      const out: string[] = []
      const deadline = Date.now() + DIRECTORY_LIST_BUDGET_MS
      conn.on('ready', () => {
        conn.sftp(async (err, sftp) => {
          if (err) { conn.end(); reject(err); return }
          const read = (dir: string): Promise<{ filename: string; attrs: { isDirectory(): boolean } }[]> =>
            new Promise((res) => sftp.readdir(dir, (e, list) => res(e ? [] : (list ?? []) as never)))
          const queue: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: '', depth: 0 }]
          try {
            while (queue.length && out.length < MAX_DIRECTORIES && Date.now() < deadline) {
              const cur = queue.shift()!
              if (cur.depth > MAX_DIRECTORY_DEPTH) continue
              const list = await read(cur.dir)
              for (const e of list) {
                if (out.length >= MAX_DIRECTORIES) break
                let isDir = false
                try { isDir = e.attrs?.isDirectory?.() ?? false } catch { isDir = false }
                if (!isDir || e.filename === '.' || e.filename === '..') continue
                const full = joinDir(cur.rel, e.filename)
                out.push(full)
                queue.push({ dir: `${cur.dir.replace(/\/+$/, '')}/${e.filename}`, rel: full, depth: cur.depth + 1 })
              }
            }
            conn.end()
            resolve(out.sort((a, b) => a.localeCompare(b)))
          } catch (e) {
            conn.end()
            reject(e)
          }
        })
      })
      conn.on('error', reject)
      conn.connect({
        host: this.profile.host,
        port: this.profile.port ?? 22,
        username: this.profile.username,
        password: this.profile.password,
      })
    })
  }

  /** 图库 URL 与 upload() 回填口径一致：baseUrl 优先 */
  private urlFor(dir: string, name: string): string {
    if (this.profile.baseUrl) return `${this.profile.baseUrl.replace(/\/+$/, '')}/${name}`
    const p = encodeURI(`${dir}/${name}`)
    return `${this.profile.protocol}://${this.profile.host}${p}`
  }

  private payloadOf(file: UploadFile): Buffer {
    if (file.source && existsSync(file.source)) return readFileSync(file.source)
    return Buffer.from(file.data ?? new Uint8Array())
  }

  private streamOf(file: UploadFile, payload: Buffer): Readable {
    return file.source && existsSync(file.source) ? createReadStream(file.source) : Readable.from([payload])
  }

  private async ftpUpload(file: UploadFile, payload: Buffer, remotePath: string): Promise<void> {
    const client = new FtpClient()
    try {
      await client.access({
        host: this.profile.host,
        port: this.profile.port ?? 21,
        user: this.profile.username,
        password: this.profile.password,
        secure: false,
      })
      const dir = path.posix.dirname(remotePath)
      if (dir && dir !== '/') await client.ensureDir(dir)
      await client.uploadFrom(this.streamOf(file, payload), remotePath)
    } finally {
      client.close()
    }
  }

  private async sftpUpload(file: UploadFile, payload: Buffer, remotePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const conn = new SshClient()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end()
            reject(err)
            return
          }
          const write = sftp.createWriteStream(remotePath)
          write.on('error', (e: Error) => {
            conn.end()
            reject(e)
          })
          write.on('close', () => {
            conn.end()
            resolve()
          })
          this.streamOf(file, payload).pipe(write)
        })
      })
      conn.on('error', reject)
      conn.connect({
        host: this.profile.host,
        port: this.profile.port ?? 22,
        username: this.profile.username,
        password: this.profile.password,
      })
    })
  }

  /** N4：每个 profile 独立测试——只连不写，验证主机 / 端口 / 用户名 / 口令 / 远端位置 */
  async testConnection(): Promise<string> {
    const p = this.profile
    if (!p.host.trim()) throw new Error('主机不能为空')
    if (!p.username.trim()) throw new Error('用户名不能为空')
    if (!p.password) throw new Error('密码 / 口令未配置')
    const dir = p.remoteDir?.trim() || '/'
    if (p.protocol === 'ftp') {
      const client = new FtpClient()
      try {
        await client.access({
          host: p.host,
          port: p.port ?? 21,
          user: p.username,
          password: p.password,
          secure: false,
        })
        const list = await client.list(dir)
        return `FTP 连通：${p.username}@${p.host}:${p.port ?? 21}，远端 ${dir} 可读（${list.length} 项）`
      } finally {
        client.close()
      }
    }
    return await new Promise<string>((resolve, reject) => {
      const conn = new SshClient()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); reject(err); return }
          sftp.readdir(dir, (e, list) => {
            conn.end()
            if (e) reject(e)
            else resolve(`SFTP 连通：${p.username}@${p.host}:${p.port ?? 22}，远端 ${dir} 可读（${list?.length ?? 0} 项）`)
          })
        })
      })
      conn.on('error', reject)
      conn.connect({ host: p.host, port: p.port ?? 22, username: p.username, password: p.password })
    })
  }
}
