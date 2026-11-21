import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  AppError,
  FS_MEDIA_PLAY_LIMIT,
  FS_TRANSFER_CONFIG_KEYS,
  FS_TRANSFER_DEFAULTS,
  readFsTransferSettings,
  type FsFavorite,
  type FsMultipartSettings,
  type FsMultipartStatus,
} from '@sshk/shared'
import { fsBasename } from '@sshk/upload-core'
import type { FsAnnotationDoc, FsFavoriteDoc } from '@sshk/repository'
import { logger } from '../../logger'
import type { FsCore } from './runtime'

/**
 * 通道元数据与传输参数（P3-3 自 fs.ts 拆出）：
 * 传输/分片设置（阈值/片大小/并发/超时）、文件数上限、搜索页数、预览上限、下载落点、
 * 备注（annotation）/收藏（favorite）等 repository 持久化元数据。
 */

/** ── plans/10 传输设置（阈值/片大小/并发/超时全部可设置、实时生效、跨重启记忆）──
 *  配置键/默认值/读取逻辑下沉到 shared（readFsTransferSettings），文件系统传输与图片库共用同一份。 */
const CFG_MP_ENABLED = FS_TRANSFER_CONFIG_KEYS.enabled
const CFG_MP_THRESHOLD_MB = FS_TRANSFER_CONFIG_KEYS.thresholdMb
const CFG_MP_PART_SIZE_MB = FS_TRANSFER_CONFIG_KEYS.partSizeMb
const CFG_MP_CONCURRENCY = FS_TRANSFER_CONFIG_KEYS.partsConcurrency
const CFG_MP_TIMEOUT_SEC = FS_TRANSFER_CONFIG_KEYS.requestTimeoutSec
const _D = FS_TRANSFER_DEFAULTS
const MP_TIMEOUT_DEFAULT = _D.requestTimeoutSec
const MP_TIMEOUT_MIN = _D.timeoutMin
const MP_TIMEOUT_MAX = _D.timeoutMax
const MP_THRESHOLD_DEFAULT = _D.thresholdMb
const MP_PART_SIZE_DEFAULT = _D.partSizeMb
const MP_CONCURRENCY_DEFAULT = _D.partsConcurrency
const MP_THRESHOLD_MIN = _D.thresholdMin
const MP_THRESHOLD_MAX = _D.thresholdMax
const MP_PART_SIZE_MIN = _D.partSizeMin
const MP_PART_SIZE_MAX = _D.partSizeMax
const MP_CONCURRENCY_MIN = _D.concurrencyMin
const MP_CONCURRENCY_MAX = _D.concurrencyMax

/** 从配置读传输设置（薄包装，实际逻辑在 shared，图片库共用） */
export function readMultipartSettings(get: (key: string) => unknown): FsMultipartSettings {
  return readFsTransferSettings(get)
}

/** 上传展平 / 下载目录递归展开上限：分开可配（用户 2026-11-18），0 = 不限。
 *  默认：上传 10000、下载 0 不限制（用户 2026-11-18 定版）。
 *  旧单值键 app.fs.transferFileCap 作为兼容回落：新键不存在时继承旧值，不丢用户既有设置。 */
const CFG_UPLOAD_CAP = 'app.fs.uploadFileCap'
const CFG_DOWNLOAD_CAP = 'app.fs.downloadFileCap'
const CFG_TRANSFER_FILE_CAP_LEGACY = 'app.fs.transferFileCap'
const FS_UPLOAD_CAP_DEFAULT = 10000
const FS_DOWNLOAD_CAP_DEFAULT = 0
const FS_TRANSFER_FILE_CAP_MAX = 100_000
/** 云递归搜索扫描页数上限配置（默认 500；0 = 不限） */
const CFG_SEARCH_MAX_PAGES = 'app.fs.searchMaxPages'
const FS_SEARCH_MAX_PAGES_DEFAULT = 500
const FS_SEARCH_MAX_PAGES_MAX = 100_000
/** 音视频在线预览大小上限（MB）：0 = 不限；默认 100（用户 2026-11-19） */
const CFG_MEDIA_LIMIT_MB = 'app.fs.mediaLimitMb'
const FS_MEDIA_LIMIT_MB_MAX = 4096
/** 预览优先用直链（域名/分享链接）开关：默认开，显式 false 才关（用户 2026-11-19） */
const CFG_PREVIEW_DIRECT = 'app.fs.previewDirectLink'

/** 从配置读文件数上限：0 = 不限；负数/非法回落默认；上限钳制。
 *  key 传新键；新键未设置时回落旧单值键，兼容既有用户配置（用户 2026-11-18 上传/下载分开，默认不同）。 */
function readFileCap(get: (key: string) => unknown, key: string, fallbackKey: string, fallbackDefault: number): number {
  const has = (k: string): boolean => get(k) !== undefined && get(k) !== null
  const raw = has(key) ? get(key) : has(fallbackKey) ? get(fallbackKey) : fallbackDefault
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallbackDefault
  return Math.min(FS_TRANSFER_FILE_CAP_MAX, Math.floor(n))
}
export function readUploadCap(get: (key: string) => unknown): number {
  return readFileCap(get, CFG_UPLOAD_CAP, CFG_TRANSFER_FILE_CAP_LEGACY, FS_UPLOAD_CAP_DEFAULT)
}
function readDownloadCap(get: (key: string) => unknown): number {
  return readFileCap(get, CFG_DOWNLOAD_CAP, CFG_TRANSFER_FILE_CAP_LEGACY, FS_DOWNLOAD_CAP_DEFAULT)
}
/** 云搜索扫描页数上限：0 = 不限；非法回落默认 500 */
export function readSearchMaxPages(get: (key: string) => unknown): number {
  const raw = Number(get(CFG_SEARCH_MAX_PAGES))
  if (!Number.isFinite(raw) || raw < 0) return FS_SEARCH_MAX_PAGES_DEFAULT
  return Math.min(FS_SEARCH_MAX_PAGES_MAX, Math.floor(raw))
}
/** 音视频在线预览上限（MB）：0 = 不限；非法回落默认 100 */
function readMediaLimitMb(get: (key: string) => unknown): number {
  const raw = Number(get(CFG_MEDIA_LIMIT_MB))
  if (!Number.isFinite(raw) || raw < 0) return FS_MEDIA_PLAY_LIMIT / (1024 * 1024)
  return Math.min(FS_MEDIA_LIMIT_MB_MAX, Math.floor(raw))
}

/** §十一：备注迁移——src（或其子路径）上的备注文档 path 更新为 dest 对应新路径 */
export async function migrateAnnotations(core: FsCore, profileId: string, src: string, dest: string, kind: 'dir' | 'file'): Promise<void> {
  try {
    const rows = await core.services.repository.list<FsAnnotationDoc>(
      'fsAnnotations', { profileId, archived: false },
    )
    const hit = kind === 'dir'
      ? rows.filter((r) => r.path === src || r.path.startsWith(`${src}/`))
      : rows.filter((r) => r.path === src)
    for (const r of hit) {
      const next = r.path === src ? dest : `${dest}${r.path.slice(src.length)}`
      await core.services.repository.update<FsAnnotationDoc>('fsAnnotations', r._id, { path: next })
    }
  } catch (err) {
    logger.warn('upload', `fs 备注迁移失败（不影响移动结果）：${src} → ${dest}：${(err as Error).message}`)
  }
}

/** 目录备注：整通道 path → note 映射（列表加载一次，备注列/属性弹框共用） */
export async function annotationList(core: FsCore, profileId: string): Promise<Record<string, string>> {
  const pid = core.assertProfileId(profileId)
  const rows = await core.services.repository.list<FsAnnotationDoc>(
    'fsAnnotations', { profileId: pid, archived: false },
  )
  return Object.fromEntries(rows.map((r) => [r.path, r.note]))
}

/** 设置备注：空串 = 清除（删文档）；有值 = upsert */
export async function annotationSet(core: FsCore, req: { profileId: string; path: string; note: string }): Promise<boolean> {
  const pid = core.assertProfileId(req?.profileId)
  const path = core.assertPath(req?.path)
  const note = String(req?.note ?? '').trim().slice(0, 200)
  const repo = core.services.repository
  const rows = await repo.list<FsAnnotationDoc>('fsAnnotations', { profileId: pid, path, archived: false })
  const doc = rows[0]
  if (!note) {
    if (doc) await repo.remove('fsAnnotations', doc._id)
    return true
  }
  if (doc) await repo.update<FsAnnotationDoc>('fsAnnotations', doc._id, { note })
  else await repo.insert<FsAnnotationDoc>('fsAnnotations', { profileId: pid, path, note })
  return true
}

/** 收藏夹全量（带通道展示名） */
export async function favoriteList(core: FsCore): Promise<FsFavorite[]> {
  const rows = await core.services.repository.list<FsFavoriteDoc>('fsFavorites', { archived: false })
  const nameOf = new Map(core.channels().map((c) => [c.id, c.name]))
  return rows.map((r) => ({
    _id: r._id,
    profileId: r.profileId,
    profileName: nameOf.get(r.profileId) ?? r.profileId,
    path: r.path,
    kind: r.kind,
    name: r.name,
  }))
}

/** 添加收藏：同通道同路径幂等 */
export async function favoriteAdd(core: FsCore, req: { profileId: string; path: string; kind: 'dir' | 'file'; name: string }): Promise<FsFavorite> {
  const pid = core.assertProfileId(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('根目录无需收藏', 'io')
  const repo = core.services.repository
  const rows = await repo.list<FsFavoriteDoc>('fsFavorites', { profileId: pid, path, archived: false })
  if (rows[0]) {
    return { _id: rows[0]._id, profileId: pid, path, kind: rows[0].kind, name: rows[0].name }
  }
  const doc = await repo.insert<FsFavoriteDoc>('fsFavorites', {
    profileId: pid,
    path,
    kind: req?.kind === 'dir' ? 'dir' : 'file',
    name: String(req?.name ?? fsBasename(path)).slice(0, 200),
  })
  return { _id: doc._id, profileId: pid, path, kind: doc.kind, name: doc.name }
}

/** 移除收藏（硬删，收藏无引用语义） */
export async function favoriteRemove(core: FsCore, id: string): Promise<boolean> {
  await core.services.repository.remove('fsFavorites', String(id ?? ''))
  return true
}

/** 下载落点：app.fs.downloadDir（缺省 userData/downloads/<通道id>） */
export function downloadDir(core: FsCore, profileId: string): string {
  const custom = String(core.services.config.get('app.fs.downloadDir') ?? '').trim()
  const base = custom || join(app.getPath('userData'), 'downloads')
  const dir = custom ? base : join(base, core.assertProfileId(profileId))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function setDownloadDir(core: FsCore, dir: string): string {
  const clean = String(dir ?? '').trim()
  if (!clean) throw new AppError('下载目录不能为空', 'io')
  mkdirSync(clean, { recursive: true })
  core.services.config.set('app.fs.downloadDir', clean)
  return clean
}

/** 分片设置读取（含各可写云通道遗留 uploadId 数汇总；面板/设置展示用） */
export async function transferMultipart(core: FsCore): Promise<FsMultipartStatus> {
  const s = readMultipartSettings((k) => core.services.config.get(k))
  let orphans = 0
  for (const ch of core.channels()) {
    if (ch.type !== 'cloud' || !ch.writable) continue
    try {
      const { driver } = core.resolve(ch.id)
      orphans += (await driver.multipart?.listUploads?.() ?? []).length
    } catch { /* 通道不可用（密钥缺失/网络失败）不计入 */ }
  }
  return { ...s, orphans }
}

/** 分片设置修改（main 侧钳制合法区间；实时生效、跨重启记忆） */
export function setTransferMultipart(core: FsCore, req: Partial<FsMultipartSettings>): FsMultipartSettings {
  const cur = readMultipartSettings((k) => core.services.config.get(k))
  const next: FsMultipartSettings = {
    enabled: req?.enabled === undefined ? cur.enabled : Boolean(req.enabled),
    thresholdMb: req?.thresholdMb == null ? cur.thresholdMb : Math.min(MP_THRESHOLD_MAX, Math.max(MP_THRESHOLD_MIN, Math.floor(Number(req.thresholdMb)) || MP_THRESHOLD_DEFAULT)),
    partSizeMb: req?.partSizeMb == null ? cur.partSizeMb : Math.min(MP_PART_SIZE_MAX, Math.max(MP_PART_SIZE_MIN, Math.floor(Number(req.partSizeMb)) || MP_PART_SIZE_DEFAULT)),
    partsConcurrency: req?.partsConcurrency == null ? cur.partsConcurrency : Math.min(MP_CONCURRENCY_MAX, Math.max(MP_CONCURRENCY_MIN, Math.floor(Number(req.partsConcurrency)) || MP_CONCURRENCY_DEFAULT)),
    requestTimeoutSec: req?.requestTimeoutSec == null ? cur.requestTimeoutSec : Math.min(MP_TIMEOUT_MAX, Math.max(MP_TIMEOUT_MIN, Math.floor(Number(req.requestTimeoutSec)) || MP_TIMEOUT_DEFAULT)),
  }
  core.services.config.set(CFG_MP_ENABLED, next.enabled)
  core.services.config.set(CFG_MP_THRESHOLD_MB, next.thresholdMb)
  core.services.config.set(CFG_MP_PART_SIZE_MB, next.partSizeMb)
  core.services.config.set(CFG_MP_CONCURRENCY, next.partsConcurrency)
  core.services.config.set(CFG_MP_TIMEOUT_SEC, next.requestTimeoutSec)
  logger.info('upload', `fs 传输设置更新：${next.enabled ? '分片开' : '分片关'} / 阈值 ${next.thresholdMb}MB / 片 ${next.partSizeMb}MB / 并发 ${next.partsConcurrency} / 超时 ${next.requestTimeoutSec}s`)
  return next
}

/** 传输文件数上限（上传 / 下载分开；0 = 不限；默认上传 10000、下载 0 不限）+ 在线预览上限（MB，0=不限）
 *  + 预览优先直链开关（用户 2026-11-19：默认开，键不存在/true 均为开，显式 false 才关） */
export function transferCaps(core: FsCore): { uploadCap: number; downloadCap: number; searchMaxPages: number; mediaLimitMb: number; previewDirectLink: boolean } {
  const get = (k: string): unknown => core.services.config.get(k)
  return {
    uploadCap: readUploadCap(get),
    downloadCap: readDownloadCap(get),
    searchMaxPages: readSearchMaxPages(get),
    mediaLimitMb: readMediaLimitMb(get),
    previewDirectLink: get(CFG_PREVIEW_DIRECT) !== false,
  }
}

export function setTransferCaps(core: FsCore, req: { uploadCap?: number; downloadCap?: number; searchMaxPages?: number; mediaLimitMb?: number; previewDirectLink?: boolean }): { uploadCap: number; downloadCap: number; searchMaxPages: number; mediaLimitMb: number; previewDirectLink: boolean } {
  const setCap = (key: string, raw: number | undefined, max: number, label: string): void => {
    if (raw == null) return
    const v = Math.floor(Number(raw))
    if (!Number.isFinite(v) || v < 0) throw new AppError(`${label}必须是不小于 0 的整数（0 = 不限）`)
    core.services.config.set(key, Math.min(max, v))
  }
  setCap(CFG_UPLOAD_CAP, req?.uploadCap, FS_TRANSFER_FILE_CAP_MAX, '上传文件数上限')
  setCap(CFG_DOWNLOAD_CAP, req?.downloadCap, FS_TRANSFER_FILE_CAP_MAX, '下载文件数上限')
  setCap(CFG_SEARCH_MAX_PAGES, req?.searchMaxPages, FS_SEARCH_MAX_PAGES_MAX, '搜索扫描页数上限')
  setCap(CFG_MEDIA_LIMIT_MB, req?.mediaLimitMb, FS_MEDIA_LIMIT_MB_MAX, '在线预览大小上限')
  if (req?.previewDirectLink != null) {
    core.services.config.set(CFG_PREVIEW_DIRECT, Boolean(req.previewDirectLink))
  }
  return transferCaps(core)
}
