import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShareHub, ttlMinutesLeft, LEGACY_SHARE_STATE_FILES } from './index'
import { SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'

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

  it('访问密钥 ak：设置 password 后无 ak → 403，带 ak → 200；ticket.urls 自动带 ?ak=', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html', password: 'sekret' })
    const base = `http://127.0.0.1:${port}/${t.token}/`
    expect((await fetch(base)).status).toBe(403)
    expect((await fetch(`${base}?ak=sekret`)).status).toBe(200)
    expect((await fetch(`${base}index.html?ak=wrong`)).status).toBe(403)
    expect((await fetch(`${base}index.html?ak=sekret`)).status).toBe(200)
    // ticket 返回的链接自带 ?ak=（访客复制即可访问）
    expect(t.urls[0]).toContain('?ak=sekret')
  })

  it('密码继承：子路由未设 password 时继承最近祖先路由的密钥', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const parent = await hub.create({ toolId: 't', label: '整根', root, password: 'root-key' })
    const sub = await hub.create({ toolId: 't', label: '子项', root, entry: 'a/b/file.txt' })
    expect(sub.urls[0]).toContain('?ak=root-key')
    // 显式设置优先于继承
    const own = await hub.create({ toolId: 't', label: '自有', root, entry: 'a/c.txt', password: 'own-key' })
    expect(own.urls[0]).toContain('?ak=own-key')
    expect(parent.urls[0]).toContain('?ak=root-key')
  })

  it('renew patch.password：改密钥后 ticket 链接带新 ak', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, password: 'old' })
    const updated = await hub.renew(t.id, null, 'reset', { password: 'new' })
    expect(updated.urls[0]).toContain('?ak=new')
    expect(updated.urls[0]).not.toContain('?ak=old')
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

  it('status() 返回 running/port/displayIp/routes（无 logs）；访问日志经 logSink 落库且带 UUID id', async () => {
    const { hub, root } = makeHub()
    const flushed: Array<{ id: string; status: number; routeId: string }[]> = []
    hub.setLogSink((rows) => { flushed.push(rows) })
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html' })
    await fetch(`http://127.0.0.1:${port}/${t.token}/`)
    await hub.flushLogs()
    const s = hub.status()
    expect(s.running).toBe(true)
    expect(s.port).toBe(port)
    expect(s.displayIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(Array.isArray(s.ips)).toBe(true)
    expect(s.routes).toHaveLength(1)
    expect('logs' in s).toBe(false)
    const rows = flushed.flat()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]).toMatchObject({ status: 200, routeId: t.id })
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
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

  it('端口治理（2026-11-22）：显式端口被占回落随机+告警回调（服务必须起来）；显式重启端口生效', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const occupied = hub.getPort()
    // 对手占住同端口：requested>0 被占不再启动失败，回落系统随机端口
    const rival = new ShareHub(join(tempDir('rival'), 'hub-state.json'))
    hubs.push(rival)
    const fallbacks: Array<{ requested: number; actual: number }> = []
    rival.setPortFallbackHandler((requested, actual) => fallbacks.push({ requested, actual }))
    const { port: actualPort } = await rival.start(occupied)
    expect(actualPort).toBeGreaterThan(0)
    expect(actualPort).not.toBe(occupied)
    expect(fallbacks).toEqual([{ requested: occupied, actual: actualPort }])
    // 显式重启端口生效（restart 请求>0 优先）：沿用自己刚释放的端口重绑，路由仍可用
    const { port: restarted } = await hub.restart(occupied)
    expect(restarted).toBe(occupied)
    const t = await hub.create({ toolId: 't', label: 'x', root })
    expect((await fetch(`http://127.0.0.1:${restarted}/${t.token}/`)).status).toBe(200)
  })

  it('永久有效（ttlHours=0）：expiresAt=哨兵、JSON 往返、重启 resume 后不失效', async () => {
    const { hub, root, state } = makeHub()
    await hub.start(0)
    const t = await hub.create({ toolId: 't', label: '永久', root, ttlHours: 0 })
    expect(hub.listRoutes()[0]?.ttlHours).toBe(0)
    await hub.stop() // stop 内部 flushPersist 落盘
    const saved = JSON.parse(readFileSync(state, 'utf8')) as { routes: { expiresAt: number }[] }
    expect(saved.routes[0]?.expiresAt).toBe(SHARE_PERMANENT_EXPIRES_AT)
    const revived = new ShareHub(state)
    hubs.push(revived)
    await revived.start(0)
    expect(revived.listRoutes()).toHaveLength(1)
    expect(revived.listRoutes()[0]?.expiresAt).toBe(SHARE_PERMANENT_EXPIRES_AT)
    expect(t.expiresAt).toBe(SHARE_PERMANENT_EXPIRES_AT)
  })

  it('renew：reset 从当前重算、extend 在当前到期上累加、永久路由累加仍永久，token 不变 URL 不变', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, ttlHours: 10 })
    const expectUrl = t.urls[0]

    const reset = await hub.renew(t.id, 5, 'reset')
    expect(reset.token).toBe(t.token)
    expect(reset.urls[0]).toBe(expectUrl)
    expect(reset.expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 3600_000 + 2000)
    expect(reset.expiresAt).toBeGreaterThanOrEqual(Date.now() + 5 * 3600_000 - 2000)

    const extended = await hub.renew(t.id, 3, 'extend')
    expect(extended.token).toBe(t.token)
    expect(extended.urls[0]).toBe(expectUrl)
    // 累加基准是 reset 后的 expiresAt，误差容忍 2s
    expect(extended.expiresAt).toBeGreaterThanOrEqual(reset.expiresAt + 3 * 3600_000 - 2000)
    expect(extended.expiresAt).toBeLessThanOrEqual(reset.expiresAt + 3 * 3600_000 + 2000)

    // 永久化后累加不应撤销永久
    const permanent = await hub.renew(t.id, 0)
    expect(permanent.expiresAt).toBe(SHARE_PERMANENT_EXPIRES_AT)
    const stillPermanent = await hub.renew(t.id, 2, 'extend')
    expect(stillPermanent.expiresAt).toBe(SHARE_PERMANENT_EXPIRES_AT)
    expect(stillPermanent.urls[0]).toBe(expectUrl)
  })

  it('updatedAt：create=createdAt，renew/patch 刷新，访问命中不刷新（plans/12）', async () => {
    const { hub, root } = makeHub()
    const { port } = await hub.start(0)
    const t = await hub.create({ toolId: 't', label: 'x', root, entry: 'index.html', ttlHours: 10 })
    const created = hub.listRoutes().find((r) => r.id === t.id)!
    expect(created.updatedAt).toBe(created.createdAt)

    await new Promise((r) => setTimeout(r, 15))
    await fetch(`http://127.0.0.1:${port}/${t.token}/`)
    const afterHit = hub.listRoutes().find((r) => r.id === t.id)!
    expect(afterHit.updatedAt).toBe(created.updatedAt)
    expect(afterHit.hits).toBeGreaterThan(created.hits)

    await new Promise((r) => setTimeout(r, 15))
    await hub.renew(t.id, null, 'reset', { allowIndex: true })
    const afterRenew = hub.listRoutes().find((r) => r.id === t.id)!
    expect(afterRenew.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('ttlHours 非法（负数/小数）回落默认 72，0 视为永久', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const neg = await hub.create({ toolId: 't', label: 'neg', root, ttlHours: -5 })
    expect(hub.listRoutes().find((r) => r.id === neg.id)?.ttlHours).toBe(72)
    const decimal = await hub.create({ toolId: 't', label: 'dec', root, ttlHours: 1.5 })
    expect(hub.listRoutes().find((r) => r.id === decimal.id)?.ttlHours).toBe(72)
  })

  it('setMounts：enabled=false 的挂载不注册（与契约/文档一致）', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    const skipped = hub.setMounts([
      { id: 'on', dir: root, alias: 'on-dir', enabled: true },
      { id: 'off', dir: root, alias: 'off-dir', enabled: false },
    ])
    expect(skipped.some((s) => s.includes('已禁用'))).toBe(true)
    // 通过真实 HTTP 验证：启用的挂载可达（allowIndex 默认开，根列目录），禁用的挂载 404
    const port = hub.status().port
    const on = await fetch(`http://127.0.0.1:${port}/on-dir/`)
    const off = await fetch(`http://127.0.0.1:${port}/off-dir/`)
    expect(on.status).toBe(200)
    expect(off.status).toBe(404)
  })

  it('setMounts：带 password 的挂载需 ?ak= 才能访问；删密钥后裸链可达', async () => {
    const { hub, root } = makeHub()
    await hub.start(0)
    hub.setMounts([{ id: 'm', dir: root, alias: 'secured', enabled: true, password: 'mount-ak' }])
    const port = hub.status().port
    expect((await fetch(`http://127.0.0.1:${port}/secured/`)).status).toBe(403)
    expect((await fetch(`http://127.0.0.1:${port}/secured/?ak=mount-ak`)).status).toBe(200)
    // 重新 setMounts 覆盖为空密钥 → 裸链恢复可达
    hub.setMounts([{ id: 'm', dir: root, alias: 'secured', enabled: true, password: '' }])
    expect((await fetch(`http://127.0.0.1:${port}/secured/`)).status).toBe(200)
  })
})

describe('ShareHub 内容路由（plans/11 方案 B/C · core 不依赖 repository）', () => {
  it('方案 B：单篇 content 路由走 resolver 渲染阅读页；resolver 返回 null → 404', async () => {
    const { hub } = makeHub()
    await hub.start(0)
    const port = hub.getPort()
    hub.registerContentResolver((id) => id === 'cnt_ok'
      ? { title: '测试文章', html: '<p>正文</p>', summary: '摘要' }
      : null)
    const ok = await hub.create({ toolId: 'file-manager', label: '文章A', root: 'content://contents', kind: 'content', contentId: 'cnt_ok' })
    const dead = await hub.create({ toolId: 'file-manager', label: '文章已删', root: 'content://contents', kind: 'content', contentId: 'cnt_gone' })
    const okRes = await fetch(`http://127.0.0.1:${port}/${ok.token}/`)
    expect(okRes.status).toBe(200)
    const html = await okRes.text()
    expect(html).toContain('测试文章')
    expect(html).toContain('<p>正文</p>')
    expect((await fetch(`http://127.0.0.1:${port}/${dead.token}/`)).status).toBe(404)
    // list 暴露 kind/contentId
    expect(hub.listRoutes().find((r) => r.id === ok.id)).toMatchObject({ kind: 'content', contentId: 'cnt_ok' })
  })

  it('方案 C：__list__ 路由出列表页，?id= 走单篇，?id= 保留 ak', async () => {
    const { hub } = makeHub()
    await hub.start(0)
    const port = hub.getPort()
    hub.registerContentResolver((id) => ({ title: `文章 ${id}`, html: `<p>${id}</p>` }))
    hub.registerContentListResolver((ak) => `<ul><li><a href="?id=cnt_1&ak=${ak}">文章1</a></li></ul>`)
    const t = await hub.create({ toolId: 'file-manager', label: '公用总链', root: 'content://contents', kind: 'content', entry: '__list__', password: 'sekret' })
    // 无 ak → 403
    expect((await fetch(`http://127.0.0.1:${port}/${t.token}/__list__`)).status).toBe(403)
    const listRes = await fetch(`http://127.0.0.1:${port}/${t.token}/__list__?ak=sekret`)
    expect(listRes.status).toBe(200)
    expect(await listRes.text()).toContain('?id=cnt_1&ak=sekret')
    // ?id= 走单篇 resolver（列表页点进文章的通路）
    const one = await fetch(`http://127.0.0.1:${port}/${t.token}/?id=cnt_1&ak=sekret`)
    expect(one.status).toBe(200)
    expect(await one.text()).toContain('文章 cnt_1')
  })

  it('content 路由 resume 不校验磁盘 root（虚拟标记）', async () => {
    const { hub, state } = makeHub()
    await hub.start(0)
    hub.registerContentResolver(() => ({ title: 'x', html: '<p>x</p>' }))
    await hub.create({ toolId: 'file-manager', label: 'x', root: 'content://contents', kind: 'content', contentId: 'cnt_1' })
    await hub.stop()
    // 手动确保状态已落盘（stop 会 flush）
    expect(existsSync(state)).toBe(true)
    const saved = JSON.parse(readFileSync(state, 'utf8')) as { routes: Array<{ kind?: string; contentId?: string }> }
    expect(saved.routes.some((r) => r.kind === 'content' && r.contentId === 'cnt_1')).toBe(true)
    await hub.start(0)
    expect(hub.listRoutes().some((r) => r.kind === 'content' && r.contentId === 'cnt_1')).toBe(true)
  })
})
