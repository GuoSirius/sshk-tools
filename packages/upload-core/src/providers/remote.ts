import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Client as FtpClient } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import type { UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

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
}
