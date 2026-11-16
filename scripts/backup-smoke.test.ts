/**
 * H5 备份还原真实冒烟（plans/03 §四）——真实函数、真实临时目录，零 mock：
 * 种子（品牌/邮件/产物文件/密钥）→ D18 口令加密导出 → 全新目录导入（带/不带口令两路）
 * → 断言实体数 / 产物还原 / settings 还原且 outputDir 不导入 / 密钥还原布尔。
 * 运行：pnpm backup:smoke（独立 vitest 配置，不进 verify）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { Repository, type Brand, type Mail } from '@sshk/repository'
import { exportBackup } from '@sshk/backup'
import { importBackup } from '@sshk/backup'

const dirs: string[] = []
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sshk-smoke-${prefix}-`))
  dirs.push(dir)
  return dir
}
afterAll(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const PASSPHRASE = '冒烟口令123456'
const secrets = JSON.stringify({ providers: [{ _id: 'prv_smoke_1' }, { _id: 'prv_smoke_2' }] })

async function seed(dir: string): Promise<Repository> {
  const repo = new Repository(dir)
  await repo.insert<Brand>('brands', { code: 'procell', name: 'Procell 冒烟' })
  await repo.insert<Mail>('mails', {
    name: '冒烟邮件', brandId: 'brd_x', templateVersionId: 'tplv_x',
    bindings: [], data: {}, status: 'draft',
    outputs: { final: 'outputs/edm/smoke/final.html' },
  })
  return repo
}

it('backup 冒烟：导出（D18 口令）→ 全新目录导入 → 数据/产物/密钥全还原', async () => {
  // ── 种子 ──
  const db1 = temp('db1')
  const out1 = temp('out1')
  const repo1 = await seed(db1)
  mkdirSync(join(out1, 'outputs/edm/smoke'), { recursive: true })
  writeFileSync(join(out1, 'outputs/edm/smoke/final.html'), '<html>smoke final</html>')
  mkdirSync(join(out1, 'assets/uploads'), { recursive: true })
  writeFileSync(join(out1, 'assets/uploads/stats.csv'), 'url,clicks\nhttps://a.com,3\n')
  const zipPath = join(temp('zip'), 'smoke.zip')

  // ── 导出（带口令加密密钥）──
  const manifest = await exportBackup({
    repository: repo1,
    settings: { app: { themeMode: 'dark', outputDir: 'D:/local-only-never-import' }, tools: {} },
    outputRoot: out1,
    outZipPath: zipPath,
    appVersion: 'smoke',
    secretsJson: secrets,
    migrationPassphrase: PASSPHRASE,
  })
  expect(manifest.counts['brands']).toBe(1)
  expect(manifest.counts['mails']).toBe(1)
  expect(manifest.secrets).toBe('encrypted')

  // ── 场景 A：全新目录 + 正确口令 → 全还原 ──
  const db2 = temp('db2')
  const out2 = temp('out2')
  const settingsPath2 = join(db2, 'settings.json')
  const res2 = await importBackup({
    repository: new Repository(db2), zipPath, outputRoot: out2,
    snapshotDir: temp('snap2'), dbDir: db2, settingsPath: settingsPath2,
    migrationPassphrase: PASSPHRASE,
  })
  expect(res2.secretsRestored).toBe(2)
  expect(res2.secretsJson).toBe(secrets)
  expect(await new Repository(db2).count('brands')).toBe(1)
  expect(await new Repository(db2).count('mails')).toBe(1)
  expect(existsSync(join(out2, 'outputs/edm/smoke/final.html'))).toBe(true)
  expect(readFileSync(join(out2, 'outputs/edm/smoke/final.html'), 'utf8')).toContain('smoke final')
  expect(existsSync(join(out2, 'assets/uploads/stats.csv'))).toBe(true)
  // settings 还原但 outputDir 不导入（机器相关值保留本机）
  const savedSettings = JSON.parse(readFileSync(settingsPath2, 'utf8')) as { app?: Record<string, unknown> }
  expect(savedSettings.app?.['themeMode']).toBe('dark')
  expect('outputDir' in (savedSettings.app ?? {})).toBe(false)

  // ── 场景 B：不带口令 → 密钥跳过不阻断，其余数据照常还原 ──
  const db3 = temp('db3')
  const res3 = await importBackup({
    repository: new Repository(db3), zipPath, outputRoot: temp('out3'),
    snapshotDir: temp('snap3'), dbDir: db3, settingsPath: join(db3, 'settings.json'),
  })
  expect(res3.secretsRestored).toBe(0)
  expect(res3.secretsMessage).toContain('未提供迁移口令')
  expect(await new Repository(db3).count('mails')).toBe(1)

  console.log(
    `[backup:smoke] 通过：导出 zip=${zipPath} · 实体 ${manifest.counts['brands']} 品牌 / ${manifest.counts['mails']} 邮件 · ` +
    `产物 2 文件还原 · 密钥 ${res2.secretsRestored} 个（口令） / ${res3.secretsRestored} 个（无口令跳过）`,
  )
})
