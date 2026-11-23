import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '@sshk/repository'
import type { Brand, Fragment } from '@sshk/repository'
import { migrateBrandIdentity, unifiedBrandId } from './edm-brand-identity'

const dirs: string[] = []
function makeRepo(): Repository {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-edm-brand-'))
  dirs.push(dir)
  return new Repository(dir)
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('统一品牌身份迁移', () => {
  it('旧 cus_brd_* 合并进系统品牌，引用同步且幂等', async () => {
    const repo = makeRepo()
    await repo.insert<Brand>('brands', { _id: 'brd_elabscience', code: 'elabscience', name: 'Sys', origin: 'system' })
    await repo.insert<Brand>('brands', { _id: 'cus_brd_elabscience', code: 'elabscience', name: 'Custom', origin: 'custom' })
    await repo.insert<Fragment>('fragments', {
      _id: 'cus_frg_elabscience_hero', brandId: 'cus_brd_elabscience', name: 'Hero', type: 'product', origin: 'custom',
    })

    const first = await migrateBrandIdentity(repo)
    expect(first.merged).toBe(1)
    expect(unifiedBrandId('elabscience')).toBe('brd_elabscience')
    expect(await repo.get<Brand>('brands', 'cus_brd_elabscience')).toBeNull()
    // 已存在的系统品牌不被覆盖
    expect((await repo.get<Brand>('brands', 'brd_elabscience'))?.name).toBe('Sys')
    expect((await repo.get<Fragment>('fragments', 'cus_frg_elabscience_hero'))?.brandId).toBe('brd_elabscience')
    // 二次运行幂等
    expect((await migrateBrandIdentity(repo)).merged).toBe(0)
  })

  it('纯自定义品牌（系统无同名）改 ID 后保留内容', async () => {
    const repo = makeRepo()
    await repo.insert<Brand>('brands', { _id: 'cus_brd_demo', code: 'demo', name: 'Demo', origin: 'custom' })
    const r = await migrateBrandIdentity(repo)
    expect(r.merged).toBe(1)
    const moved = await repo.get<Brand>('brands', 'brd_demo')
    expect(moved?.name).toBe('Demo')
    expect(moved?.code).toBe('demo')
    expect(await repo.get<Brand>('brands', 'cus_brd_demo')).toBeNull()
  })
})
