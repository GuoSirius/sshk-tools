import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Client as FtpClient } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import { byNewestFirst, isImageFileName } from '../image-files'
import { LIST_BUDGET_MS, MAX_DIRECTORIES, MAX_LIST_DEPTH, MAX_LIST_FILES } from '../directories'
import type { UploadedImageInfo, UploadedImagePage, UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

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

  /**
   * 递归列出远端目录（含全部子目录）下的已有图片（新在前）；无 baseUrl 时回填 protocol://host URL。
   * 与云来源的前缀列举语义一致：选中父目录 = 看到自己 + 所有层级子目录的图。
   * 单连接 BFS 下钻，带目录数/文件数/深度上限与时间预算（超时先返回已收集部分）。
   * cursor 为上一页返回的偏移量（字符串数字），大目录由调用方按页续拉（每次调用重新下钻）。
   */
  async listImages(ctx: UploadContext & { limit?: number; cursor?: string | null }): Promise<UploadedImagePage> {
    const dir = (ctx.overrides?.remotePath || this.profile.remoteDir || '/').replace(/\/+$/, '') || '/'
    const limit = ctx.limit ?? 500
    const offset = Math.max(0, Math.floor(Number(ctx.cursor) || 0))
    const all =
      this.profile.protocol === 'ftp'
        ? await this.ftpListImages(dir)
        : await this.sftpListImages(dir)
    all.sort(byNewestFirst)
    const items = all.slice(offset, offset + limit)
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null
    return { items, nextCursor }
  }

  /** FTP 递归列图（单连接 BFS，带目录/文件/深度上限与时间预算） */
  private async ftpListImages(root: string): Promise<UploadedImageInfo[]> {
    const client = new FtpClient()
    try {
      await client.access({
        host: this.profile.host,
        port: this.profile.port ?? 21,
        user: this.profile.username,
        password: this.profile.password,
        secure: false,
      })
      const out: UploadedImageInfo[] = []
      const deadline = Date.now() + LIST_BUDGET_MS
      const seen = new Set<string>([root])
      const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
      while (queue.length > 0 && out.length < MAX_LIST_FILES && Date.now() < deadline) {
        const cur = queue.shift()!
        if (cur.depth > MAX_LIST_DEPTH) continue
        let list: Awaited<ReturnType<FtpClient['list']>>
        try { list = await client.list(cur.dir) } catch { continue }
        for (const i of list) {
          if (i.name === '.' || i.name === '..') continue
          const full = `${cur.dir === '/' ? '' : cur.dir}/${i.name}`
          if (i.isDirectory) {
            if (!seen.has(full) && cur.depth < MAX_LIST_DEPTH) {
              seen.add(full)
              queue.push({ dir: full, depth: cur.depth + 1 })
            }
          } else if (isImageFileName(i.name) && out.length < MAX_LIST_FILES) {
            out.push({
              url: this.urlFor(cur.dir, i.name),
              key: full,
              name: i.name,
              size: i.size ?? 0,
              modified: i.modifiedAt ? i.modifiedAt.getTime() : 0,
            })
          }
        }
      }
      return out
    } finally {
      client.close()
    }
  }

  /** SFTP 递归列图（单连接 BFS，带目录/文件/深度上限与时间预算） */
  private sftpListImages(root: string): Promise<UploadedImageInfo[]> {
    return new Promise<UploadedImageInfo[]>((resolve, reject) => {
      const conn = new SshClient()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end()
            reject(err)
            return
          }
          const deadline = Date.now() + LIST_BUDGET_MS
          const out: UploadedImageInfo[] = []
          const seen = new Set<string>([root])
          const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
          const read = (dir: string): Promise<{ filename: string; attrs: { isDirectory(): boolean; size?: number; mtime?: number } }[]> =>
            new Promise((res) => sftp.readdir(dir, (e, list) => res(e ? [] : (list ?? []) as never)))
          const walk = async (): Promise<void> => {
            while (queue.length > 0 && out.length < MAX_LIST_FILES && Date.now() < deadline) {
              const cur = queue.shift()!
              const list = await read(cur.dir)
              for (const i of list) {
                if (i.filename === '.' || i.filename === '..') continue
                const full = `${cur.dir === '/' ? '' : cur.dir}/${i.filename}`
                let isDir = false
                try { isDir = i.attrs?.isDirectory?.() ?? false } catch { isDir = false }
                if (isDir) {
                  if (!seen.has(full) && cur.depth < MAX_LIST_DEPTH) {
                    seen.add(full)
                    queue.push({ dir: full, depth: cur.depth + 1 })
                  }
                } else if (isImageFileName(i.filename) && out.length < MAX_LIST_FILES) {
                  out.push({
                    url: this.urlFor(cur.dir, i.filename),
                    key: full,
                    name: i.filename,
                    size: Number(i.attrs?.size ?? 0) || 0,
                    modified: Number(i.attrs?.mtime ?? 0) ? Number(i.attrs?.mtime) * 1000 : 0,
                  })
                }
              }
            }
          }
          walk()
            .then(() => { conn.end(); resolve(out) })
            .catch((e) => { conn.end(); reject(e) })
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

  /** 列出某目录下的直接子目录（单级，配合前端懒加载逐级下钻）；返回绝对远程路径 */
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
        const list = await client.list(root)
        return list
          .filter((i) => i.isDirectory && i.name !== '.' && i.name !== '..')
          .map((i) => `${root === '/' ? '' : root}/${i.name}`)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_DIRECTORIES)
      } finally {
        client.close()
      }
    }
    const list = await this.sftpReadDir(root)
    return list
      .filter((e) => {
        let isDir = false
        try { isDir = e.attrs?.isDirectory?.() ?? false } catch { isDir = false }
        return isDir && e.filename !== '.' && e.filename !== '..'
      })
      .map((e) => `${root === '/' ? '' : root}/${e.filename}`)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_DIRECTORIES)
  }

  /** SFTP 读单级目录条目；读失败返回空（目录不存在等），仅连接级错误向上抛 */
  private sftpReadDir(root: string): Promise<{ filename: string; attrs: { isDirectory(): boolean } }[]> {
    return new Promise((resolve, reject) => {
      const conn = new SshClient()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end()
            reject(err)
            return
          }
          sftp.readdir(root, (e, list) => {
            conn.end()
            if (e) {
              resolve([])
              return
            }
            resolve((list ?? []) as never)
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
