import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { BACKUP_COLLECTIONS, resolveSafe, type BaseEntity, type CollectionName, type Repository } from '@sshk/repository'
import { SCHEMA_VERSION, type BackupManifest } from './manifest.js'
import { decryptSecrets, type EncryptedBlob } from './crypto.js'

export interface ParsedBackup {
  manifest: BackupManifest
  settingsApp: Record<string, unknown>
  settingsTools: Record<string, unknown>
  collections: Map<CollectionName, BaseEntity[]>
  fileEntries: Map<string, Uint8Array>
  secretsEnc: EncryptedBlob | null
}

const SINGLE_FILE_LIMIT = 200 * 1024 * 1024
const TOTAL_LIMIT = 1024 * 1024 * 1024

function assertSafeEntryName(name: string): void {
  const normalized = name.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`包内出现绝对路径: ${name}`)
  }
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new Error(`包内出现路径穿越: ${name}`)
  }
}

/** 校验并解析备份包（数据契约 §4.2 ①②）：不落盘，只解到内存 */
export function parseBackup(zipPath: string): ParsedBackup {
  const raw = readFileSync(zipPath)
  if (raw.length > TOTAL_LIMIT) throw new Error(`备份包超过总量上限（${(raw.length / 1024 / 1024).toFixed(0)}MB）`)
  const entries = unzipSync(new Uint8Array(raw))

  let total = 0
  for (const [name, data] of Object.entries(entries)) {
    assertSafeEntryName(name)
    total += data.length
    if (data.length > SINGLE_FILE_LIMIT) throw new Error(`包内单文件超限: ${name}`)
  }
  if (total > TOTAL_LIMIT) throw new Error('备份包解压后超过总量上限')

  const manifestRaw = entries['manifest.json']
  if (!manifestRaw) throw new Error('缺少 manifest.json，不是有效的 sshk-tools 备份包')
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as BackupManifest

  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`备份包 schemaVersion(${manifest.schemaVersion}) 比当前应用(${SCHEMA_VERSION}) 新，请先升级应用`)
  }

  // checksum 校验：对除 manifest.json 外全部条目重算
  const hash = createHash('sha256')
  for (const name of Object.keys(entries).filter((n) => n !== 'manifest.json').sort()) {
    hash.update(name)
    hash.update(entries[name]!)
  }
  if (`sha256:${hash.digest('hex')}` !== manifest.checksum) {
    throw new Error('checksum 校验失败：备份包可能被篡改或损坏')
  }

  const collections = new Map<CollectionName, BaseEntity[]>()
  for (const name of BACKUP_COLLECTIONS) {
    const data = entries[`data/${name}.json`]
    if (data) collections.set(name, JSON.parse(new TextDecoder().decode(data)) as BaseEntity[])
  }

  const settingsApp = entries['settings/app.json']
    ? (JSON.parse(new TextDecoder().decode(entries['settings/app.json']!)) as Record<string, unknown>)
    : {}
  const settingsTools = entries['settings/tools.json']
    ? (JSON.parse(new TextDecoder().decode(entries['settings/tools.json']!)) as Record<string, unknown>)
    : {}

  const fileEntries = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith('assets/') || name.startsWith('outputs/')) fileEntries.set(name, data)
  }

  const secretsEncRaw = entries['secrets.enc']
  const secretsEnc = secretsEncRaw ? (JSON.parse(new TextDecoder().decode(secretsEncRaw)) as EncryptedBlob) : null

  return { manifest, settingsApp, settingsTools, collections, fileEntries, secretsEnc }
}

export interface ImportOptions {
  repository: Repository
  zipPath: string
  outputRoot: string
  /** 导入前快照目录（.tmp/import/pre-import-backup/），失败回滚用 */
  snapshotDir: string
  dbDir: string
  settingsPath: string
  /** 迁移口令；包含 secrets.enc 且口令缺失/错误时跳过密钥（§4.3 ⑥） */
  migrationPassphrase?: string
}

/** 导入前快照：复制 db 与 settings（失败回滚用） */
export function createSnapshot(opts: Pick<ImportOptions, 'dbDir' | 'settingsPath' | 'snapshotDir'>): void {
  mkdirSync(opts.snapshotDir, { recursive: true })
  if (existsSync(opts.dbDir)) cpSync(opts.dbDir, join(opts.snapshotDir, 'db'), { recursive: true })
  if (existsSync(opts.settingsPath)) cpSync(opts.settingsPath, join(opts.snapshotDir, 'settings.json'))
}

/** 回滚：用快照覆盖当前 db 与 settings */
export function restoreSnapshot(opts: Pick<ImportOptions, 'dbDir' | 'settingsPath' | 'snapshotDir'>): void {
  const dbBackup = join(opts.snapshotDir, 'db')
  if (existsSync(dbBackup)) {
    cpSync(dbBackup, opts.dbDir, { recursive: true, force: true })
  }
  const settingsBackup = join(opts.snapshotDir, 'settings.json')
  if (existsSync(settingsBackup)) {
    cpSync(settingsBackup, opts.settingsPath, { force: true })
  }
}

export interface ImportResult {
  manifest: BackupManifest
  /** 还原的密钥数量；0 = 未携带或口令缺失/错误（明确提示，不阻断） */
  secretsRestored: number
  secretsMessage: string
  /** 解密后的密钥 JSON（仅内存传递，绝不落盘）；主进程负责用 safeStorage 重新加密 */
  secretsJson?: string
}

/**
 * 导入（整包覆盖，D17）：
 * ① assets/outputs 落盘到本机产物目录（覆盖）；
 * ② 集合整仓替换；③ settings 还原（outputDir 保留本机值）；
 * ④ secrets.enc + 口令 → 解密返回（由主进程 safeStorage 重新加密落盘）。
 */
export async function importBackup(opts: ImportOptions): Promise<ImportResult> {
  const parsed = parseBackup(opts.zipPath)

  // ① 文件落盘（先解到内存已校验，逐条覆盖写；写入产物目录受 resolveSafe 保护）
  for (const [rel, data] of parsed.fileEntries) {
    const abs = resolveSafe(opts.outputRoot, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, data)
  }

  // ② 集合整仓替换
  for (const name of BACKUP_COLLECTIONS) {
    const docs = parsed.collections.get(name) ?? []
    await opts.repository.replaceCollection(name, docs)
  }

  // ③ settings：剔除机器相关 outputDir
  const app = { ...parsed.settingsApp }
  if ('outputDir' in app) delete app['outputDir']
  const settings = {
    app,
    tools: parsed.settingsTools,
  } as Record<string, Record<string, unknown>>
  writeFileSync(opts.settingsPath, JSON.stringify(settings, null, 2), 'utf8')

  // ④ secrets（D18 §4.3 ⑤⑥）：解密结果仅内存传递，主进程 safeStorage 加密落盘
  let secretsRestored = 0
  let secretsMessage = '包内未携带密钥（默认行为）'
  let secretsJson: string | undefined
  if (parsed.secretsEnc) {
    if (!opts.migrationPassphrase) {
      secretsMessage = '包内携带加密密钥，但未提供迁移口令；已跳过密钥，请在模型配置中重填'
    } else {
      try {
        secretsJson = decryptSecrets(parsed.secretsEnc, opts.migrationPassphrase)
        const secrets = JSON.parse(secretsJson) as { providers?: unknown[] }
        secretsRestored = secrets.providers?.length ?? 0
        secretsMessage = `已还原 ${secretsRestored} 个密钥`
      } catch (err) {
        secretsMessage = `密钥还原失败：${(err as Error).message}；其余数据已照常导入`
      }
    }
  }

  return { manifest: parsed.manifest, secretsRestored, secretsMessage, secretsJson }
}
