import Datastore from '@seald-io/nedb'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { now } from '@sshk/shared'
import { entityId } from './id.js'
import type { BaseEntity, CollectionName, FragmentVersion, TemplateVersion } from './entities.js'
import { BACKUP_COLLECTIONS } from './entities.js'

type AnyDoc = Record<string, unknown>

/** 集合 → 实体 ID 前缀（数据契约 §1） */
const ID_PREFIX: Record<CollectionName, string> = {
  brands: 'brd',
  templates: 'tpl',
  templateVersions: 'tplv',
  fragments: 'frg',
  fragmentVersions: 'frgv',
  mails: 'mail',
  posters: 'pst',
}

/**
 * NeDB 数据层（D11：纯 JS，免跨架构 rebuild）。
 * - 集合文件 `<dbDir>/<name>.db`，autoload；`compact()` 防止 append-only 膨胀
 * - 软删除为主（archived:true），硬删仅在无引用且二次确认后由调用方触发
 * - 目录迁移期间 pauseWrites() 停写（数据契约 §8 ②）
 */
export class Repository {
  private stores = new Map<string, Datastore<AnyDoc>>()
  private paused = false

  constructor(private readonly dbDir: string) {
    mkdirSync(this.dbDir, { recursive: true })
  }

  private store(name: CollectionName): Datastore<AnyDoc> {
    let db = this.stores.get(name)
    if (!db) {
      db = new Datastore<AnyDoc>({ filename: join(this.dbDir, `${name}.db`), autoload: true })
      this.stores.set(name, db)
    }
    return db
  }

  private assertWritable(): void {
    if (this.paused) throw new Error('数据层已暂停写入（目录迁移中）')
  }

  pauseWrites(): void { this.paused = true }
  resumeWrites(): void { this.paused = false }

  async insert<T extends BaseEntity>(
    name: CollectionName,
    doc: Omit<T, '_id' | 'createdAt' | 'updatedAt' | 'archived'> & Partial<Pick<T, '_id' | 'archived'>>,
  ): Promise<T> {
    this.assertWritable()
    const stamp = now()
    const full = {
      archived: false,
      ...doc,
      // 未显式给 _id 时按集合前缀生成实体 ID，避免 NeDB 生成自己的短 ID
      _id: (doc as { _id?: string })._id ?? entityId(ID_PREFIX[name]),
      createdAt: stamp,
      updatedAt: stamp,
    } as unknown as AnyDoc
    const inserted = await this.store(name).insertAsync(full)
    return (inserted ?? full) as unknown as T
  }

  async get<T extends BaseEntity>(name: CollectionName, id: string): Promise<T | null> {
    const doc = await this.store(name).findOneAsync({ _id: id })
    return (doc as unknown as T) ?? null
  }

  async list<T extends BaseEntity>(
    name: CollectionName,
    query: AnyDoc = {},
    sort: Record<string, 1 | -1> = { updatedAt: -1 },
  ): Promise<T[]> {
    const docs = await this.store(name).findAsync(query).sort(sort).execAsync()
    return docs as unknown as T[]
  }

  async count(name: CollectionName, query: AnyDoc = {}): Promise<number> {
    return this.store(name).countAsync(query)
  }

  /** 局部更新并刷新 updatedAt；返回更新后的完整实体 */
  async update<T extends BaseEntity>(name: CollectionName, id: string, patch: Partial<T>): Promise<T | null> {
    this.assertWritable()
    if (!id) throw new Error(`更新需要有效 _id（${name}）`)
    const merged = { ...patch, updatedAt: now() } as AnyDoc
    delete merged._id
    delete merged.createdAt
    const res = await this.store(name).updateAsync({ _id: id }, { $set: merged }, { returnUpdatedDocs: true })
    return (res.affectedDocuments as unknown as T) ?? null
  }

  /** 软删除（数据契约 §1） */
  async archive<T extends BaseEntity>(name: CollectionName, id: string): Promise<T | null> {
    return this.update<T>(name, id, { archived: true } as Partial<T>)
  }

  /** 硬删除（调用方须先确认无引用并二次确认） */
  async remove(name: CollectionName, id: string): Promise<number> {
    this.assertWritable()
    return this.store(name).removeAsync({ _id: id }, {})
  }

  /** 导入整集合（zip 导入用）：清空后批量写入 */
  async replaceCollection(name: CollectionName, docs: BaseEntity[]): Promise<void> {
    this.assertWritable()
    const db = this.store(name)
    await db.removeAsync({}, { multi: true })
    if (docs.length > 0) await db.insertAsync(docs as unknown as AnyDoc[])
  }

  /** 导出整集合（zip 导出用） */
  async exportCollection(name: CollectionName): Promise<BaseEntity[]> {
    return (await this.store(name).findAsync({})) as unknown as BaseEntity[]
  }

  /** 压缩数据文件，防 append-only 膨胀（数据契约 §7） */
  async compact(): Promise<void> {
    for (const db of this.stores.values()) {
      await db.compactDatafileAsync()
    }
  }

  // ── 领域查询（数据契约 §2.2 / §2.3：候选片段两道过滤下推到 Repository） ──

  /**
   * 黑名单优先：命中黑名单（版本 ID 或模板族 ID）→ 禁用；
   * 否则白名单为空 → 全可用；否则白名单含（版本或族）→ 可用。
   */
  private policyAllows(fv: FragmentVersion, tv: TemplateVersion): boolean {
    const ids = new Set([tv._id ?? '', tv.templateId])
    if (fv.policy.blacklist.some((x) => ids.has(x))) return false
    if (fv.policy.whitelist.length === 0) return true
    return fv.policy.whitelist.some((x) => ids.has(x))
  }

  async listCandidateFragmentVersions(tv: TemplateVersion, slotType: string): Promise<FragmentVersion[]> {
    const rows = await this.list<FragmentVersion>(
      'fragmentVersions',
      { brandId: tv.brandId, type: slotType, archived: false },
      { version: -1 },
    )
    return rows.filter((fv) => this.policyAllows(fv, tv))
  }

  /** 双向反查：引用了某模板版本的黑白名单片段版本 */
  async findPoliciesByTemplateVersion(templateVersionId: string, templateId?: string): Promise<FragmentVersion[]> {
    const ids = templateId ? [templateVersionId, templateId] : [templateVersionId]
    const rows = await this.list<FragmentVersion>('fragmentVersions', { archived: false })
    return rows.filter(
      (fv) => fv.policy.blacklist.some((x) => ids.includes(x)) || fv.policy.whitelist.some((x) => ids.includes(x)),
    )
  }

  /** 悬空清理：模板/版本被删除时，从所有 policy 中移除失效 ID，返回清理条数 */
  async cleanupDanglingPolicies(danglingIds: string[]): Promise<number> {
    this.assertWritable()
    if (danglingIds.length === 0) return 0
    const set = new Set(danglingIds)
    const rows = await this.list<FragmentVersion>('fragmentVersions', { archived: false })
    let cleaned = 0
    for (const fv of rows) {
      const blacklist = fv.policy.blacklist.filter((x) => !set.has(x))
      const whitelist = fv.policy.whitelist.filter((x) => !set.has(x))
      if (blacklist.length !== fv.policy.blacklist.length || whitelist.length !== fv.policy.whitelist.length) {
        cleaned += fv.policy.blacklist.length - blacklist.length + fv.policy.whitelist.length - whitelist.length
        await this.update<FragmentVersion>('fragmentVersions', fv._id, {
          policy: { blacklist, whitelist },
        })
      }
    }
    return cleaned
  }

  /** 全部集合是否存在（首次启动判定） */
  isInitialized(): boolean {
    return BACKUP_COLLECTIONS.some((name) => existsSync(join(this.dbDir, `${name}.db`)))
  }
}
