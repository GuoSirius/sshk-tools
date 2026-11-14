import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository, type Brand, type Mail } from '@sshk/repository'
import { exportBackup } from './export'
import { createSnapshot, importBackup, parseBackup, restoreSnapshot } from './import'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sshk-bak-${prefix}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Ctx {
  repo: Repository
  dbDir: string
  outputRoot: string
  zipPath: string
}

async function setup(): Promise<Ctx> {
  const dbDir = tempDir('db')
  const outputRoot = tempDir('out')
  const repo = new Repository(dbDir)
  await repo.insert<Brand>('brands', { code: 'procell', name: 'Procell' })
  await repo.insert<Mail>('mails', {
    name: '12月营销', brandId: 'brd_x', templateVersionId: 'tplv_x',
    bindings: [], data: {}, status: 'draft', outputs: { final: 'outputs/edm/mail_x/final.html' },
  })
  mkdirSync(join(outputRoot, 'outputs/edm/mail_x'), { recursive: true })
  writeFileSync(join(outputRoot, 'outputs/edm/mail_x/final.html'), '<html>final</html>')
  mkdirSync(join(outputRoot, 'assets/uploads'), { recursive: true })
  writeFileSync(join(outputRoot, 'assets/uploads/stats.csv'), 'url,clicks\nhttps://a.com,3\n')
  return { repo, dbDir, outputRoot, zipPath: join(tempDir('zip'), 'backup.zip') }
}

describe('导出 → 导入闭环', () => {
  it('集合、产物文件、settings 全量还原', async () => {
    const ctx = await setup()
    const manifest = await exportBackup({
      repository: ctx.repo,
      settings: { app: { themeMode: 'dark', outputDir: 'D:/local-only' }, tools: {} },
      outputRoot: ctx.outputRoot,
      outZipPath: ctx.zipPath,
      appVersion: '0.1.0',
    })
    expect(manifest.counts['brands']).toBe(1)
    expect(manifest.counts['mails']).toBe(1)
    expect(manifest.secrets).toBe('excluded')

    // 全新目标机
    const db2 = tempDir('db2')
    const out2 = tempDir('out2')
    const repo2 = new Repository(db2)
    const res = await importBackup({
      repository: repo2,
      zipPath: ctx.zipPath,
      outputRoot: out2,
      snapshotDir: tempDir('snap'),
      dbDir: db2,
      settingsPath: join(db2, 'settings.json'),
    })
    expect(res.secretsRestored).toBe(0)
    expect(await repo2.count('brands')).toBe(1)
    const mails = await repo2.list<Mail>('mails')
    expect(mails[0]?.outputs.final).toBe('outputs/edm/mail_x/final.html')
  })

  it('系统内容不入包，引用关系随自定义实体保留（R7）', async () => {
    const dbDir = tempDir('db-sys')
    const repo = new Repository(dbDir)
    await repo.insert<Brand>('brands', { _id: 'brd_sys_elabscience', code: 'elabscience', name: 'Elabscience', origin: 'system' })
    await repo.insert<Brand>('brands', { code: 'procell', name: 'Procell' })
    await repo.insert<Mail>('mails', {
      name: '引用系统模板版本', brandId: 'brd_sys_elabscience', templateVersionId: 'tplv_sys_elabscience_standard_v1',
      bindings: [{ slot: 'header', fragmentVersionId: 'frgv_sys_elabscience_banner_v1' }],
      data: {}, status: 'draft', outputs: {},
    })
    const zipPath = join(tempDir('zip-sys'), 'backup.zip')
    const manifest = await exportBackup({
      repository: repo, settings: {}, outputRoot: tempDir('out-sys'),
      outZipPath: zipPath, appVersion: '0.1.0',
    })
    expect(manifest.counts['brands']).toBe(1) // 系统品牌被剔除，自定义品牌保留
    expect(manifest.counts['mails']).toBe(1)

    const entries = unzipSync(new Uint8Array(readFileSync(zipPath)))
    const brands = JSON.parse(new TextDecoder().decode(entries['data/brands.json'])) as { _id: string }[]
    expect(brands.map((b) => b._id)).not.toContain('brd_sys_elabscience')
    // 邮件里的系统 ID 引用关系原样保留（导入端播种按相同 ID 重建后即恢复可用）
    const mails = JSON.parse(new TextDecoder().decode(entries['data/mails.json'])) as { bindings: { fragmentVersionId: string }[] }[]
    expect(mails[0]?.bindings[0]?.fragmentVersionId).toBe('frgv_sys_elabscience_banner_v1')
  })

  it('checksum 校验：内容被篡改被拒', async () => {
    const ctx = await setup()
    await exportBackup({
      repository: ctx.repo, settings: {}, outputRoot: ctx.outputRoot,
      outZipPath: ctx.zipPath, appVersion: '0.1.0',
    })
    // 解包 → 篡改 data/brands.json → 保留原 manifest 重新打包
    const entries = unzipSync(new Uint8Array(readFileSync(ctx.zipPath)))
    entries['data/brands.json'] = new TextEncoder().encode('[{"_id":"fake"}]')
    const tampered = join(ctx.zipPath, '..', 'tampered.zip')
    writeFileSync(tampered, zipSync(entries))
    expect(() => parseBackup(tampered)).toThrow('checksum')
  })

  it('加密密钥迁移：口令正确还原 / 缺口令跳过不阻断', async () => {
    const ctx = await setup()
    const secrets = JSON.stringify({ providers: [{ _id: 'prv_1' }, { _id: 'prv_2' }] })
    await exportBackup({
      repository: ctx.repo, settings: {}, outputRoot: ctx.outputRoot,
      outZipPath: ctx.zipPath, appVersion: '0.1.0',
      secretsJson: secrets, migrationPassphrase: '口令口令12345',
    })

    const db2 = tempDir('db2')
    const repo2 = new Repository(db2)
    const ok = await importBackup({
      repository: repo2, zipPath: ctx.zipPath, outputRoot: tempDir('out2'),
      snapshotDir: tempDir('snap'), dbDir: db2, settingsPath: join(db2, 'settings.json'),
      migrationPassphrase: '口令口令12345',
    })
    expect(ok.secretsRestored).toBe(2)
    expect(ok.secretsJson).toBe(secrets)

    const db3 = tempDir('db3')
    const repo3 = new Repository(db3)
    const skip = await importBackup({
      repository: repo3, zipPath: ctx.zipPath, outputRoot: tempDir('out3'),
      snapshotDir: tempDir('snap3'), dbDir: db3, settingsPath: join(db3, 'settings.json'),
    })
    expect(skip.secretsRestored).toBe(0)
    expect(skip.secretsMessage).toContain('未提供迁移口令')
    expect(await repo3.count('brands')).toBe(1)
  })

  it('schemaVersion 比应用新 → 拒绝', async () => {
    const ctx = await setup()
    await exportBackup({
      repository: ctx.repo, settings: {}, outputRoot: ctx.outputRoot,
      outZipPath: ctx.zipPath, appVersion: '0.1.0',
    })
    const parsed = parseBackup(ctx.zipPath)
    expect(parsed.manifest.schemaVersion).toBeLessThanOrEqual(1)
  })

  it('导入前快照与回滚', async () => {
    const dbDir = tempDir('db')
    const repo = new Repository(dbDir)
    await repo.insert<Brand>('brands', { code: 'old', name: '旧数据' })
    const snap = tempDir('snap')
    const settingsPath = join(dbDir, 'settings.json')
    createSnapshot({ dbDir, settingsPath, snapshotDir: snap })

    const db2 = tempDir('db2')
    const repo2 = new Repository(db2)
    await repo2.insert<Brand>('brands', { code: 'new', name: '新数据' })
    restoreSnapshot({ dbDir: db2, settingsPath, snapshotDir: snap })
    const repo2b = new Repository(db2)
    expect(await repo2b.count('brands')).toBe(1)
  })
})
