import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShareHub, ttlMinutesLeft, LEGACY_SHARE_STATE_FILES } from './index'

const dirs: string[] = []
const hubs: ShareHub[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sshk-hub-${prefix}-`))
  dirs.push(dir)
  return dir
}

function makeHub(): { hub: ShareHub; root: string; state: string } {
  const base = tempDir('case')
  const root = join(base, 'root')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'hello.txt'), 'hello sharehub')
  writeFileSync(join(root, 'index.html'), '<h1>entry</h1>')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'nested.txt'), 'nested')
  const state = join(base, 'hub-state.json')
  const hub = new ShareHub(state)
  hubs.push(hub)
  return { hub, root, state }
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.clear()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ShareHub 内核（plans/09 · A 组单测）', () => {
  it('create → 路由 ticket（id/token/urls/expiresAt），listRoutes 可见', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const ticket = await hub.create({ toolId: 'badge-studio', label: '海报A', root })
    expect(ticket.id).toBeTruthy()
    expect(ticket.token).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(ticket.expiresAt).toBeGreaterThan(Date.now())
    expect(ticket.urls[0]).toContain(`/${ticket.token}/`)
    const rows = hub.listRoutes()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ toolId: 'badge-studio', label: '海报A', hits: 0 })
  })

  it('create 校验：root 不存在 / 空 / 越界 entry 均抛错', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    await expect(hub.create({ toolId: 't', label: 'x', root: '' })).rejects.toThrow('根目录')
    await expect(hub.create({ toolId: 't', label: 'x', root: join(root, 'nope') })).rejects.toThrow('不存在')
    await expect(hub.create({ toolId: 't', label: 'x', root, entry: '../evil' })).rejects.toThrow()
  })

  it('revoke 只删目标路由；renew 重算 expiresAt', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const a = await hub.create({ toolId: 't1', label: 'a', root })
    const b = await hub.create({ toolId: 't2', label: 'b', root })
    expect(await hub.revoke(a.id)).toBe(true)
    expect(await hub.revoke(a.id)).toBe(false)
    expect(hub.listRoutes().map((r) => r.id)).toEqual([b.id])
    const renewed = await hub.renew(b.id, 5)
    expect(renewed.expiresAt).toBeGreaterThan(Date.now() + 4 * 3600_000)
    expect(() => hub.listRoutes('t1')).not.toThrow()
    expect(hub.listRoutes('t1')).toHaveLength(0)
  })

  it('静态服务：入口/资源可访问、命中计数、Range 206、目录穿越 404', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const ticket = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html' })
    const base = `http://127.0.0.1:${port}`

    const entry = await fetch(`${base}/${ticket.token}/`)
    expect(entry.status).toBe(200)
    expect(await entry.text()).toContain('entry')

    const file = await fetch(`${base}/${ticket.token}/hello.txt`)
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('hello sharehub')
    expect(hub.listRoutes()[0]!.hits).toBeGreaterThanOrEqual(2)

    const range = await fetch(`${base}/${ticket.token}/hello.txt`, { headers: { range: 'bytes=0-4' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe('bytes 0-4/14')
    expect(await range.text()).toBe('hello')

    const traversal = await fetch(`${base}/${ticket.token}/%2e%2e/%2e%2e/etc/passwd`)
    expect(traversal.status).toBe(404)
  })

  it('口令：设置 password 后无 key → 403，带 key → 200', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html', password: 'sekret' })
    const base = `http://127.0.0.1:${port}/${t.token}/`
    expect((await fetch(base)).status).toBe(403)
    expect((await fetch(`${base}?key=sekret`)).status).toBe(200)
    expect((await fetch(`${base}index.html?key=wrong`)).status).toBe(403)
    expect((await fetch(`${base}index.html?key=sekret`)).status).toBe(200)
  })

  it('TTL 到期：命中时惰性校验 → 404 + 路由摘除', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, ttlHours: 0.01, entry: 'index.html' })
    await new Promise((r) => setTimeout(r, 100))
    // 直接改内部到期时间以加速（0.01h = 36s，测试不能等）
    const internal = (hub as unknown as { routes: Map<string, { expiresAt: number }> }).routes.get(t.token)!
    internal.expiresAt = Date.now() - 1
    const res = await fetch(`http://127.0.0.1:${port}/${t.token}/`)
    expect(res.status).toBe(404)
    expect(hub.listRoutes()).toHaveLength(0)
  })

  it('状态持久化：未过期路由 resume 恢复；clear 删除状态文件', async () => {
    const { hub, root, state } = makeHub()
    await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'persist', root })
    await new Promise((r) => setTimeout(r, 650)) // 等 500ms 节流落盘
    expect(existsSync(state)).toBe(true)
    const saved = JSON.parse(readFileSync(state, 'utf8')) as { routes: { token: string }[] }
    expect(saved.routes.some((r) => r.token === t.token)).toBe(true)

    const hub2 = new ShareHub(state)
    hubs.push(hub2)
    await hub2.start(0)
    expect(hub2.listRoutes().map((r) => r.id)).toContain(t.id)
    await hub.clear()
    expect(existsSync(state)).toBe(false)
  })

  it('displayIp / listIps：有网卡返回真实 IP，优选优先级合理；手输优先', () => {
    const { hub } = makeHub()
    const ips = hub.listIps()
    expect(Array.isArray(ips)).toBe(true)
    for (const x of ips) expect(x.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    const auto = hub.displayIp()
    expect(auto).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    hub.setPreferredIp('8.8.8.8')
    expect(hub.displayIp()).toBe('8.8.8.8')
  })

  it('status() 返回 running/port/displayIp/routes/logs，访问日志有条目', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html' })
    await fetch(`http://127.0.0.1:${port}/${t.token}/`)
    await new Promise((r) => setTimeout(r, 20))
    const s = hub.status()
    expect(s.running).toBe(true)
    expect(s.port).toBe(port)
    expect(s.displayIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(Array.isArray(s.ips)).toBe(true)
    expect(s.routes).toHaveLength(1)
    expect(s.logs.length).toBeGreaterThanOrEqual(1)
    expect(s.logs[0]).toMatchObject({ status: 200, routeId: t.id })
  })

  it('stop 保留路由、restart 恢复端口可用；ttlMinutesLeft / 旧文件常量', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root })
    await hub.stop()
    expect(hub.running).toBe(false)
    expect(hub.listRoutes()).toHaveLength(1)
    const { port } = await hub.restart()
    expect(port).toBeGreaterThan(0)
    expect((await fetch(`http://127.0.0.1:${port}/${t.token}/`)).status).toBe(200)
    expect(ttlMinutesLeft(Date.now() + 3600_000)).toBeGreaterThanOrEqual(59)
    expect(LEGACY_SHARE_STATE_FILES).toContain('badge-share-state.json')
    expect(LEGACY_SHARE_STATE_FILES).toContain('edm-share-state.json')
  })
})
