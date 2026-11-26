import Datastore from '@seald-io/nedb'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { now } from '@sshk/shared'
import { entityId } from './id.js'
import type { BaseEntity, FragmentVersion, TemplateVersion } from './entities.js'
import { BACKUP_COLLECTIONS, NON_BACKUP_COLLECTIONS } from './entities.js'
import type { StorageCollection } from './entities.js'

type AnyDoc = Record<string, unknown>

/** 集合 → 实体 ID 前缀（数据契约 §1） */
const ID_PREFIX: Record<StorageCollection, string> = {
  brands: 'brd',
  templates: 'tpl',
  templateVersions: 'tplv',
  fragments: 'frg',
  fragmentVersions: 'frgv',
  mails: 'mail',
  posters: 'pst',
  contents: 'cnt',
  forms: 'frm',
  formControls: 'ctl',
  shareLogs: 'shlog',
  usage: 'use',
  fsAnnotations: 'fsa',
  fsFavorites: 'fsv',
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

  private store(name: StorageCollection): Datastore<AnyDoc> {
    let db = this.stores.get(name)
    if (!db) {
      db = new Datastore<AnyDoc>({
        filename: join(this.dbDir, `${name}.db`),
        autoload: true,
        // H6：损坏记录占比超过 10% 时显式告警（默认值同为 10%，此处显式声明防版本漂移）
        corruptAlertThreshold: 0.1,
      })
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
    name: StorageCollection,
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

  async get<T extends BaseEntity>(name: StorageCollection, id: string): Promise<T | null> {
    const doc = await this.store(name).findOneAsync({ _id: id })
    return (doc as unknown as T) ?? null
  }

  async list<T extends BaseEntity>(
    name: StorageCollection,
    query: AnyDoc = {},
    sort: Record<string, 1 | -1> = { updatedAt: -1 },
    /** CR-45（P1-4）：DB 级分页——大数据集翻页不再全表拉回内存 slice */
    paging?: { skip?: number; limit?: number },
  ): Promise<T[]> {
    let cursor = this.store(name).findAsync(query).sort(sort)
    if (paging?.skip != null && paging.skip > 0) cursor = cursor.skip(paging.skip)
    if (paging?.limit != null && paging.limit > 0) cursor = cursor.limit(paging.limit)
    const docs = await cursor.execAsync()
    return docs as unknown as T[]
  }

  async count(name: StorageCollection, query: AnyDoc = {}): Promise<number> {
    return this.store(name).countAsync(query)
  }

  /** 局部更新并刷新 updatedAt；返回更新后的完整实体 */
  async update<T extends BaseEntity>(name: StorageCollection, id: string, patch: Partial<T>): Promise<T | null> {
    this.assertWritable()
    if (!id) throw new Error(`更新需要有效 _id（${name}）`)
    const merged = { ...patch, updatedAt: now() } as AnyDoc
    delete merged._id
    delete merged.createdAt
    const res = await this.store(name).updateAsync({ _id: id }, { $set: merged }, { returnUpdatedDocs: true })
    return (res.affectedDocuments as unknown as T) ?? null
  }

  /** 软删除（数据契约 §1） */
  async archive<T extends BaseEntity>(name: StorageCollection, id: string): Promise<T | null> {
    return this.update<T>(name, id, { archived: true } as Partial<T>)
  }

  /** 硬删除（调用方须先确认无引用并二次确认） */
  async remove(name: StorageCollection, id: string): Promise<number> {
    this.assertWritable()
    return this.store(name).removeAsync({ _id: id }, {})
  }

  /** 导入整集合（zip 导入用）：清空后批量写入 */
  async replaceCollection(name: StorageCollection, docs: BaseEntity[]): Promise<void> {
    this.assertWritable()
    const db = this.store(name)
    await db.removeAsync({}, { multi: true })
    if (docs.length > 0) await db.insertAsync(docs as unknown as AnyDoc[])
  }

  /** 导出整集合（zip 导出用） */
  async exportCollection(name: StorageCollection): Promise<BaseEntity[]> {
    return (await this.store(name).findAsync({})) as unknown as BaseEntity[]
  }

  /** 压缩数据文件，防 append-only 膨胀（数据契约 §7） */
  async compact(): Promise<void> {
    for (const db of this.stores.values()) {
      await db.compactDatafileAsync()
    }
  }

  /**
   * H6：只压缩超阈值（默认 10MB）的集合文件；返回实际压缩的集合名。
   * 与 compact() 的差别：只按需触发大文件，启动调度用（避免每日全量写盘）。
   * 覆盖备份集合与非备份集合（usage 日志同样防膨胀）。
   */
  async compactIfBulky(maxBytes = 10 * 1024 * 1024): Promise<string[]> {
    const done: string[] = []
    const all = [...BACKUP_COLLECTIONS, ...NON_BACKUP_COLLECTIONS] as const
    for (const name of all) {
      const file = join(this.dbDir, `${name}.db`)
      if (!existsSync(file) || statSync(file).size <= maxBytes) continue
      await this.store(name).compactDatafileAsync()
      done.push(name)
    }
    return done
  }

  /** 按条件硬删除（usage 清理专用：按 createdAt 前缀比较，北京时间字符串有序） */
  async removeWhere(name: StorageCollection, query: AnyDoc): Promise<number> {
    this.assertWritable()
    return this.store(name).removeAsync(query, { multi: true })
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

  /** 候选片段（#213：片段不绑定插槽类型，可用范围只由品牌隔离 + 黑白名单决定） */
  async listCandidateFragmentVersions(tv: TemplateVersion): Promise<FragmentVersion[]> {
    const rows = await this.list<FragmentVersion>(
      'fragmentVersions',
      { brandId: tv.brandId, archived: false },
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
