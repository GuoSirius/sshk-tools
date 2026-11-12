import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from './db'
import type { FragmentVersion, Mail, TemplateVersion } from './entities'

const dirs: string[] = []

function makeRepo(): Repository {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-db-'))
  dirs.push(dir)
  return new Repository(dir)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Repository 基础 CRUD', () => {
  it('insert 补齐时间戳与 archived，get/list/update/archive 正常', async () => {
    const repo = makeRepo()
    const mail = await repo.insert<Mail>('mails', {
      name: '12月营销',
      brandId: 'brd_1',
      templateVersionId: 'tplv_1',
      bindings: [],
      data: {},
      status: 'draft',
      outputs: {},
    })
    expect(mail._id).toMatch(/^mail_/)
    expect(mail.createdAt).toMatch(/\+08:00$/)
    expect(mail.archived).toBe(false)

    const got = await repo.get<Mail>('mails', mail._id)
    expect(got?.name).toBe('12月营销')

    const updated = await repo.update<Mail>('mails', mail._id, { name: '12月营销改' })
    expect(updated?.name).toBe('12月营销改')
    expect(updated?.createdAt).toBe(mail.createdAt)
    expect(updated?.updatedAt).toBeDefined()

    const archived = await repo.archive<Mail>('mails', mail._id)
    expect(archived?.archived).toBe(true)
    expect(await repo.count('mails', { archived: false })).toBe(0)
  })

  it('pauseWrites 后写入被拒（目录迁移停写）', async () => {
    const repo = makeRepo()
    repo.pauseWrites()
    await expect(repo.insert('brands', { code: 'x', name: 'x' } as never)).rejects.toThrow('暂停写入')
    repo.resumeWrites()
    await expect(repo.insert('brands', { code: 'x', name: 'x' } as never)).resolves.toBeTruthy()
  })

  it('compact 与 replaceCollection 可用', async () => {
    const repo = makeRepo()
    await repo.insert('brands', { code: 'a', name: 'A' } as never)
    await repo.insert('brands', { code: 'b', name: 'B' } as never)
    const exported = await repo.exportCollection('brands')
    const repo2 = makeRepo()
    await repo2.replaceCollection('brands', exported)
    expect(await repo2.count('brands')).toBe(2)
    await repo2.compact()
  })
})

describe('片段候选两道过滤（数据契约 §2.2 黑名单优先）', () => {
  const tv = {
    _id: 'tplv_1',
    templateId: 'tpl_1',
    brandId: 'brd_1',
    version: 1,
    source: { html: 't.njk', cssMode: 'inline' },
    slots: [],
    origin: 'custom',
    createdAt: 'x', updatedAt: 'x', archived: false,
  } as unknown as TemplateVersion

  async function seed(repo: Repository, policy: { blacklist: string[]; whitelist: string[] }, version = 1): Promise<FragmentVersion> {
    return repo.insert<FragmentVersion>('fragmentVersions', {
      fragmentId: `frg_${version}`,
      brandId: 'brd_1',
      version,
      type: 'product',
      source: { html: 'f.njk', cssMode: 'inline' },
      policy,
      origin: 'custom',
    })
  }

  it('黑名单命中模板族 ID → 禁用（黑名单优先）', async () => {
    const repo = makeRepo()
    await seed(repo, { blacklist: ['tpl_1'], whitelist: ['tplv_1'] })
    expect(await repo.listCandidateFragmentVersions(tv, 'product')).toHaveLength(0)
  })

  it('白名单为空 → 全可用', async () => {
    const repo = makeRepo()
    await seed(repo, { blacklist: [], whitelist: [] })
    expect(await repo.listCandidateFragmentVersions(tv, 'product')).toHaveLength(1)
  })

  it('白名单非空且不含 → 禁用；含版本 ID → 可用', async () => {
    const repo = makeRepo()
    await seed(repo, { blacklist: [], whitelist: ['tplv_其他'] }, 1)
    await seed(repo, { blacklist: [], whitelist: ['tplv_1'] }, 2)
    const allowed = await repo.listCandidateFragmentVersions(tv, 'product')
    expect(allowed).toHaveLength(1)
    expect(allowed[0]?.version).toBe(2)
  })

  it('悬空清理：从 policy 中移除失效 ID', async () => {
    const repo = makeRepo()
    const fv = await seed(repo, { blacklist: ['tpl_死'], whitelist: ['tplv_死'] })
    const cleaned = await repo.cleanupDanglingPolicies(['tpl_死', 'tplv_死'])
    expect(cleaned).toBe(2)
    const after = await repo.get<FragmentVersion>('fragmentVersions', fv._id)
    expect(after?.policy.blacklist).toHaveLength(0)
    expect(after?.policy.whitelist).toHaveLength(0)
  })
})
