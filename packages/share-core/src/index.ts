import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resolveSafe } from '@sshk/repository'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

/**
 * 局域网只读分享内核（C-T1 由 edm-studio/src/main/share.ts 抽取）：
 * - 绑定内网网卡 IP，随机 token 路径 + TTL；token 过期即 404
 * - 只读 serveRoot 下文件；路径穿越受 resolveSafe 保护
 * - EDM：serveRoot = <root>/outputs；badge：serveRoot = 产物根（html + assets 同源可访问）
 */
interface PersistedShare {
  token: string
  expiresAt: number
  port: number
}

export class ShareServer {
  private server: Server | null = null
  private token = ''
  private _expiresAt = 0
  private port = 0

  /** stateFile：分享会话持久化路径（userData 下）。null 表示不持久化（向后兼容既有调用）。 */
  constructor(private readonly serveRoot: string, private readonly stateFile: string | null = null) {}

  get running(): boolean {
    return this.server !== null
  }

  /** 应用启动时恢复未过期的分享会话（项11：72h 内跨重启仍可访问，token 不变 → 链接不变）。
   *  - 状态文件不存在 / 已过期 / 结构非法 → 返回 null（不启动）；
   *  - 重新 start 会生成新 token 并覆盖状态文件 → 旧链接自动失效。 */
  async resume(requestedPort = 0): Promise<{ port: number; token: string; expiresAt: number; urls: string[] } | null> {
    if (!this.stateFile || !existsSync(this.stateFile) || this.running) return null
    let saved: PersistedShare
    try {
      saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as PersistedShare
      if (!saved?.token || !saved.expiresAt || Date.now() > saved.expiresAt) return null
    } catch {
      return null
    }
    this.token = saved.token
    this._expiresAt = saved.expiresAt
    await this.listen(saved.port || requestedPort)
    return { port: this.port, token: this.token, expiresAt: this._expiresAt, urls: this.urls() }
  }

  private async listen(requestedPort: number): Promise<void> {
    const root = this.serveRoot
    this.server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://local')
        // 路径首段必须是有效 token
        const token = url.pathname.split('/')[1] ?? ''
        if (token !== this.token || Date.now() > this._expiresAt) {
          res.writeHead(404).end('Not Found')
          return
        }
        const rel = decodeURIComponent(url.pathname.slice(this.token.length + 2))
        if (rel === '') {
          res.writeHead(400).end('缺少产物相对路径')
          return
        }
        const abs = resolveSafe(root, rel)
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
  }

  private async persistState(): Promise<void> {
    if (!this.stateFile) return
    const state: PersistedShare = { token: this.token, expiresAt: this._expiresAt, port: this.port }
    await writeFile(this.stateFile, JSON.stringify(state), 'utf8').catch(() => { /* 落盘失败不影响当次分享 */ })
  }

  /** 当前会话过期时间戳（未启动时为 0） */
  get expiresAt(): number {
    return this._expiresAt
  }

  async start(ttlHours: number, requestedPort: number): Promise<{ port: number; token: string; expiresAt: number; urls: string[] }> {
    await this.stop()
    // 项11：每次「重新生成」都换新 token → 旧链接自动失效
    this.token = randomBytes(12).toString('base64url')
    this._expiresAt = Date.now() + ttlHours * 3600_000
    await this.listen(requestedPort)
    await this.persistState()
    return { port: this.port, token: this.token, expiresAt: this._expiresAt, urls: this.urls() }
  }

  async stop(): Promise<void> {
    const srv = this.server
    if (!srv) return
    // keep-alive 长连接会让 close 回调一直不触发（表现为「停止分享」无反应）：
    // 主动断开全部连接，并加 1.5s 兜底超时保证 resolve
    srv.closeAllConnections?.()
    await new Promise<void>((resolve) => {
      srv.close(() => resolve())
      const t = setTimeout(resolve, 1500)
      srv.once('close', () => clearTimeout(t))
    })
    this.server = null
    this.token = ''
    this._expiresAt = 0
    if (this.stateFile) await unlink(this.stateFile).catch(() => { /* 文件本就不存在，忽略 */ })
  }

  /**
   * 分享某产物的完整链接（rel 相对 serveRoot）。
   * 前缀裁决（2026-11-16 修复 badge 分享 404）：badge 的 serveRoot=产物根、rel 自带
   * `outputs/` 前缀且真实存在——必须保留；EDM 旧调用传的 outputs/ 前缀相对
   * serveRoot=<root>/outputs 不存在，剥掉后才命中。按「剥掉后文件是否存在」判定，
   * 两种形态共存不冲突。
   */
  linkFor(rel: string): string {
    if (!this.server) throw new Error('分享服务未启动')
    const clean = rel.replaceAll('\\', '/').replace(/^\//, '')
    const stripped = clean.replace(/^outputs\//, '')
    if (stripped !== clean) {
      const fullExists = existsSync(join(this.serveRoot, ...clean.split('/')))
      const strippedExists = existsSync(join(this.serveRoot, ...stripped.split('/')))
      if (!fullExists && strippedExists) return `${this.urls()[0]}/${stripped}`
    }
    return `${this.urls()[0]}/${clean}`
  }

  urls(): string[] {
    if (!this.server) return []
    const urls: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        // 只取内网 IPv4（D15：绑内网网卡）
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
