import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { zipSync, type Zippable } from 'fflate'
import { BACKUP_COLLECTIONS, listOutputFiles, type BaseEntity, type Repository } from '@sshk/repository'
import { now } from '@sshk/shared'
import { README_TEXT, SCHEMA_VERSION, type BackupManifest, type SecretKdf } from './manifest.js'
import { encryptSecrets, PBKDF2_ITERATIONS } from './crypto.js'

export interface ExportOptions {
  repository: Repository
  /** ConfigService.snapshot() 的结果（app + tools 两段） */
  settings: Record<string, unknown>
  /** 产物根目录（含 assets/ 与 outputs/） */
  outputRoot: string
  /** 导出 zip 落盘路径 */
  outZipPath: string
  appVersion: string
  /** 是否携带产物 HTML/PNG（默认开） */
  includeOutputs?: boolean
  /** 仅在 SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1 时由主进程传入 */
  secretsJson?: string
  migrationPassphrase?: string
}

function checksumOf(entries: Zippable): string {
  const hash = createHash('sha256')
  for (const name of Object.keys(entries).sort()) {
    hash.update(name)
    hash.update(entries[name] as Uint8Array)
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * R7 系统内容不入包：origin='system' 实体（R8 播种的内置品牌/模板/片段）文件即源真相，
 * 随包导出会与导入端播种产生双真相。只导出「引用关系」——邮件等自定义实体里的
 * frgv_sys_* / tplv_sys_* ID 原样保留，导入端播种按相同确定性 ID 重建实体后引用自然恢复
 * （若目标机内置内容版本不含该 ID，邮件生成时明确报「模板版本不存在」，属可解释降级）。
 */
const SYSTEM_EXCLUDED_COLLECTIONS: ReadonlySet<string> = new Set([
  'brands', 'templates', 'templateVersions', 'fragments', 'fragmentVersions',
])

function isSystemDoc(doc: BaseEntity): boolean {
  return (doc as { origin?: string }).origin === 'system'
}

/**
 * 导出备份 zip（数据契约 §4）：
 * manifest.json + settings/ + data/ + assets/ + outputs/ + secrets.enc? + README.txt
 * 包内全相对路径（正斜杠）；机器绝对路径绝不出包。
 */
export async function exportBackup(opts: ExportOptions): Promise<BackupManifest> {
  const entries: Zippable = {}
  const settings = opts.settings as { app?: Record<string, unknown>; tools?: Record<string, unknown> }
  entries['settings/app.json'] = new TextEncoder().encode(JSON.stringify(settings.app ?? {}, null, 2))
  entries['settings/tools.json'] = new TextEncoder().encode(JSON.stringify(settings.tools ?? {}, null, 2))

  const counts: BackupManifest['counts'] = {}
  for (const name of BACKUP_COLLECTIONS) {
    const all = await opts.repository.exportCollection(name)
    const docs = SYSTEM_EXCLUDED_COLLECTIONS.has(name) ? all.filter((doc) => !isSystemDoc(doc)) : all
    counts[name] = docs.length
    entries[`data/${name}.json`] = new TextEncoder().encode(JSON.stringify(docs, null, 2))
  }

  // assets + outputs：相对路径直拷
  const includes = ['settings', 'data']
  for (const stat of listOutputFiles(opts.outputRoot)) {
    if (stat.rel.startsWith('outputs/') && opts.includeOutputs === false) continue
    entries[stat.rel] = new Uint8Array(readFileSync(join(opts.outputRoot, ...stat.rel.split('/'))))
    const top = stat.rel.split('/')[0]!
    if (!includes.includes(top)) includes.push(top)
  }

  // secrets（D18）：口令派生密钥加密，口令本身绝不入包
  let secretKdf: SecretKdf | null = null
  let secretsState: 'excluded' | 'encrypted' = 'excluded'
  if (opts.secretsJson && opts.migrationPassphrase) {
    const blob = encryptSecrets(opts.secretsJson, opts.migrationPassphrase)
    entries['secrets.enc'] = new TextEncoder().encode(JSON.stringify(blob))
    secretKdf = { algo: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: blob.salt, nonce: blob.nonce }
    secretsState = 'encrypted'
  }

  entries['README.txt'] = new TextEncoder().encode(README_TEXT)

  const manifest: BackupManifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: opts.appVersion,
    exportedAt: now(),
    sourceOS: process.platform,
    includes,
    counts,
    secrets: secretsState,
    secretKdf,
    checksum: checksumOf(entries),
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

  mkdirSync(dirname(opts.outZipPath), { recursive: true })
  writeFileSync(opts.outZipPath, zipSync(entries, { level: 6 }))
  return manifest
}
