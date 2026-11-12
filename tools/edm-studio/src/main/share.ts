import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Repository } from '@sshk/repository'
import { resolveSafe } from '@sshk/repository'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.css': 'text/css; charset=utf-8',
}

/**
 * 局域网只读分享（需求 11 / D15）：
 * - 绑定内网网卡 IP，随机 token 路径 + TTL；token 过期即 404
 * - 只读 outputs/ 下文件；路径穿越受 resolveSafe 保护
 */
export class ShareServer {
  private server: Server | null = null
  private token = ''
  private expiresAt = 0
  private port = 0

  constructor(private readonly outputRoot: string) {}

  get running(): boolean {
    return this.server !== null
  }

  async start(ttlHours: number, requestedPort: number): Promise<{ port: number; token: string; expiresAt: number; urls: string[] }> {
    await this.stop()
    this.token = randomBytes(12).toString('base64url')
    this.expiresAt = Date.now() + ttlHours * 3600_000
    const root = this.outputRoot

    this.server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://local')
        // 路径首段必须是有效 token
        const token = url.pathname.split('/')[1] ?? ''
        if (token !== this.token || Date.now() > this.expiresAt) {
          res.writeHead(404).end('Not Found')
          return
        }
        const rel = decodeURIComponent(url.pathname.slice(this.token.length + 2))
        if (rel === '') {
          res.writeHead(400).end('缺少产物相对路径')
          return
        }
        const abs = resolveSafe(join(root, 'outputs'), rel)
        const data = await readFile(abs)
        res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream' })
        res.end(data)
      } catch {
        res.writeHead(404).end('Not Found')
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(requestedPort === 0 ? 0 : requestedPort, () => resolve())
    })
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : requestedPort

    const urls: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        // 只取内网 IPv4（D15：绑内网网卡）
        if (ni.family === 'IPv4' && !ni.internal && ni.address.startsWith('192.168.')) {
          urls.push(`http://${ni.address}:${this.port}/${this.token}/`)
        }
      }
    }
    if (urls.length === 0) urls.push(`http://127.0.0.1:${this.port}/${this.token}/`)
    return { port: this.port, token: this.token, expiresAt: this.expiresAt, urls }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
      this.token = ''
    }
  }

  /** 分享某邮件 final.html 的完整链接 */
  linkFor(rel: string): string {
    if (!this.server) throw new Error('分享服务未启动')
    const clean = normalize(rel).replaceAll('\\', '/').replace(/^\/?outputs\//, '')
    return `${this.urls()[0]}/${clean}`
  }

  urls(): string[] {
    if (!this.server) return []
    const urls: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === 'IPv4' && !ni.internal && ni.address.startsWith('192.168.')) {
          urls.push(`http://${ni.address}:${this.port}/${this.token}`)
        }
      }
    }
    if (urls.length === 0) urls.push(`http://127.0.0.1:${this.port}/${this.token}`)
    return urls
  }
}

/** 计算剩余有效期描述（分钟） */
export function ttlMinutesLeft(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
}

export type { Repository }
