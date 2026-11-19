import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import { zipSync, unzipSync } from 'fflate'
import iconv from 'iconv-lite'
import {
  CloudFsDriver,
  LocalFsDriver,
  RemoteFsDriver,
  fsBasename,
  fsDestPath,
  normalizeRootRel,
} from '@sshk/upload-core'
import type { FsDriver, FsSearchBatchFn } from '@sshk/upload-core'
import type { FsAnnotationDoc, FsFavoriteDoc } from '@sshk/repository'
import {
  TOOL_IDS,
  fsFormatSize,
  isFsZipName,
  normalizeUploadConfig,
  uploadVendorMeta,
  type FsChannelInfo,
  type FsChmodRequest,
  type FsConvertTextRequest,
  type FsConvertTextResult,
  type FsCrossCopyRequest,
  type FsCrossCopyResult,
  type FsCpRequest,
  type FsFavorite,
  type FsLocalFile,
  type FsListPage,
  type FsMultipartSettings,
  type FsMultipartStatus,
  type FsMvRequest,
  type FsProfilesPayload,
  type FsReadResult,
  type FsRmRequest,
  type FsSearchRequest,
  type FsSearchResult,
  type FsStatResult,
  type FsTransferControlRequest,
  type FsTransferInput,
  type FsTransferTask,
  type FsUnzipRequest,
  type FsUnzipResult,
  type FsUsageResult,
  type FsWriteRequest,
  type FsZipRequest,
  type FsZipResult,
  fsMissingChunks,
  fsMultipartPlan,
  fsTransferCanPersist,
} from '@sshk/shared'
import type { AppServices } from './services'
import { logger } from './logger'

/**
 * 文件系统运行时（X6 F-4 / plans/08）：main 进程持有，
 * 对已配置上传通道做远端/云文件浏览与管理 + 统一传输队列。
 *
 * - 通道 = 上传管理（原上传配置）的 remote/cloud profile；密钥经 safeStorage 注入驱动，渲染层零接触。
 * - 路径安全：所有入参先过 normalizeRootRel（`..` / 反斜杠 / 控制字符拒绝，§六）。
 * - 传输队列：同通道并发限制（远程 3 / 云 5）、失败自动重试 1 次、可取消/手动重试、
 *   冲突（远端已存在同名 / 本地已存在同名）先确认再执行；进度节流推给渲染层。
 * - 审计：全部写操作落日志（scope=upload，action/路径/结果，不含内容），error 级纳入 N2。
 */

const SECRET_TOOL_ID = TOOL_IDS.uploadManager
const PROFILE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** 传输队列任务总量上限：防止异常入参把队列撑爆 */
const MAX_TASKS = 2000
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
/** 文本编码/换行符转换的文件大小上限（§十一 转换格式 A） */
const FS_TEXT_CONVERT_LIMIT = 20 * 1024 * 1024
/** zip 压缩/解压上限的可配置键与缺省值（内存型操作，防 OOM；渲染层可在「压缩上限设置」调整） */
const CFG_ZIP_FILE_CAP = 'app.fs.zipFileCap'
const CFG_ZIP_BYTES_CAP = 'app.fs.zipBytesCap'
const FS_ZIP_FILE_CAP_DEFAULT = 3000
const FS_ZIP_BYTES_CAP_DEFAULT = 500 * 1024 * 1024
/** 配置读取后的合法区间钳制（防止误填离谱值） */
const FS_ZIP_FILE_CAP_MIN = 10
const FS_ZIP_FILE_CAP_MAX = 100_000
const FS_ZIP_BYTES_CAP_MIN = 1024 * 1024
const FS_ZIP_BYTES_CAP_MAX = 4 * 1024 * 1024 * 1024

/** ── plans/10 分片设置（阈值/片大小/并发全部可设置、实时生效、跨重启记忆）── */
const CFG_MP_ENABLED = 'app.fs.multipart.enabled'
const CFG_MP_THRESHOLD_MB = 'app.fs.multipart.thresholdMb'
const CFG_MP_PART_SIZE_MB = 'app.fs.multipart.partSizeMb'
const CFG_MP_CONCURRENCY = 'app.fs.multipart.partsConcurrency'
const MP_THRESHOLD_DEFAULT = 50
const MP_PART_SIZE_DEFAULT = 5
const MP_CONCURRENCY_DEFAULT = 3
const MP_THRESHOLD_MIN = 1
const MP_THRESHOLD_MAX = 1024
const MP_PART_SIZE_MIN = 5
const MP_PART_SIZE_MAX = 100
const MP_CONCURRENCY_MIN = 1
const MP_CONCURRENCY_MAX = 8
const MB = 1024 * 1024
/** 内存闸门：同时开片跑分片的任务数上限（总并发 = 通道并发 × 分片并发，由该闸门兜底） */
const MP_TASK_GATE = 2

/** 从配置读分片设置（缺省/非法回落默认值并钳制到合法区间） */
function readMultipartSettings(get: (key: string) => unknown): FsMultipartSettings {
  const clamp = (raw: unknown, min: number, max: number, dflt: number): number => {
    const n = Math.floor(Number(raw))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
  }
  return {
    enabled: get(CFG_MP_ENABLED) !== false, // 键不存在/true 均为开；显式 false 才关
    thresholdMb: clamp(get(CFG_MP_THRESHOLD_MB), MP_THRESHOLD_MIN, MP_THRESHOLD_MAX, MP_THRESHOLD_DEFAULT),
    partSizeMb: clamp(get(CFG_MP_PART_SIZE_MB), MP_PART_SIZE_MIN, MP_PART_SIZE_MAX, MP_PART_SIZE_DEFAULT),
    partsConcurrency: clamp(get(CFG_MP_CONCURRENCY), MP_CONCURRENCY_MIN, MP_CONCURRENCY_MAX, MP_CONCURRENCY_DEFAULT),
  }
}

/** 分片上传检查点（`userData/fs-transfer/checkpoints/<taskId>.json`，每片完成即原子写） */
interface MultipartCheckpoint {
  type: 'multipart'
  uploadId: string
  /** 目标远端路径（通道根相对） */
  key: string
  /** 源文件绝对路径 / size / mtime：任一不符即废弃检查点重开（防续传污染目标） */
  localPath: string
  size: number
  mtimeMs: number
  partSize: number
  parts: { partNumber: number; size: number; etag: string }[]
}

/** 本地文件分片读（上传 multipart 用；读 [start,end) 区段） */
async function readSlice(localPath: string, start: number, end: number): Promise<Buffer> {
  const len = Math.max(0, end - start)
  if (len === 0) return Buffer.alloc(0)
  const fh = await fsPromises.open(localPath, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, start)
    return bytesRead === len ? buf : buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** 本地绝对路径取最后一段：系统弹框/拖拽在 Windows 下是反斜杠路径，不适用 root-rel 的 fsBasename */
function localBasename(abs: string): string {
  const s = String(abs ?? '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i < 0 ? s : s.slice(i + 1)
}

/** 从配置读文件数上限：0 = 不限；负数/非法回落默认；上限钳制。
 *  key 传新键；新键未设置时回落旧单值键，兼容既有用户配置（用户 2026-11-18 上传/下载分开，默认不同）。 */
function readFileCap(get: (key: string) => unknown, key: string, fallbackKey: string, fallbackDefault: number): number {
  const has = (k: string): boolean => get(k) !== undefined && get(k) !== null
  const raw = has(key) ? get(key) : has(fallbackKey) ? get(fallbackKey) : fallbackDefault
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallbackDefault
  return Math.min(FS_TRANSFER_FILE_CAP_MAX, Math.floor(n))
}
function readUploadCap(get: (key: string) => unknown): number {
  return readFileCap(get, CFG_UPLOAD_CAP, CFG_TRANSFER_FILE_CAP_LEGACY, FS_UPLOAD_CAP_DEFAULT)
}
function readDownloadCap(get: (key: string) => unknown): number {
  return readFileCap(get, CFG_DOWNLOAD_CAP, CFG_TRANSFER_FILE_CAP_LEGACY, FS_DOWNLOAD_CAP_DEFAULT)
}
/** 云搜索扫描页数上限：0 = 不限；非法回落默认 500 */
function readSearchMaxPages(get: (key: string) => unknown): number {
  const raw = Number(get(CFG_SEARCH_MAX_PAGES))
  if (!Number.isFinite(raw) || raw < 0) return FS_SEARCH_MAX_PAGES_DEFAULT
  return Math.min(FS_SEARCH_MAX_PAGES_MAX, Math.floor(raw))
}

/** 从配置读 zip 上限（缺省/非法回落默认值并钳制到合法区间） */
function readZipCaps(get: (key: string) => unknown): { fileCap: number; bytesCap: number } {
  const fileCap = Math.min(
    FS_ZIP_FILE_CAP_MAX,
    Math.max(FS_ZIP_FILE_CAP_MIN, Math.floor(Number(get(CFG_ZIP_FILE_CAP)) || FS_ZIP_FILE_CAP_DEFAULT)),
  )
  const bytesCap = Math.min(
    FS_ZIP_BYTES_CAP_MAX,
    Math.max(FS_ZIP_BYTES_CAP_MIN, Math.floor(Number(get(CFG_ZIP_BYTES_CAP)) || FS_ZIP_BYTES_CAP_DEFAULT)),
  )
  return { fileCap, bytesCap }
}
/** 删除任务计入队列的目录（递归删除走队列，带进度） */

interface RuntimeResolved {
  driver: FsDriver
  channel: FsChannelInfo
}

export interface FsRuntimeOptions {
  services: AppServices
  /** 传输任务变化推送（main/index.ts 转发给渲染层） */
  onEvent: (task: FsTransferTask) => void
}

/** 持久化队列条目（plans/10 §7：task 快照去运行时字段；schema 带 version，checkpoint 判别式见各文件） */
interface PersistedTask {
  id: string
  kind: string
  profileId: string
  profileName: string
  name: string
  remotePath?: string
  localPath?: string
  destPath?: string
  destRemotePath?: string
  destProfileId?: string
  destProfileName?: string
  moveSource?: boolean
  size: number
  transferred: number
  startedAt?: number
}

/** 队列持久化存储（plans/10 §7）：userData/fs-transfer/queue.json，tmp+rename 原子落盘。
 *  canPersist 判定在 shared（fsTransferCanPersist）；后期接入 copy/cross/delete 只需扩展判定与 checkpoint 分支 */
class FsTransferStore {
  private readonly file: string
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'queue.json')
  }

  load(): PersistedTask[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: number; tasks?: PersistedTask[] }
      if (raw.version !== 1 || !Array.isArray(raw.tasks)) return []
      return raw.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.kind === 'string')
    } catch {
      return [] // 首次运行 / 文件损坏：空队列起步（不做兼容迁移）
    }
  }

  save(tasks: PersistedTask[]): void {
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, tasks }, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      logger.warn('upload', `fs 传输队列持久化失败（不影响传输）：${(err as Error).message}`)
      try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    }
  }
}

/** 传输队列引擎：任务表 + 按通道并发调度 + 进度节流推送 + 协作式暂停 + 分片/续传 + 持久化（plans/10） */
class FsTransferEngine {
  private readonly tasks = new Map<string, FsTransferTask>()
  private readonly queued: string[] = []
  private readonly runningByProfile = new Map<string, number>()
  private readonly canceled = new Set<string>()
  private readonly overwrite = new Set<string>()
  /** 暂停请求集：running 任务置入，在协作检查点抛 `__fs_paused__`（当前片/块写完即停，最多一个分片延迟） */
  private readonly pauseRequestedIds = new Set<string>()
  /** 分片内存闸门：同时在跑分片上传的任务 id（上限 MP_TASK_GATE） */
  private readonly multipartGate = new Set<string>()
  private readonly multipartWaiters: (() => void)[] = []
  /** 速度采样（id → 上次字节/时间），不进任务对象，避免污染推送载荷 */
  private readonly samples = new Map<string, { bytes: number; at: number }>()
  private readonly store: FsTransferStore
  private readonly checkpointDir: string
  private seq = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: {
    getDriver: (profileId: string) => RuntimeResolved
    /** 同通道并发上限：远程 3 / 云 5 */
    concurrencyOf: (profileId: string) => number
    /** 分片设置（每次执行实时读取，改配置即时生效） */
    multipartSettings: () => FsMultipartSettings
    onEvent: (task: FsTransferTask) => void
    /** 队列存储目录（userData/fs-transfer） */
    storeDir: string
  }) {
    this.store = new FsTransferStore(opts.storeDir)
    this.checkpointDir = join(opts.storeDir, 'checkpoints')
    mkdirSync(this.checkpointDir, { recursive: true })
  }

  // ── 持久化 ──

  private persistable(): PersistedTask[] {
    const out: PersistedTask[] = []
    for (const t of this.tasks.values()) {
      if (!fsTransferCanPersist(t.kind, t.status)) continue
      out.push({
        id: t.id, kind: t.kind, profileId: t.profileId, profileName: t.profileName, name: t.name,
        remotePath: t.remotePath, localPath: t.localPath, destPath: t.destPath, destRemotePath: t.destRemotePath,
        destProfileId: t.destProfileId, destProfileName: t.destProfileName, moveSource: t.moveSource,
        size: t.size, transferred: t.transferred, startedAt: t.startedAt,
      })
    }
    return out
  }

  /** 状态变化防抖 300ms 写一次盘 */
  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.store.save(this.persistable())
    }, 300)
  }

  /** 应用退出前同步落盘（main/index.ts before-quit 调用） */
  flushPersist(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    this.store.save(this.persistable())
  }

  /** 启动恢复：读回持久化任务，一律置 paused（不自动续跑），resumable 按检查点文件判定 */
  restore(): number {
    const rows = this.store.load()
    for (const r of rows) {
      if (this.tasks.has(r.id)) continue
      const task: FsTransferTask = {
        id: r.id,
        kind: r.kind as FsTransferTask['kind'],
        profileId: r.profileId,
        profileName: r.profileName,
        name: r.name,
        remotePath: r.remotePath,
        localPath: r.localPath,
        destPath: r.destPath,
        destRemotePath: r.destRemotePath,
        destProfileId: r.destProfileId,
        destProfileName: r.destProfileName,
        moveSource: r.moveSource,
        size: r.size,
        transferred: r.transferred,
        status: 'paused',
        startedAt: r.startedAt,
        persisted: true,
        resumable: this.hasResumeArtifact(r),
      }
      this.tasks.set(task.id, task)
    }
    if (rows.length) logger.info('upload', `fs 传输队列恢复：${rows.length} 个任务置为暂停（不自动续跑）`)
    return rows.length
  }

  /** 是否存在续传产物（上传检查点 json / 下载区间元数据 json） */
  private hasResumeArtifact(r: { id: string; kind: string; destPath?: string }): boolean {
    if (r.kind === 'upload' && existsSync(this.checkpointPath(r.id))) return true
    if (r.kind === 'download' && r.destPath && existsSync(`${r.destPath}.sshkpart.json`)) return true
    return false
  }

  // ── 控制入口（plans/10：单一 control 分发） ──

  control(req: FsTransferControlRequest): boolean {
    const ids = Array.isArray(req?.ids) ? req.ids.filter((x) => typeof x === 'string' && x) : []
    switch (req?.action) {
      case 'start':
      case 'resume': return this.resume(ids)
      case 'pause': return this.pause(ids)
      case 'stop': return this.stop(ids)
      case 'retry': return this.retry(ids, Boolean(req.overwrite))
      case 'remove': return this.remove(ids)
      case 'startAll': return this.startAll()
      case 'pauseAll': return this.pauseAll()
      case 'stopAll': return this.stopAll()
      case 'retryFailed': return this.retryFailed()
      case 'clearFinished': {
        this.clearFinished()
        this.schedulePersist()
        return true
      }
      default: throw new Error(`未知传输控制动作：${String(req?.action)}`)
    }
  }

  all(): FsTransferTask[] {
    return [...this.tasks.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  }

  add(inputs: FsTransferInput[], resolve: (profileId: string) => RuntimeResolved): string[] {
    const ids: string[] = []
    for (const input of inputs.slice(0, MAX_TASKS)) {
      this.seq += 1
      const id = `fsx-${Date.now().toString(36)}-${this.seq}`
      const r = resolve(input.profileId)
      const task: FsTransferTask = {
        id,
        kind: input.kind,
        profileId: input.profileId,
        profileName: r.channel.name,
        name: input.name,
        remotePath: input.remotePath,
        localPath: input.localPath,
        destPath: input.destPath,
        destRemotePath: input.destRemotePath,
        destProfileId: input.destProfileId,
        destProfileName: input.destProfileId ? resolve(input.destProfileId).channel.name : undefined,
        moveSource: input.moveSource,
        size: Number(input.size) || 0,
        transferred: 0,
        status: 'queued',
        startedAt: Date.now(),
      }
      this.tasks.set(id, task)
      // 入参已确认覆盖（如系统另存为对话框做过替换确认）：直接放行引擎冲突检查
      if (input.overwrite) this.overwrite.add(id)
      ids.push(id)
      this.queued.push(id)
    }
    this.schedulePersist()
    this.pump()
    return ids
  }

  /** 暂停（协作式）：queued 直接挂起；running 置暂停请求，在下一个检查点（片/块/目录项边界）停下 */
  pause(ids: string[]): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t) continue
      if (t.status === 'queued') this.setStatus(t, 'paused')
      else if (t.status === 'running') {
        this.pauseRequestedIds.add(id)
        t.pausing = true
        this.push(t)
      }
    }
    return true
  }

  /** 继续/开始：清暂停标记 → 重新入队（可续传任务走检查点续传，单流任务从头写） */
  resume(ids: string[]): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t || t.status !== 'paused') continue
      this.pauseRequestedIds.delete(id)
      t.pausing = undefined
      this.samples.delete(id)
      this.setStatus(t, 'queued', { error: undefined, finishedAt: undefined })
      this.queued.push(id)
    }
    this.pump()
    return true
  }

  /** 停止：等同取消 + 续传产物清理（服务端 uploadId / 本地检查点 / 下载临时文件） */
  stop(ids: string[]): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t) continue
      this.pauseRequestedIds.delete(id)
      t.pausing = undefined
      if (t.status === 'queued' || t.status === 'paused' || t.status === 'conflict') this.setStatus(t, 'canceled')
      else if (t.status === 'running') this.canceled.add(id)
      void this.cleanupResumeArtifacts(id)
    }
    this.schedulePersist()
    this.pump()
    return true
  }

  /** 手动重试：失败/取消/暂停/冲突任务重新入队；可续传任务保留进度走检查点续传 */
  retry(ids: string[], overwrite = false): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t || t.status === 'running') continue
      if (t.status === 'conflict' && overwrite) this.overwrite.add(id)
      if (t.status === 'canceled') this.canceled.delete(id)
      this.pauseRequestedIds.delete(id)
      this.samples.delete(id)
      const keep = t.resumable === true
      this.setStatus(t, 'queued', keep
        ? { error: undefined, finishedAt: undefined, pausing: undefined }
        : { transferred: 0, error: undefined, finishedAt: undefined, partsDone: undefined, partsTotal: undefined, pausing: undefined })
      this.queued.push(id)
    }
    this.schedulePersist()
    this.pump()
    return true
  }

  /** 移除任务（仅非 running 状态；running 由 UI 限流不给移除入口） */
  remove(ids: string[]): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t || t.status === 'running') continue
      this.tasks.delete(id)
      this.samples.delete(id)
      this.canceled.delete(id)
      this.overwrite.delete(id)
      this.pauseRequestedIds.delete(id)
      const qi = this.queued.indexOf(id)
      if (qi >= 0) this.queued.splice(qi, 1)
    }
    this.schedulePersist()
    return true
  }

  startAll(): boolean {
    return this.resume([...this.tasks.values()].filter((t) => t.status === 'paused').map((t) => t.id))
  }

  pauseAll(): boolean {
    return this.pause([...this.tasks.values()].filter((t) => t.status === 'queued' || t.status === 'running').map((t) => t.id))
  }

  stopAll(): boolean {
    return this.stop([...this.tasks.values()]
      .filter((t) => t.status !== 'success' && t.status !== 'failed' && t.status !== 'canceled')
      .map((t) => t.id))
  }

  retryFailed(): boolean {
    return this.retry([...this.tasks.values()]
      .filter((t) => t.status === 'failed' || t.status === 'canceled')
      .map((t) => t.id))
  }

  /** 清掉已完结任务（成功/失败/取消/冲突），进行中的保留 */
  clearFinished(): number {
    let removed = 0
    for (const [id, t] of [...this.tasks.entries()]) {
      if (t.status === 'queued' || t.status === 'running' || t.status === 'paused') continue
      this.tasks.delete(id)
      this.samples.delete(id)
      removed++
    }
    return removed
  }

  private concurrencyLeft(profileId: string): number {
    const used = this.runningByProfile.get(profileId) ?? 0
    return Math.max(0, this.opts.concurrencyOf(profileId) - used)
  }

  private pump(): void {
    for (;;) {
      const id = this.queued.shift()
      if (!id) return
      const t = this.tasks.get(id)
      if (!t || t.status !== 'queued') continue
      if (this.concurrencyLeft(t.profileId) <= 0) {
        this.queued.unshift(id)
        // 本通道满：先跑其它通道的任务
        const alt = this.queued.findIndex((x) => this.concurrencyLeft(this.tasks.get(x)?.profileId ?? '') > 0)
        if (alt >= 0) {
          const [other] = this.queued.splice(alt, 1)
          if (other) this.start(this.tasks.get(other)!)
        }
        return
      }
      this.start(t)
    }
  }

  private start(t: FsTransferTask): void {
    this.runningByProfile.set(t.profileId, (this.runningByProfile.get(t.profileId) ?? 0) + 1)
    void this.execute(t)
  }

  private setStatus(t: FsTransferTask, status: FsTransferTask['status'], patch: Partial<FsTransferTask> = {}): void {
    const finished = status === 'success' || status === 'failed' || status === 'canceled' || status === 'conflict'
    const wasRunning = t.status === 'running'
    Object.assign(t, patch, { status, ...(finished ? { finishedAt: Date.now() } : {}) })
    if (wasRunning && status !== 'running') {
      // 暂停同样释放并发额度（plans/10 §4）
      this.runningByProfile.set(t.profileId, Math.max(0, (this.runningByProfile.get(t.profileId) ?? 1) - 1))
    }
    this.push(t)
    this.schedulePersist()
    this.pump()
  }

  /** 节流推送：全量任务形态下发（渲染层按 id 覆盖）；t 仅标记来源，统一刷全量 */
  private push(_t: FsTransferTask): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      for (const task of this.tasks.values()) this.opts.onEvent(task)
    }, 120)
  }

  private assertNotCanceled(t: FsTransferTask): void {
    if (this.canceled.delete(t.id)) throw new Error(`__fs_canceled__:${t.id}`)
  }

  /** 协作检查点（暂停优先于取消：先暂停后取消，plans/10 §4） */
  private assertNotPaused(t: FsTransferTask): void {
    if (this.pauseRequestedIds.delete(t.id)) throw new Error(`__fs_paused__:${t.id}`)
  }

  /** 进度采样：更新 transferred/speed 并节流推送；随后过暂停/取消检查点 */
  private sample(t: FsTransferTask, transferred: number, total?: number): void {
    const now = Date.now()
    const prev = this.samples.get(t.id)
    if (prev && now > prev.at) {
      t.speed = Math.max(0, Math.round(((transferred - prev.bytes) / (now - prev.at)) * 1000))
    }
    this.samples.set(t.id, { bytes: transferred, at: now })
    t.transferred = transferred
    if (total != null && t.kind === 'delete') t.size = total
    this.push(t)
    this.assertNotPaused(t)
    this.assertNotCanceled(t)
  }

  private async execute(t: FsTransferTask): Promise<void> {
    this.setStatus(t, 'running')
    // 失败自动重试 1 次（取消/冲突/暂停除外）
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const { driver } = this.opts.getDriver(t.profileId)
        if (t.kind === 'upload') await this.runUpload(t, driver)
        else if (t.kind === 'download') await this.runDownload(t, driver)
        else if (t.kind === 'copy') await this.runCopy(t, driver)
        else if (t.kind === 'cross') await this.runCross(t, driver)
        else await this.runDelete(t, driver)
        this.setStatus(t, 'success', { speed: undefined })
        return
      } catch (err) {
        const msg = String((err as Error).message ?? err)
        if (msg.startsWith('__fs_paused__')) {
          // 协作式暂停落定：保留 transferred 与检查点，等「继续」
          this.setStatus(t, 'paused', { pausing: undefined, speed: undefined })
          return
        }
        if (msg.startsWith('__fs_canceled__')) {
          // 停止：清理服务端 uploadId / 本地检查点 / 下载临时文件（失败仅告警，遗留走手动清理）
          await this.cleanupResumeArtifacts(t.id)
          this.setStatus(t, 'canceled')
          return
        }
        if (attempt === 0 && !this.canceled.has(t.id) && !this.pauseRequestedIds.has(t.id)) {
          logger.warn('upload', `fs 传输首次失败，自动重试：${t.name}：${msg}`)
          continue
        }
        this.setStatus(t, 'failed', { error: msg, speed: undefined, pausing: undefined })
        logger.error('upload', `fs 传输失败：${t.kind} ${t.remotePath ?? ''}：${msg}`)
        return
      }
    }
  }

  private async runUpload(t: FsTransferTask, driver: FsDriver): Promise<void> {
    const localPath = String(t.localPath ?? '')
    if (!localPath || !existsSync(localPath)) throw new Error(`本地文件不存在：${localPath}`)
    const st = statSync(localPath)
    if (!st.isFile()) throw new Error('只能上传文件（目录请先展平）')
    t.size = st.size
    // 冲突：远端已有同名文件 → 挂起等确认
    const stat = await driver.stat(String(t.remotePath ?? ''))
    if (stat.exists && !stat.isDir && !this.overwrite.has(t.id)) {
      this.setStatus(t, 'conflict', { error: '目标目录已有同名文件：任务已暂停、尚未上传。点「覆盖」=覆盖远端同名文件继续上传；点「停止」=跳过此文件' })
      return
    }
    this.overwrite.delete(t.id)
    // 分片：阈值（默认 50MB）以上 + 目标驱动支持 multipart（OSS/S3），其余单流直传
    const caps = this.opts.multipartSettings()
    if (caps.enabled && driver.multipart && st.size >= caps.thresholdMb * MB) {
      await this.runUploadMultipart(t, driver.multipart, st, caps)
      logger.info('upload', `fs 分片上传完成：${t.remotePath}（${fsFormatSize(st.size)}，${t.partsTotal ?? '?'} 片）`)
      return
    }
    const stream = createReadStream(localPath)
    await driver.write(String(t.remotePath ?? ''), stream, (n) => this.sample(t, n))
    logger.info('upload', `fs 上传完成：${t.remotePath}（${fsFormatSize(st.size)}）`)
  }

  // ── 分片上传（plans/10 §5）──

  private checkpointPath(id: string): string {
    return join(this.checkpointDir, `${id}.json`)
  }

  private readUploadCheckpoint(id: string): MultipartCheckpoint | null {
    try {
      const raw = JSON.parse(readFileSync(this.checkpointPath(id), 'utf8')) as MultipartCheckpoint
      if (raw?.type === 'multipart' && raw.uploadId) return raw
      return null
    } catch {
      return null
    }
  }

  /** 每片完成即原子写（tmp+rename），崩溃/断电不落半截检查点 */
  private writeCheckpoint(id: string, cp: MultipartCheckpoint): void {
    const tmp = `${this.checkpointPath(id)}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(cp), 'utf8')
      renameSync(tmp, this.checkpointPath(id))
    } catch (err) {
      logger.warn('upload', `fs 分片检查点写入失败（续传能力受损）：${id}：${(err as Error).message}`)
      try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    }
  }

  private deleteCheckpoint(id: string): void {
    try { rmSync(this.checkpointPath(id), { force: true }) } catch { /* 忽略 */ }
  }

  /** 分片内存闸门：同时开片任务 ≤ MP_TASK_GATE；被暂停/取消的任务立即让位（上层 sample 会抛） */
  private async acquireMultipartSlot(t: FsTransferTask): Promise<void> {
    for (;;) {
      if (this.canceled.has(t.id) || this.pauseRequestedIds.has(t.id)) return
      if (this.multipartGate.size < MP_TASK_GATE) {
        this.multipartGate.add(t.id)
        return
      }
      await new Promise<void>((res) => this.multipartWaiters.push(res))
    }
  }

  private releaseMultipartSlot(t: FsTransferTask): void {
    if (this.multipartGate.delete(t.id)) {
      const next = this.multipartWaiters.shift()
      if (next) next()
    }
  }

  private async runUploadMultipart(
    t: FsTransferTask,
    mp: NonNullable<FsDriver['multipart']>,
    st: { size: number; mtimeMs: number },
    caps: FsMultipartSettings,
  ): Promise<void> {
    const remotePath = String(t.remotePath ?? '')
    const localPath = String(t.localPath ?? '')
    const plan = fsMultipartPlan(st.size, caps.partSizeMb)
    // 检查点续传：源文件 path/size/mtime 任一不符 → 废弃检查点并 abort 旧 uploadId 重开
    let cp = this.readUploadCheckpoint(t.id)
    if (cp && (cp.key !== remotePath || cp.localPath !== localPath || cp.size !== st.size || cp.mtimeMs !== st.mtimeMs)) {
      try { await mp.abort(remotePath, cp.uploadId) } catch { /* 服务端碎片走「遗留分片」手动清理 */ }
      cp = null
      this.deleteCheckpoint(t.id)
    }
    if (!cp) {
      const { uploadId } = await mp.create(remotePath)
      cp = { type: 'multipart', uploadId, key: remotePath, localPath, size: st.size, mtimeMs: st.mtimeMs, partSize: plan.partSize, parts: [] }
      this.writeCheckpoint(t.id, cp)
    }
    const total = Math.max(1, Math.ceil(st.size / cp.partSize))
    t.partsTotal = total
    t.resumable = true
    // 与服务端比对：只保留服务端确实存在且大小一致的片（重试/重启续传正确性）
    const serverParts = await mp.listParts(remotePath, cp.uploadId)
    const serverMap = new Map(serverParts.map((p) => [p.partNumber, p]))
    cp.parts = cp.parts.filter((p) => {
      const s = serverMap.get(p.partNumber)
      return s != null && s.size === p.size
    })
    this.writeCheckpoint(t.id, cp)
    const done = new Set(cp.parts.map((p) => p.partNumber))
    const doneBytes = Math.min(st.size, cp.parts.reduce((s, p) => s + p.size, 0))
    t.partsDone = done.size
    t.transferred = doneBytes
    this.push(t)

    await this.acquireMultipartSlot(t)
    let transferred = doneBytes
    let nextPart = 1
    const failures: Error[] = []
    try {
      const workers = Math.min(Math.max(1, caps.partsConcurrency), total)
      await Promise.all(Array.from({ length: workers }, () => (async () => {
        for (;;) {
          if (failures.length || this.canceled.has(t.id) || this.pauseRequestedIds.has(t.id)) return
          const pn = nextPart++
          if (pn > total) return
          if (done.has(pn)) continue
          const start = (pn - 1) * cp!.partSize
          const end = Math.min(st.size, pn * cp!.partSize)
          const buf = await readSlice(localPath, start, end)
          // 单片失败重试 1 次；仍失败 → 整个任务 failed（保留检查点，点「重试」续传）
          let etag = ''
          try {
            etag = (await mp.uploadPart(remotePath, cp!.uploadId, pn, buf)).etag
          } catch (err) {
            try {
              etag = (await mp.uploadPart(remotePath, cp!.uploadId, pn, buf)).etag
            } catch {
              if (!failures.length) failures.push(err instanceof Error ? err : new Error(String(err)))
              return
            }
          }
          done.add(pn)
          cp!.parts.push({ partNumber: pn, size: buf.length, etag })
          this.writeCheckpoint(t.id, cp!)
          t.partsDone = done.size
          transferred += buf.length
          // 片边界协作检查点：暂停/取消在当前片写完后生效（服务端不留碎片，可无损续传）
          this.sample(t, transferred)
        }
      })()))
      if (failures.length) throw failures[0]!
      if (done.size !== total) throw new Error(`分片不完整（${done.size}/${total}），任务中止（检查点已保留，可重试续传）`)
      await mp.complete(remotePath, cp.uploadId, cp.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })))
      this.deleteCheckpoint(t.id)
      t.resumable = false
      t.partsDone = total
      t.partsTotal = total
      t.transferred = st.size
      this.push(t)
    } finally {
      this.releaseMultipartSlot(t)
    }
  }

  // ── 续传产物清理（停止/取消时；失败保留供续传，遗留走手动清理）──

  private async cleanupResumeArtifacts(id: string): Promise<void> {
    const t = this.tasks.get(id)
    const cp = this.readUploadCheckpoint(id)
    if (cp) {
      this.deleteCheckpoint(id)
      if (t?.kind === 'upload' && t.remotePath) {
        try {
          const { driver } = this.opts.getDriver(t.profileId)
          await driver.multipart?.abort(String(t.remotePath), cp.uploadId)
        } catch (err) {
          logger.warn('upload', `fs 停止清理 uploadId 失败（留待「遗留分片」手动清理）：${cp.uploadId}：${(err as Error).message}`)
        }
      }
    }
    if (t?.kind === 'download' && t.destPath) {
      try { rmSync(`${t.destPath}.sshkpart`, { force: true }) } catch { /* 忽略 */ }
      try { rmSync(`${t.destPath}.sshkpart.json`, { force: true }) } catch { /* 忽略 */ }
    }
  }

  private async runDownload(t: FsTransferTask, driver: FsDriver): Promise<void> {
    const remotePath = String(t.remotePath ?? '')
    const destPath = String(t.destPath ?? '')
    if (!destPath) throw new Error('缺少下载落点')
    const stat = await driver.stat(remotePath)
    if (!stat.exists || stat.isDir) throw new Error('远端文件不存在或为目录')
    t.size = stat.size ?? 0
    if (existsSync(destPath) && !this.overwrite.has(t.id)) {
      this.setStatus(t, 'conflict', { error: '本地已有同名文件：任务已暂停、尚未写入。点「覆盖」=覆盖本地文件；点「停止」=跳过此文件' })
      return
    }
    this.overwrite.delete(t.id)
    // 分片下载：阈值以上 + 驱动具备 Range 能力（local/SFTP/OSS/S3）；不支持 Range 的通道回落单流
    const caps = this.opts.multipartSettings()
    const rangeOk = caps.enabled && driver.range != null && (stat.size ?? 0) >= caps.thresholdMb * MB &&
      (await driver.range.capabilities()).supportsRange
    if (driver.range && rangeOk) {
      await this.runDownloadRange(t, driver.range, caps)
      logger.info('upload', `fs 分片下载完成：${remotePath} → ${destPath}（${fsFormatSize(t.size)}，${t.partsTotal ?? '?'} 段）`)
      return
    }
    // 目录下载会带相对子路径（demo/used/webp/x.webp），落点父目录可能不存在——先递归建，避免 ENOENT
    mkdirSync(dirname(destPath), { recursive: true })
    await driver.download(remotePath, destPath, (n) => this.sample(t, n))
    logger.info('upload', `fs 下载完成：${remotePath} → ${destPath}（${fsFormatSize(stat.size ?? 0)}）`)
  }

  /** 分片下载 + 断点续传（plans/10 §6）：临时 `<dest>.sshkpart` + 区间元数据，完成校验后原子改名 */
  private async runDownloadRange(
    t: FsTransferTask,
    rg: NonNullable<FsDriver['range']>,
    caps: FsMultipartSettings,
  ): Promise<void> {
    const remotePath = String(t.remotePath ?? '')
    const destPath = String(t.destPath ?? '')
    // 源指纹校验：变更即废弃旧区间从头下载（防续传污染目标）
    const fp = await rg.statForResume(remotePath)
    t.size = fp.size
    const plan = fsMultipartPlan(fp.size, caps.partSizeMb)
    const tmp = `${destPath}.sshkpart`
    const metaPath = `${tmp}.json`
    let meta = this.readRangeMeta(metaPath)
    if (meta && (meta.fingerprint !== fp.fingerprint || meta.size !== fp.size || meta.partSize !== plan.partSize)) {
      this.deleteRangeArtifacts(tmp, metaPath)
      meta = null
    }
    if (!meta) meta = { size: fp.size, fingerprint: fp.fingerprint, partSize: plan.partSize, ranges: [] }
    t.resumable = true
    t.partsTotal = plan.partsTotal
    // 打开临时文件：不存在则建；长度钳到目标大小（完成前绝不碰正式目标）
    mkdirSync(dirname(destPath), { recursive: true })
    const fh = await fsPromises.open(tmp, 'a+')
    try {
      const st0 = await fh.stat()
      if (st0.size !== fp.size) await fh.truncate(fp.size)
      const writtenBytes = (ranges: { start: number; end: number }[]): number =>
        ranges.reduce((s, r) => s + (r.end - r.start + 1), 0)
      t.partsDone = meta.ranges.length
      t.transferred = Math.min(fp.size, writtenBytes(meta.ranges))
      this.push(t)
      const missing = fsMissingChunks(fp.size, plan.partSize, meta.ranges)
      for (const chunk of missing) {
        // 段边界协作检查点（暂停/取消在当前段写完后生效）
        this.assertNotPaused(t)
        this.assertNotCanceled(t)
        const buf = await rg.readRange(remotePath, chunk.start, chunk.end)
        await fh.write(buf, 0, buf.length, chunk.start)
        meta.ranges.push({ start: chunk.start, end: chunk.end - 1 })
        this.writeRangeMeta(metaPath, meta)
        t.partsDone = meta.ranges.length
        this.sample(t, Math.min(fp.size, writtenBytes(meta.ranges)))
      }
      const st1 = await fh.stat()
      if (st1.size !== fp.size) throw new Error(`下载校验失败：本地 ${st1.size} 字节 ≠ 远端 ${fp.size} 字节`)
    } finally {
      await fh.close()
    }
    // 完成校验通过 → 原子改名到目标路径，清理区间元数据
    await fsPromises.rename(tmp, destPath)
    try { rmSync(metaPath, { force: true }) } catch { /* 忽略 */ }
    t.resumable = false
    t.partsDone = plan.partsTotal
    t.partsTotal = plan.partsTotal
    t.transferred = fp.size
    this.push(t)
  }

  private readRangeMeta(metaPath: string): { size: number; fingerprint: string; partSize: number; ranges: { start: number; end: number }[] } | null {
    try {
      const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as { size?: number; fingerprint?: string; partSize?: number; ranges?: { start: number; end: number }[] }
      if (!raw || typeof raw.fingerprint !== 'string' || !Array.isArray(raw.ranges)) return null
      return { size: Number(raw.size) || 0, fingerprint: raw.fingerprint, partSize: Number(raw.partSize) || 0, ranges: raw.ranges.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end)) }
    } catch {
      return null
    }
  }

  private writeRangeMeta(metaPath: string, meta: { size: number; fingerprint: string; partSize: number; ranges: { start: number; end: number }[] }): void {
    const tmp = `${metaPath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(meta), 'utf8')
      renameSync(tmp, metaPath)
    } catch (err) {
      logger.warn('upload', `fs 下载区间元数据写入失败（续传能力受损）：${metaPath}：${(err as Error).message}`)
      try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    }
  }

  private deleteRangeArtifacts(tmp: string, metaPath: string): void {
    try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    try { rmSync(metaPath, { force: true }) } catch { /* 忽略 */ }
  }

  private async runCopy(t: FsTransferTask, driver: FsDriver): Promise<void> {
    const src = String(t.remotePath ?? '')
    const dest = String(t.destRemotePath ?? '')
    if (!src || !dest) throw new Error('复制任务缺少源/目标路径')
    const stat = await driver.stat(src)
    if (!stat.exists) throw new Error('远端源文件不存在')
    t.size = stat.size ?? 0
    await driver.cp(src, dest)
    t.transferred = t.size
    this.push(t)
    logger.info('upload', `fs 复制完成：${src} → ${dest}`)
  }

  /** 跨通道复制：源下载到临时文件 → 写入目标通道（管线复用现有驱动能力） */
  private async runCross(t: FsTransferTask, srcDriver: FsDriver): Promise<void> {
    const src = String(t.remotePath ?? '')
    const dest = String(t.destRemotePath ?? '')
    const destProfileId = String(t.destProfileId ?? '')
    if (!src || !dest || !destProfileId) throw new Error('跨通道复制缺少源/目标信息')
    const { driver: destDriver, channel: destChannel } = this.opts.getDriver(destProfileId)
    if (!destDriver.writable) throw new Error(`目标通道「${destChannel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    const stat = await srcDriver.stat(src)
    if (!stat.exists || stat.isDir) throw new Error('源文件不存在或为目录')
    t.size = stat.size ?? 0
    // 冲突：目标通道已有同名文件 → 挂起等确认
    const destStat = await destDriver.stat(dest)
    if (destStat.exists && !destStat.isDir && !this.overwrite.has(t.id)) {
      this.setStatus(t, 'conflict', { error: '目标通道已有同名文件：任务已暂停、尚未复制。点「覆盖」=覆盖目标同名文件；点「停止」=跳过此文件' })
      return
    }
    this.overwrite.delete(t.id)
    const tmpFile = join(app.getPath('temp'), `fsx-${t.id}.part`)
    try {
      await srcDriver.download(src, tmpFile, (n) => this.sample(t, n))
      await destDriver.write(dest, createReadStream(tmpFile), (n) => this.sample(t, (stat.size ?? 0) + n))
      // 跨通道移动（项20）：目标写成功后删源文件；删除失败仅告警，不回滚已完成的目标写入
      if (t.moveSource) {
        try { await srcDriver.rmFile(src) }
        catch (err) { logger.warn('upload', `fs 跨通道移动：目标已写入但源删除失败：${src}（${(err as Error).message}）`) }
      }
      t.transferred = t.size
      this.push(t)
    } finally {
      try { rmSync(tmpFile, { force: true }) } catch { /* 临时文件清理失败不影响结果 */ }
    }
    logger.info('upload', `fs 跨通道${t.moveSource ? '移动' : '复制'}完成：${t.profileName}/${src} → ${destChannel.name}/${dest}（${fsFormatSize(stat.size ?? 0)}）`)
  }

  /** 删除队列任务恒为「目录递归删除」（单文件删除在 rm() 内联完成） */
  private async runDelete(t: FsTransferTask, driver: FsDriver): Promise<void> {
    const remotePath = String(t.remotePath ?? '')
    const n = await driver.rmDir(remotePath, (done, total) => this.sample(t, done, total))
    logger.info('upload', `fs 递归删除完成：${remotePath}（${n} 个对象）`)
  }
}

export class FsRuntime {
  private readonly engine: FsTransferEngine

  constructor(private readonly opts: FsRuntimeOptions) {
    this.engine = new FsTransferEngine({
      getDriver: (profileId) => this.resolve(profileId),
      concurrencyOf: (profileId) => {
        const ch = this.channels().find((c) => c.id === profileId)
        return ch?.type === 'cloud' ? 5 : 3
      },
      multipartSettings: () => readMultipartSettings((k) => this.opts.services.config.get(k)),
      onEvent: this.opts.onEvent,
      storeDir: join(app.getPath('userData'), 'fs-transfer'),
    })
    // plans/10 §7：启动恢复持久化任务（一律 paused，不自动续跑）
    this.engine.restore()
  }

  private globalConfig() {
    return normalizeUploadConfig(this.opts.services.config.get('app.upload'))
  }

  private assertProfileId(id: string): string {
    const v = String(id ?? '').trim()
    if (!PROFILE_ID_RE.test(v)) throw new Error(`非法通道 id：${v}`)
    return v
  }

  /** 通道解析：profile + safeStorage 密钥 → 驱动（每次调用重建，改配置即时生效） */
  private resolve(profileIdRaw: string): RuntimeResolved {
    const profileId = this.assertProfileId(profileIdRaw)
    const cfg = this.globalConfig()
    // 本地目录通道（二期，2026-11-17 定版：通道顺序 云→远端→本地）
    if (profileId === 'local') {
      const root = String(cfg.local.defaultDir ?? '').trim()
      if (!root) throw new Error('本地目录未配置：请到「上传管理」设置本地默认目录并保存')
      return {
        driver: new LocalFsDriver(root),
        channel: {
          id: 'local',
          name: '本地目录',
          type: 'local',
          detail: root,
          root: '',
          hasSecret: true,
          writable: true,
        },
      }
    }
    const remote = cfg.remote.profiles.find((p) => p.id === profileId)
    if (remote) {
      const password = this.opts.services.host.getToolSecret(SECRET_TOOL_ID, remote.id)
      return {
        driver: new RemoteFsDriver({
          protocol: remote.protocol,
          host: remote.host,
          port: remote.port,
          username: remote.username,
          password,
          remoteDir: remote.remoteDir,
          passive: remote.passive,
          baseUrl: remote.baseUrl,
        }),
        channel: {
          id: remote.id,
          name: remote.name,
          type: 'remote',
          detail: `${remote.protocol.toUpperCase()} ${remote.host}${remote.port ? `:${remote.port}` : ''}`,
          protocol: remote.protocol,
          root: remote.remoteDir?.replace(/\/+$/, '') ?? '',
          hasSecret: Boolean(password),
          writable: true,
        },
      }
    }
    const cloud = cfg.cloud.profiles.find((p) => p.id === profileId)
    if (cloud) {
      const accessKeySecret = this.opts.services.host.getToolSecret(SECRET_TOOL_ID, cloud.id)
      return {
        driver: new CloudFsDriver({
          provider: cloud.provider,
          sdk: uploadVendorMeta(cloud.provider).sdk,
          region: cloud.region,
          endpoint: cloud.endpoint,
          bucket: cloud.bucket,
          accessKeyId: cloud.accessKeyId,
          accessKeySecret,
          baseUrl: cloud.baseUrl,
        }),
        channel: {
          id: cloud.id,
          name: cloud.name,
          type: 'cloud',
          detail: `${uploadVendorMeta(cloud.provider).label} · ${cloud.bucket}`,
          provider: cloud.provider,
          root: '',
          hasSecret: Boolean(accessKeySecret),
          writable: cloud.provider === 'aliyun-oss' || cloud.provider === 'aws-s3',
        },
      }
    }
    throw new Error('未找到对应上传通道：请先在「上传管理」中添加')
  }

  private assertPath(raw: string): string {
    return normalizeRootRel(raw)
  }

  /** 条目的父目录（内部规范形式） */
  private parentOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i <= 0 ? '/' : path.slice(0, i)
  }

  // ── 只读操作 ──

  async list(req: { profileId: string; path: string; cursor?: string | null }): Promise<FsListPage> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    return await driver.list(path, { cursor: req?.cursor ?? null, pageSize: 500 })
  }

  async stat(req: { profileId: string; path: string }): Promise<FsStatResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') return { exists: true, isDir: true }
    return await driver.stat(path)
  }

  async read(req: { profileId: string; path: string; maxBytes?: number }): Promise<FsReadResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('目录没有可读内容')
    const maxBytes = Math.max(1, Math.floor(Number(req?.maxBytes) || 10 * 1024 * 1024))
    const stat = await driver.stat(path)
    if (!stat.exists) throw new Error('远端文件不存在（可能已被删除）')
    if (stat.isDir) throw new Error('目录没有可读内容')
    if ((stat.size ?? 0) > maxBytes) {
      throw new Error(`文件过大（${fsFormatSize(stat.size)} 超过 ${fsFormatSize(maxBytes)}），请下载后编辑`)
    }
    const { data, size, modified, etag } = await driver.readBuffer(path)
    return { contentBase64: data.toString('base64'), size: size || (stat.size ?? 0), modified, etag }
  }

  // ── 写操作（全部审计落日志） ──

  async mkdir(req: { profileId: string; path: string }): Promise<boolean> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('根目录无需创建')
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    await driver.mkdir(path)
    logger.info('upload', `fs 新建目录：${channel.id}/${path}`)
    return true
  }

  async rm(req: FsRmRequest): Promise<{ taskIds: string[] }> {
    const { driver, channel } = this.resolve(req?.profileId)
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    const taskIds: string[] = []
    const files: string[] = []
    for (const item of (req?.paths ?? []).slice(0, 500)) {
      const path = this.assertPath(item.path)
      if (path === '/') throw new Error('根目录不可删除')
      if (item.kind === 'dir') {
        // 递归删除（高危）入队列：分批 + 进度 + 可取消
        taskIds.push(...this.engine.add([{
          kind: 'delete',
          profileId: channel.id,
          name: fsBasename(path),
          remotePath: path,
        }], (id) => this.resolve(id)))
      } else {
        files.push(path)
      }
    }
    for (const path of files) {
      await driver.rmFile(path)
      logger.info('upload', `fs 删除文件：${channel.id}/${path}`)
    }
    return { taskIds }
  }

  async cp(req: FsCpRequest): Promise<{ taskIds: string[] }> {
    const { driver, channel } = this.resolve(req?.profileId)
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    const destDir = this.assertPath(req?.destDir)
    const taskIds: string[] = []
    const inline: { src: string; dest: string }[] = []
    const CP_DIR_CAP = 1500
    let dirCopies = 0

    /** 云/本地目录：对象存储没有真实目录，driver.cp 只支持单对象 copyObject——必须递归展开成文件逐个复制（项19） */
    const expandDir = async (dirPath: string, destBase: string): Promise<void> => {
      let cursor: string | null = null
      do {
        const page = await driver.list(dirPath, { pageSize: 2000, cursor })
        for (const e of page.entries) {
          if (dirCopies >= CP_DIR_CAP) throw new Error(`目录复制超过 ${CP_DIR_CAP} 个文件上限，已中止`)
          const childDest = destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`
          if (e.kind === 'file') inline.push({ src: e.path, dest: childDest })
          else await expandDir(e.path, childDest)
        }
        cursor = page.nextCursor ?? null
      } while (cursor)
    }

    const cpRenameTo = String(req?.renameTo ?? '').trim()
    if (cpRenameTo && (/[\\/]/.test(cpRenameTo) || cpRenameTo === '.' || cpRenameTo === '..')) {
      throw new Error('新名称不能包含斜杠或为 . / ..')
    }
    for (const item of (req?.sources ?? []).slice(0, 500)) {
      const src = this.assertPath(item.path)
      if (src === '/') throw new Error('根目录不可复制')
      // 同源同目录复制（含重命名）必须给新名，否则覆盖自身；不同目录沿用原文件名
      const dest = cpRenameTo && (destDir === this.parentOf(src))
        ? (destDir === '/' ? `/${cpRenameTo}` : `${destDir}/${cpRenameTo}`)
        : fsDestPath(destDir, src)
      if (!cpRenameTo && (dest === src || dest.startsWith(`${src}/`))) throw new Error('目标目录不能是源条目自身或其子目录，请在弹框中换一个文件名')
      // FTP/SFTP 复制 = 下载+重传（无服务端复制），大文件慢 → 队列化（§二能力矩阵）
      if (channel.type === 'remote') {
        taskIds.push(...this.engine.add([{
          kind: 'copy',
          profileId: channel.id,
          name: fsBasename(src),
          remotePath: src,
          destRemotePath: dest,
        }], (id) => this.resolve(id)))
      } else if (item.kind === 'dir') {
        // 云/本地目录递归展开；云侧还需先建目录 marker 保证空目录可见
        await driver.mkdir(dest)
        await expandDir(src, dest)
        dirCopies++
      } else {
        inline.push({ src, dest })
      }
    }
    for (const { src, dest } of inline) {
      await driver.cp(src, dest)
      logger.info('upload', `fs 复制：${channel.id}/${src} → ${dest}`)
    }
    return { taskIds }
  }

  async mv(req: FsMvRequest): Promise<boolean> {
    const { driver, channel } = this.resolve(req?.profileId)
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    const destDir = this.assertPath(req?.destDir)
    // 重命名：新文件名单独指定（仅单源有意义），目标 = 父目录/新名
    const renameTo = String(req?.renameTo ?? '').trim()
    if (renameTo && (/[\\/]/.test(renameTo) || renameTo === '.' || renameTo === '..')) {
      throw new Error('新名称不能包含斜杠或为 . / ..')
    }
    const MV_DIR_CAP = 1500
    for (const item of (req?.sources ?? []).slice(0, 500)) {
      const src = this.assertPath(item.path)
      if (src === '/') throw new Error('根目录不可移动')
      // 重命名时 dest 用新名（与 src 同父目录）；普通移动沿用原文件名
      const dest = renameTo ? (destDir === '/' ? `/${renameTo}` : `${destDir}/${renameTo}`) : fsDestPath(destDir, src)
      if (!renameTo && (dest === src || dest.startsWith(`${src}/`))) throw new Error('目标目录不能是源条目自身或其子目录')
      if (renameTo && dest === src) return true // 名称未变，无需操作
      if (item.kind === 'dir' && channel.type === 'cloud') {
        // 云目录「移动」= 逐文件 copy+delete（copyObject 不接受目录路径），最后删源 marker（项19）。
        // 用户 2026-11-18：执行前探测删除权限（无权限直接拒绝）；移动记录 (源,目标) 对，
        // 中途失败自动还原已移文件（复制回源 + 删目标副本），做到目录移动的文件级原子化
        await driver.ensureCanDelete('移动目录', src)
        const movedPairs: Array<{ src: string; dest: string }> = []
        let moved = 0
        const moveTree = async (dirPath: string, destBase: string): Promise<void> => {
          let cursor: string | null = null
          do {
            const page = await driver.list(dirPath, { pageSize: 2000, cursor })
            for (const e of page.entries) {
              if (moved >= MV_DIR_CAP) throw new Error(`目录移动超过 ${MV_DIR_CAP} 个文件上限，已中止`)
              if (e.kind === 'file') {
                const destPath = destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`
                await driver.mv(e.path, destPath)
                movedPairs.push({ src: e.path, dest: destPath })
                moved++
              }
              else await moveTree(e.path, destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`)
            }
            cursor = page.nextCursor ?? null
          } while (cursor)
        }
        try {
          await moveTree(src, dest)
          await driver.rmFile(src.endsWith('/') ? src : `${src}/`).catch(() => { /* marker 可能不存在 */ })
        } catch (err) {
          // 精确还原：只动本次移动涉及的目标副本（不碰 dest 既有内容），复制回源位后删除
          let restored = 0
          for (const pair of movedPairs) {
            try { await driver.cp(pair.dest, pair.src); await driver.rmFile(pair.dest); restored++ } catch { /* 还原失败如实报告 */ }
          }
          throw new Error(
            `目录移动未完成：${(err as Error).message}` +
            (restored
              ? `。已自动还原 ${restored}/${movedPairs.length} 个已移文件，源目录保持原样。`
              : '。自动还原未完成，请按提示核对源与目标目录。'),
          )
        }
        logger.info('upload', `fs 云目录移动：${channel.id}/${src} → ${dest}（${moved} 个文件）`)
      } else {
        await driver.mv(src, dest)
        logger.info('upload', `fs 移动：${channel.id}/${src} → ${dest}`)
      }
      // §十一：备注随条目迁移（重命名/移动后原路径备注跟到新路径）
      await this.migrateAnnotations(channel.id, src, dest, item.kind === 'dir' ? 'dir' : 'file')
    }
    return true
  }

  /** §十一：备注迁移——src（或其子路径）上的备注文档 path 更新为 dest 对应新路径 */
  private async migrateAnnotations(profileId: string, src: string, dest: string, kind: 'dir' | 'file'): Promise<void> {
    try {
      const rows = await this.opts.services.repository.list<FsAnnotationDoc>(
        'fsAnnotations', { profileId, archived: false },
      )
      const hit = kind === 'dir'
        ? rows.filter((r) => r.path === src || r.path.startsWith(`${src}/`))
        : rows.filter((r) => r.path === src)
      for (const r of hit) {
        const next = r.path === src ? dest : `${dest}${r.path.slice(src.length)}`
        await this.opts.services.repository.update<FsAnnotationDoc>('fsAnnotations', r._id, { path: next })
      }
    } catch (err) {
      logger.warn('upload', `fs 备注迁移失败（不影响移动结果）：${src} → ${dest}：${(err as Error).message}`)
    }
  }

  /**
   * 跨通道复制（二期）：目录在 main 侧递归展开成文件任务（限 1500 个，超出截断），
   * 每个文件一个 cross 任务（源下载到临时文件 → 写入目标通道），复用传输队列。
   */
  async crossCopy(req: FsCrossCopyRequest): Promise<FsCrossCopyResult> {
    const { driver: srcDriver, channel: srcChannel } = this.resolve(req?.srcProfileId)
    const { driver: destDriver, channel: destChannel } = this.resolve(req?.destProfileId)
    if (srcChannel.id === destChannel.id) throw new Error('源与目标为同一通道：请用同通道复制')
    if (!destDriver.writable) throw new Error(`目标通道「${destChannel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    if (req?.move && !srcDriver.writable) throw new Error(`源通道「${srcChannel.name}」不支持删除，无法跨通道移动（仅复制）`)
    // 跨通道移动 = 复制成功后删源：先探测源通道删除权限，无权限直接拒绝（避免复制完成却删不了源的半程操作）
    if (req?.move) await srcDriver.ensureCanDelete('跨通道移动')
    const destDir = this.assertPath(req?.destDir ?? '')
    const CROSS_TASK_CAP = 1500
    const inputs: FsTransferInput[] = []
    let truncated = false

    const expand = async (path: string, kind: 'dir' | 'file', destBase: string): Promise<void> => {
      if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
      if (kind === 'file') {
        const stat = await srcDriver.stat(path)
        inputs.push({
          kind: 'cross',
          profileId: srcChannel.id,
          destProfileId: destChannel.id,
          name: fsBasename(path),
          remotePath: path,
          // 用户 2026-11-19 定版：只搬运被复制项本身，不搬层级——destBase 逐层由「被复制项名」起算，
          // 复制 /a/b 粘贴到目标根得到 /b（而不是源根的 /a/b 整条链）
          destRemotePath: destBase,
          moveSource: Boolean(req?.move),
          size: stat.size ?? 0,
        })
        return
      }
      const page = await srcDriver.list(path, { pageSize: 2000 })
      for (const e of page.entries) {
        if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
        await expand(e.path, e.kind, destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`)
      }
      if (page.nextCursor) truncated = true
    }

    for (const item of (req?.sources ?? []).slice(0, 200)) {
      const src = this.assertPath(item.path)
      if (src === '/') throw new Error('根目录不可复制')
      if (src === destDir || destDir.startsWith(`${src}/`)) throw new Error('目标目录不能是源条目自身或其子目录')
      // 顶层落点 = 目标目录 / 被复制项名（子内容相对该项展开）
      await expand(src, item.kind === 'dir' ? 'dir' : 'file', fsDestPath(destDir, src))
    }
    if (!inputs.length) return { taskIds: [], files: 0, truncated }
    const taskIds = this.engine.add(inputs, (id) => this.resolve(id))
    logger.info('upload', `fs 跨通道复制入队：${srcChannel.name} → ${destChannel.name}，${inputs.length} 个文件${truncated ? '（已截断）' : ''}`)
    return { taskIds, files: inputs.length, truncated }
  }

  // ── 二期只读扩展：递归搜索 / 目录容量统计 ──

  async search(req: FsSearchRequest, onBatch?: FsSearchBatchFn): Promise<FsSearchResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    const keyword = String(req?.keyword ?? '').trim()
    if (!keyword) return { entries: [], truncated: false }
    return await driver.search(path, keyword, {
      maxResults: 300,
      maxPages: readSearchMaxPages((k) => this.opts.services.config.get(k)),
      onBatch,
    })
  }

  async usage(req: { profileId: string; path: string }): Promise<FsUsageResult> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    const r = await driver.usage(path)
    logger.info('upload', `fs 容量统计：${channel.id}${path === '/' ? '/(根)' : path} → ${fsFormatSize(r.size)} / ${r.files} 个文件${r.truncated ? '（截断）' : ''}`)
    return r
  }

  // ── §十一 扩展（用户 2026-11-18 定版）：chmod / 文本转换 / 压缩解压 / 备注 / 收藏 ──

  /** chmod：本地 / SFTP 驱动实现（FTP/云 UI 置灰，main 再兜底拒绝） */
  async chmod(req: FsChmodRequest): Promise<boolean> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('根目录不支持 chmod')
    if (!driver.chmod) throw new Error(`通道「${channel.name}」不支持 chmod（本地与 SFTP 通道可用）`)
    const modeOctal = String(req?.modeOctal ?? '').trim()
    await driver.chmod(path, modeOctal)
    logger.info('upload', `fs chmod：${channel.id}/${path} → ${modeOctal}`)
    return true
  }

  /** 文本编码 / 换行符转换（转换格式 A，全通道）：读 → 解码 → 转换 → 编码 → 写回 */
  async convertText(req: FsConvertTextRequest): Promise<FsConvertTextResult> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('根目录不是文件')
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作`)
    const stat = await driver.stat(path)
    if (!stat.exists || stat.isDir) throw new Error('文件不存在或为目录')
    if ((stat.size ?? 0) > FS_TEXT_CONVERT_LIMIT) {
      throw new Error(`文件过大（${fsFormatSize(stat.size)} 超过 ${fsFormatSize(FS_TEXT_CONVERT_LIMIT)}），请下载后本地转换`)
    }
    const { data } = await driver.readBuffer(path)
    // 源编码解析：显式指定直接用；auto = BOM → UTF-8 严格校验 → GBK 兜底
    let from = req?.fromEncoding ?? 'auto'
    let body = data
    let hadBom = false
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      hadBom = true
      if (from === 'auto' || from === 'utf-8') { from = 'utf-8'; body = data.subarray(3) }
    }
    if (from === 'auto') {
      const strict = new TextDecoder('utf-8', { fatal: true })
      try { strict.decode(data); from = 'utf-8' }
      catch { from = 'gbk' } // UTF-8 解不开 → 按 GBK（大陆文件最常见的非 UTF-8 编码）
    }
    if (!iconv.encodingExists(from)) throw new Error(`不支持的源编码：${from}`)
    if (!iconv.encodingExists(req?.toEncoding ?? 'utf-8')) throw new Error(`不支持的目标编码：${req?.toEncoding}`)
    let text = iconv.decode(body, from)
    if (from === 'utf-8' && hadBom) text = text.replace(/^\uFEFF/, '')

    // 换行符规范化：先统一到 LF，再按目标形态输出
    let newlineChanged = false
    if (req?.newline !== 'keep') {
      const unified = text.replace(/\r\n/g, '\n')
      const targetText = req?.newline === 'crlf' ? unified.replace(/\n/g, '\r\n') : unified
      newlineChanged = targetText !== text
      text = targetText
    }

    // 目标编码编码：utf-8 且原带 BOM → 保留 BOM
    const encoded = iconv.encode(text, req?.toEncoding ?? 'utf-8')
    const out = req?.toEncoding === 'utf-8' && hadBom
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded])
      : encoded
    const encodingChanged = from !== (req?.toEncoding ?? 'utf-8')
    if (!encodingChanged && !newlineChanged) {
      return { detected: from as FsConvertTextResult['detected'], bytes: data.length, encodingChanged: false, newlineChanged: false }
    }
    await driver.write(path, out)
    logger.info('upload', `fs 文本转换：${channel.id}/${path} ${from} → ${req?.toEncoding}（换行 ${req?.newline}，${fsFormatSize(data.length)}）`)
    return {
      detected: from as FsConvertTextResult['detected'],
      bytes: data.length,
      encodingChanged,
      newlineChanged,
    }
  }

  /** 压缩为 zip（仅本地通道）：sources 递归收集文件 → fflate zipSync → 写回当前目录 */
  async zip(req: FsZipRequest): Promise<FsZipResult> {
    const { driver, channel } = this.resolve(req?.profileId)
    if (channel.type !== 'local') throw new Error('压缩仅支持本地目录通道')
    const zipPath = this.assertPath(req?.zipPath)
    if (!/\.zip$/i.test(zipPath)) throw new Error('压缩包名须以 .zip 结尾')
    const exists = await driver.stat(zipPath)
    if (exists.exists) throw new Error('同名压缩包已存在，请换一个名字')
    const { fileCap, bytesCap } = readZipCaps((k) => this.opts.services.config.get(k))
    const zipData: Record<string, Uint8Array> = {}
    let files = 0
    let bytes = 0

    const addFile = async (rel: string, zipRel: string): Promise<void> => {
      if (files >= fileCap) throw new Error(`超过单次压缩 ${fileCap} 个文件上限，已中止`)
      const { data } = await driver.readBuffer(rel)
      if (bytes + data.length > bytesCap) {
        throw new Error(`超过单次压缩 ${fsFormatSize(bytesCap)} 上限，已中止`)
      }
      zipData[zipRel] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      files++
      bytes += data.length
    }
    const addTree = async (srcRel: string, zipBase: string): Promise<void> => {
      let cursor: string | null = null
      do {
        const page = await driver.list(srcRel, { pageSize: 2000, cursor })
        for (const e of page.entries) {
          if (e.kind === 'file') await addFile(e.path, zipBase ? `${zipBase}/${e.name}` : e.name)
          else await addTree(e.path, zipBase ? `${zipBase}/${e.name}` : e.name)
        }
        cursor = page.nextCursor ?? null
      } while (cursor)
    }
    for (const item of (req?.sources ?? []).slice(0, 200)) {
      const src = this.assertPath(item.path)
      if (src === '/') throw new Error('根目录不可压缩')
      if (item.kind === 'file') await addFile(src, fsBasename(src))
      else await addTree(src, fsBasename(src))
    }
    if (!files) throw new Error('没有可压缩的内容')
    const zipped = zipSync(zipData, { level: 6 })
    await driver.write(zipPath, Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength))
    logger.info('upload', `fs 压缩：${channel.id}/${zipPath}（${files} 个文件 / ${fsFormatSize(zipped.length)}）`)
    return { zipPath, files, size: zipped.length }
  }

  /** 解压 zip（仅本地通道）：解到 zip 同级 `<zip 名去扩展名>/`，防路径穿越 */
  async unzip(req: FsUnzipRequest): Promise<FsUnzipResult> {
    const { driver, channel } = this.resolve(req?.profileId)
    if (channel.type !== 'local') throw new Error('解压仅支持本地目录通道')
    const zipPath = this.assertPath(req?.path)
    if (!isFsZipName(zipPath)) throw new Error('仅支持 .zip 压缩包')
    const stat = await driver.stat(zipPath)
    if (!stat.exists || stat.isDir) throw new Error('压缩包不存在')
    const { fileCap, bytesCap } = readZipCaps((k) => this.opts.services.config.get(k))
    if ((stat.size ?? 0) > bytesCap) throw new Error(`压缩包过大（${fsFormatSize(stat.size)} 超过上限）`)
    const { data } = await driver.readBuffer(zipPath)
    const entries = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    const destDir = zipPath.replace(/\.zip$/i, '')
    let files = 0
    let bytes = 0
    for (const [name, content] of Object.entries(entries)) {
      // 防路径穿越：拒绝绝对路径 / .. 段 / 反斜杠
      if (/^[\\/]/.test(name) || name.includes('..') || name.includes('\\')) {
        throw new Error(`压缩包含非法路径条目：${name}（已中止，未解出任何文件）`)
      }
      if (bytes + content.length > bytesCap) throw new Error(`解压内容超过 ${fsFormatSize(bytesCap)} 上限，已中止`)
      if (files >= fileCap) throw new Error(`解压内容超过 ${fileCap} 个文件上限，已中止`)
      if (name.endsWith('/')) {
        await driver.mkdir(`${destDir}/${name.replace(/\/+$/, '')}`)
        continue
      }
      await driver.write(`${destDir}/${name}`, Buffer.from(content.buffer, content.byteOffset, content.byteLength))
      files++
      bytes += content.length
    }
    logger.info('upload', `fs 解压：${channel.id}/${zipPath} → ${destDir}（${files} 个文件 / ${fsFormatSize(bytes)}）`)
    return { destDir, files }
  }

  /** 目录备注：整通道 path → note 映射（列表加载一次，备注列/属性弹框共用） */
  async annotationList(profileId: string): Promise<Record<string, string>> {
    const pid = this.assertProfileId(profileId)
    const rows = await this.opts.services.repository.list<FsAnnotationDoc>(
      'fsAnnotations', { profileId: pid, archived: false },
    )
    return Object.fromEntries(rows.map((r) => [r.path, r.note]))
  }

  /** 设置备注：空串 = 清除（删文档）；有值 = upsert */
  async annotationSet(req: { profileId: string; path: string; note: string }): Promise<boolean> {
    const pid = this.assertProfileId(req?.profileId)
    const path = this.assertPath(req?.path)
    const note = String(req?.note ?? '').trim().slice(0, 200)
    const repo = this.opts.services.repository
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
  async favoriteList(): Promise<FsFavorite[]> {
    const rows = await this.opts.services.repository.list<FsFavoriteDoc>('fsFavorites', { archived: false })
    const nameOf = new Map(this.channels().map((c) => [c.id, c.name]))
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
  async favoriteAdd(req: { profileId: string; path: string; kind: 'dir' | 'file'; name: string }): Promise<FsFavorite> {
    const pid = this.assertProfileId(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('根目录无需收藏')
    const repo = this.opts.services.repository
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
  async favoriteRemove(id: string): Promise<boolean> {
    await this.opts.services.repository.remove('fsFavorites', String(id ?? ''))
    return true
  }

  async write(req: FsWriteRequest): Promise<boolean> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (path === '/') throw new Error('写入路径不能为空')
    if (!driver.writable) throw new Error(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    // 冲突检测：保存前重新 stat，比对 etag / 大小+时间，不一致提示覆盖（§四）
    if (req?.expect && !req?.force) {
      const stat = await driver.stat(path)
      const etagChanged = Boolean(req.expect.etag) && Boolean(stat.etag) && req.expect.etag !== stat.etag
      const metaChanged = !req.expect.etag && (
        (req.expect.size != null && stat.size != null && req.expect.size !== stat.size) ||
        (req.expect.modified != null && stat.modified != null && req.expect.modified !== stat.modified))
      if (!stat.exists || etagChanged || metaChanged) {
        throw new Error('远端文件已变化：请在覆盖与放弃之间选择（保存时可选择覆盖）')
      }
    }
    const buf = Buffer.from(String(req?.contentBase64 ?? ''), 'base64')
    await driver.write(path, buf)
    logger.info('upload', `fs 写入：${channel.id}/${path}（${fsFormatSize(buf.length)}）`)
    return true
  }

  // ── 传输队列 ──

  async transferStart(inputs: FsTransferInput[]): Promise<{ taskIds: string[] }> {
    const clean = (Array.isArray(inputs) ? inputs : []).filter((i) => i && typeof i === 'object')
    if (!clean.length) return { taskIds: [] }
    const taskIds = this.engine.add(clean, (profileId) => this.resolve(profileId))
    logger.info('upload', `fs 传输任务入队：${clean.length} 个（${taskIds.length}）`)
    return { taskIds }
  }

  transferList(): FsTransferTask[] {
    return this.engine.all()
  }

  /** 单一控制入口（plans/10：取代旧 cancel/retry/clear 三通道） */
  transferControl(req: FsTransferControlRequest): boolean {
    return this.engine.control(req)
  }

  /** 应用退出前同步落盘队列（main/index.ts before-quit 调用） */
  flushTransferPersist(): void {
    this.engine.flushPersist()
  }

  /** 分片设置读取（含各可写云通道遗留 uploadId 数汇总；面板/设置展示用） */
  async transferMultipart(): Promise<FsMultipartStatus> {
    const s = readMultipartSettings((k) => this.opts.services.config.get(k))
    let orphans = 0
    for (const ch of this.channels()) {
      if (ch.type !== 'cloud' || !ch.writable) continue
      try {
        const { driver } = this.resolve(ch.id)
        orphans += (await driver.multipart?.listUploads?.() ?? []).length
      } catch { /* 通道不可用（密钥缺失/网络失败）不计入 */ }
    }
    return { ...s, orphans }
  }

  /** 分片设置修改（main 侧钳制合法区间；实时生效、跨重启记忆） */
  setTransferMultipart(req: Partial<FsMultipartSettings>): FsMultipartSettings {
    const cur = readMultipartSettings((k) => this.opts.services.config.get(k))
    const next: FsMultipartSettings = {
      enabled: req?.enabled === undefined ? cur.enabled : Boolean(req.enabled),
      thresholdMb: req?.thresholdMb == null ? cur.thresholdMb : Math.min(MP_THRESHOLD_MAX, Math.max(MP_THRESHOLD_MIN, Math.floor(Number(req.thresholdMb)) || MP_THRESHOLD_DEFAULT)),
      partSizeMb: req?.partSizeMb == null ? cur.partSizeMb : Math.min(MP_PART_SIZE_MAX, Math.max(MP_PART_SIZE_MIN, Math.floor(Number(req.partSizeMb)) || MP_PART_SIZE_DEFAULT)),
      partsConcurrency: req?.partsConcurrency == null ? cur.partsConcurrency : Math.min(MP_CONCURRENCY_MAX, Math.max(MP_CONCURRENCY_MIN, Math.floor(Number(req.partsConcurrency)) || MP_CONCURRENCY_DEFAULT)),
    }
    this.opts.services.config.set(CFG_MP_ENABLED, next.enabled)
    this.opts.services.config.set(CFG_MP_THRESHOLD_MB, next.thresholdMb)
    this.opts.services.config.set(CFG_MP_PART_SIZE_MB, next.partSizeMb)
    this.opts.services.config.set(CFG_MP_CONCURRENCY, next.partsConcurrency)
    logger.info('upload', `fs 分片设置更新：${next.enabled ? '开' : '关'} / 阈值 ${next.thresholdMb}MB / 片 ${next.partSizeMb}MB / 并发 ${next.partsConcurrency}`)
    return next
  }

  /** 遗留分片手动清理：遍历可写云通道 abort 全部 in-progress uploadId（崩溃遗留；二次确认后调用） */
  async cleanOrphanUploads(): Promise<number> {
    let cleaned = 0
    for (const ch of this.channels()) {
      if (ch.type !== 'cloud' || !ch.writable) continue
      try {
        const { driver } = this.resolve(ch.id)
        const mp = driver.multipart
        if (!mp?.listUploads) continue
        const ups = await mp.listUploads()
        for (const u of ups) {
          try {
            await mp.abort(u.key, u.uploadId)
            cleaned++
          } catch { /* 单个失败不阻断（可能并发中被别的进程清掉） */ }
        }
      } catch { /* 通道不可用跳过 */ }
    }
    logger.info('upload', `fs 遗留分片清理：完成 ${cleaned} 个 uploadId`)
    return cleaned
  }

  // ── 通道元信息 ──

  channels(): FsChannelInfo[] {
    const cfg = this.globalConfig()
    const out: FsChannelInfo[] = []
    /** 组内默认 profile 优先，其余保持原序（2026-11-17 用户定版：云→远端→本地，默认优先） */
    const ordered = <T extends { id: string }>(list: T[], defaultId: string): T[] =>
      defaultId
        ? [...list.filter((p) => p.id === defaultId), ...list.filter((p) => p.id !== defaultId)]
        : list
    for (const p of ordered(cfg.cloud.profiles, cfg.cloud.defaultId)) {
      const hasSecret = Boolean(this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id))
      out.push({
        id: p.id,
        name: p.name,
        type: 'cloud',
        detail: `${uploadVendorMeta(p.provider).label} · ${p.bucket}`,
        provider: p.provider,
        root: '',
        hasSecret,
        writable: p.provider === 'aliyun-oss' || p.provider === 'aws-s3',
        isDefault: cfg.cloud.defaultId === p.id,
      })
    }
    for (const p of ordered(cfg.remote.profiles, cfg.remote.defaultId)) {
      const hasSecret = Boolean(this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id))
      out.push({
        id: p.id,
        name: p.name,
        type: 'remote',
        detail: `${p.protocol.toUpperCase()} ${p.host}${p.port ? `:${p.port}` : ''}`,
        protocol: p.protocol,
        root: p.remoteDir?.replace(/\/+$/, '') ?? '',
        hasSecret,
        writable: true,
        isDefault: cfg.remote.defaultId === p.id,
      })
    }
    const localDir = String(cfg.local.defaultDir ?? '').trim()
    if (localDir) {
      out.push({
        id: 'local',
        name: '本地目录',
        type: 'local',
        detail: localDir,
        root: '',
        hasSecret: true,
        writable: true,
      })
    }
    return out
  }

  /** fs:profiles 响应：通道清单 + EDM 产物目录 */
  profilesPayload(): FsProfilesPayload {
    return { channels: this.channels(), outputRoot: this.opts.services.outputRoot }
  }

  /** EDM 产物目录（「上传到此处」联动用；渲染层据此打开产物目录选择） */
  outputRoot(): string {
    return this.opts.services.outputRoot
  }

  /** 下载落点：app.fs.downloadDir（缺省 userData/downloads/<通道id>） */
  downloadDir(profileId: string): string {
    const custom = String(this.opts.services.config.get('app.fs.downloadDir') ?? '').trim()
    const base = custom || join(app.getPath('userData'), 'downloads')
    const dir = custom ? base : join(base, this.assertProfileId(profileId))
    mkdirSync(dir, { recursive: true })
    return dir
  }

  setDownloadDir(dir: string): string {
    const clean = String(dir ?? '').trim()
    if (!clean) throw new Error('下载目录不能为空')
    mkdirSync(clean, { recursive: true })
    this.opts.services.config.set('app.fs.downloadDir', clean)
    return clean
  }

  /** 压缩/解压上限（可配置；bytes 以 MB 供 UI 展示，内部按字节持久化） */
  zipLimits(): { fileCap: number; bytesCapMb: number } {
    const { fileCap, bytesCap } = readZipCaps((k) => this.opts.services.config.get(k))
    return { fileCap, bytesCapMb: Math.round(bytesCap / (1024 * 1024)) }
  }

  /** 传输文件数上限（上传 / 下载分开；0 = 不限；默认上传 10000、下载 0 不限） */
  transferCaps(): { uploadCap: number; downloadCap: number; searchMaxPages: number } {
    const get = (k: string): unknown => this.opts.services.config.get(k)
    return {
      uploadCap: readUploadCap(get),
      downloadCap: readDownloadCap(get),
      searchMaxPages: readSearchMaxPages(get),
    }
  }

  setTransferCaps(req: { uploadCap?: number; downloadCap?: number; searchMaxPages?: number }): { uploadCap: number; downloadCap: number; searchMaxPages: number } {
    const setCap = (key: string, raw: number | undefined, max: number, label: string): void => {
      if (raw == null) return
      const v = Math.floor(Number(raw))
      if (!Number.isFinite(v) || v < 0) throw new Error(`${label}必须是不小于 0 的整数（0 = 不限）`)
      this.opts.services.config.set(key, Math.min(max, v))
    }
    setCap(CFG_UPLOAD_CAP, req?.uploadCap, FS_TRANSFER_FILE_CAP_MAX, '上传文件数上限')
    setCap(CFG_DOWNLOAD_CAP, req?.downloadCap, FS_TRANSFER_FILE_CAP_MAX, '下载文件数上限')
    setCap(CFG_SEARCH_MAX_PAGES, req?.searchMaxPages, FS_SEARCH_MAX_PAGES_MAX, '搜索扫描页数上限')
    return this.transferCaps()
  }

  setZipLimits(req: { fileCap?: number; bytesCapMb?: number }): { fileCap: number; bytesCapMb: number } {
    const cfg = this.opts.services.config
    if (req?.fileCap != null) {
      const v = Math.floor(Number(req.fileCap))
      if (!Number.isFinite(v)) throw new Error('文件数上限必须是数字')
      cfg.set(CFG_ZIP_FILE_CAP, Math.min(FS_ZIP_FILE_CAP_MAX, Math.max(FS_ZIP_FILE_CAP_MIN, v)))
    }
    if (req?.bytesCapMb != null) {
      const v = Math.floor(Number(req.bytesCapMb))
      if (!Number.isFinite(v)) throw new Error('容量上限必须是数字')
      cfg.set(CFG_ZIP_BYTES_CAP, Math.min(FS_ZIP_BYTES_CAP_MAX, Math.max(FS_ZIP_BYTES_CAP_MIN, v * 1024 * 1024)))
    }
    return this.zipLimits()
  }

  // ── 本地文件选择 / 展平 ──

  async pickUpload(opts?: { type?: 'file' | 'dir' | 'any' }): Promise<string[]> {
    const type = opts?.type === 'dir' ? 'dir' : opts?.type === 'any' ? 'any' : 'file'
    const properties = type === 'dir'
      ? ['openDirectory', 'multiSelections'] as const
      : type === 'any'
        ? ['openFile', 'openDirectory', 'multiSelections'] as const
        : ['openFile', 'multiSelections'] as const
    const dialogOpts = { properties: [...properties] }
    const win = BrowserWindow.getFocusedWindow()
    const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    return result.canceled ? [] : result.filePaths
  }

  /** 递归展平本地待上传路径（保留相对目录结构；上限可配置，默认 10000）
   *  注意：入参是本地绝对路径（系统弹框/拖拽，Windows 下带反斜杠），不能走 root-rel 的 fsBasename */
  flattenLocal(paths: string[]): FsLocalFile[] {
    const out: FsLocalFile[] = []
    const cap = readUploadCap((k) => this.opts.services.config.get(k))
    const full = (): boolean => cap > 0 && out.length >= cap // cap=0 不限
    const walk = (abs: string, rel: string): void => {
      if (full()) return
      let st
      try { st = statSync(abs) } catch { return }
      if (st.isFile()) {
        out.push({ name: rel.split('/').pop() ?? rel, localPath: abs, relPath: rel || localBasename(abs), size: st.size })
        return
      }
      if (!st.isDirectory()) return
      let names: string[] = []
      try { names = readdirSync(abs).sort() } catch { return }
      for (const name of names) {
        if (full()) return
        walk(join(abs, name), rel ? `${rel}/${name}` : name)
      }
    }
    for (const raw of Array.isArray(paths) ? paths.slice(0, 100) : []) {
      const abs = String(raw ?? '')
      if (!abs || !existsSync(abs)) continue
      walk(abs, localBasename(abs))
    }
    return out
  }
}
