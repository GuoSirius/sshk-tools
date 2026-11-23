import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  AppError,
  fsFormatSize,
  fsMissingChunks,
  fsMultipartPlan,
  fsTransferCanPersist,
  fsTransferEffectivelyDone,
  type FsChannelInfo,
  type FsMultipartSettings,
  type FsTransferControlRequest,
  type FsTransferInput,
  type FsTransferTask,
} from '@sshk/shared'
import type { FsDriver } from '@sshk/upload-core'
import { logger } from '../../logger'

/**
 * 统一传输队列（plans/10 · P3-3 自 fs.ts 拆出）：
 * 任务表 + 按通道并发调度 + 进度节流推送 + 协作式暂停 + 分片/续传（multipart/检查点/内存闸门）+ 持久化。
 * export 仅供状态机单测（fs-engine.test.ts）注入 mock driver 构造 conflict/pause/cancel 矩阵；生产入口仍是 FsRuntime。
 */

/** 传输队列任务总量上限：防止异常入参把队列撑爆 */
const MAX_TASKS = 2000
const MB = 1024 * 1024
/** 内存闸门：同时开片跑分片的任务数上限（总并发 = 通道并发 × 分片并发，由该闸门兜底） */
const MP_TASK_GATE = 2

/** 通道解析结果（profile + safeStorage 密钥 → 驱动），引擎与门面共用 */
export interface RuntimeResolved {
  driver: FsDriver
  channel: FsChannelInfo
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

export class FsTransferEngine {
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
      // 实质完成（100% 窗口期状态尚未落 success）不落盘，避免重启恢复成"已暂停 100%"
      if (fsTransferEffectivelyDone(t.transferred, t.size)) continue
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

  /** 启动恢复：读回持久化任务，一律置 paused（不自动续跑），resumable 按检查点文件判定。
   *  实质完成（transferred>=size）的历史任务不恢复——已完成只在启动周期内可见，重启清空；
   *  同时把这些残留从 queue.json 抹掉，避免每次启动都读回一条"已暂停 100%"。 */
  restore(): number {
    const rows = this.store.load()
    let restored = 0
    let dropped = 0
    for (const r of rows) {
      if (this.tasks.has(r.id)) continue
      if (fsTransferEffectivelyDone(r.transferred, r.size)) { dropped++; continue }
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
      restored++
    }
    if (dropped) {
      // 抹掉已完成的残留，避免重启反复读到（写回时 persistable 已过滤它们）
      this.store.save(this.persistable())
      logger.info('upload', `fs 传输队列清理：${dropped} 个已完成任务残留已从队列移除`)
    }
    if (restored) logger.info('upload', `fs 传输队列恢复：${restored} 个任务置为暂停（不自动续跑）`)
    return restored
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
      /** 清除全部（用户 2026-11-19，二次确认在渲染层）：先全部停止，再移除所有非运行中任务；
       *  running 任务会在引擎边界终止（stopAll 已置取消），届时再点一次即可清掉 */
      case 'clearAll': {
        this.stopAll()
        this.remove([...this.tasks.keys()])
        this.schedulePersist()
        return true
      }
      default: throw new AppError(`未知传输控制动作：${String(req?.action)}`)
    }
  }

  all(): FsTransferTask[] {
    return [...this.tasks.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  }

  add(inputs: FsTransferInput[], resolve: (profileId: string) => RuntimeResolved): string[] {
    const ids: string[] = []
    // F-07（2026-11-22 复核）：总量上限 = 现存任务 + 本次入队，超出拒绝并告警——
    // 此前只对单次入参 slice(0, MAX_TASKS)，多次 add 可无限增长撑爆队列
    const capacity = Math.max(0, MAX_TASKS - this.tasks.size)
    const accepted = inputs.slice(0, capacity)
    if (accepted.length < inputs.length) {
      logger.warn('upload', `传输队列已达上限 ${MAX_TASKS}，本次拒绝 ${inputs.length - accepted.length} 个任务`)
    }
    for (const input of accepted) {
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
    // F-08（2026-11-22 复核）：主动唤醒分片闸门等待者，让已暂停/取消的等待任务立即让位，
    // 不必等其他持槽任务跑到检查点才惰性醒来
    this.flushMultipartWaiters()
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
    // F-08：同 pause——等待者里的取消任务立即让位
    this.flushMultipartWaiters()
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
      // F-06（2026-11-22 复核）：移除即清理续传产物（服务端 uploadId / 本地检查点 / 下载临时文件），
      // 此前只删内存态，paused 可续传任务移除后产物永久遗留
      void this.cleanupResumeArtifacts(id)
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
      // F-06：完结任务（failed/canceled 可能残留检查点/临时文件）一并清理续传产物
      void this.cleanupResumeArtifacts(id)
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
    if (this.canceled.delete(t.id)) throw new AppError(`__fs_canceled__:${t.id}`)
  }

  /** 协作检查点（暂停优先于取消：先暂停后取消，plans/10 §4） */
  private assertNotPaused(t: FsTransferTask): void {
    if (this.pauseRequestedIds.delete(t.id)) throw new AppError(`__fs_paused__:${t.id}`)
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
        if (msg.startsWith(`__fs_conflict__:${t.id}:`)) {
          // P1-1（A1/Q-01 方案A）：冲突走信号抛出——runXxx 内直接 setStatus 会被
          // execute 成功路径的无条件 setStatus('success') 覆盖（事故：conflict 秒变 success）
          this.setStatus(t, 'conflict', { error: msg.slice(`__fs_conflict__:${t.id}:`.length), speed: undefined, pausing: undefined })
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
    if (!localPath || !existsSync(localPath)) throw new AppError(`本地文件不存在：${localPath}`, 'io')
    const st = statSync(localPath)
    if (!st.isFile()) throw new AppError('只能上传文件（目录请先展平）', 'io')
    t.size = st.size
    // 冲突：远端已有同名文件 → 挂起等确认
    const stat = await driver.stat(String(t.remotePath ?? ''))
    if (stat.exists && !stat.isDir && !this.overwrite.has(t.id)) {
      throw new AppError(`__fs_conflict__:${t.id}:目标目录已有同名文件：任务已暂停、尚未上传。点「覆盖」=覆盖远端同名文件继续上传；点「停止」=跳过此文件`)
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

  /** 唤醒全部分片闸门等待者——被唤醒者各自重查闸门/暂停/取消状态，抢不到的重新入队。
   *  原实现只 shift 一个：若被唤醒者已暂停/取消（静默让位不占槽），这次唤醒被浪费，
   *  队首之后的 waiter 全部滞留（有空槽却无人前进）（CR-39 P1-4） */
  private flushMultipartWaiters(): void {
    const waiters = [...this.multipartWaiters]
    this.multipartWaiters.length = 0
    for (const w of waiters) w()
  }

  private releaseMultipartSlot(t: FsTransferTask): void {
    if (this.multipartGate.delete(t.id)) this.flushMultipartWaiters()
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
      // CR-39（P1-4）：暂停/取消落在两次采样之间的静默 return 路径——收尾时补一次终判，
      // 否则「分片不完整」把本应 paused/canceled 的任务错记为 failed
      if (this.pauseRequestedIds.has(t.id)) {
        this.pauseRequestedIds.delete(t.id)
        throw new AppError(`__fs_paused__:${t.id}`)
      }
      if (this.canceled.has(t.id)) {
        this.canceled.delete(t.id)
        await this.cleanupResumeArtifacts(t.id)
        throw new AppError(`__fs_canceled__:${t.id}`)
      }
      if (failures.length) throw failures[0]!
      if (done.size !== total) throw new AppError(`分片不完整（${done.size}/${total}），任务中止（检查点已保留，可重试续传）`)
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
    if (!destPath) throw new AppError('缺少下载落点')
    const stat = await driver.stat(remotePath)
    if (!stat.exists || stat.isDir) throw new AppError('远端文件不存在或为目录', 'io')
    t.size = stat.size ?? 0
    if (existsSync(destPath) && !this.overwrite.has(t.id)) {
      throw new AppError(`__fs_conflict__:${t.id}:本地已有同名文件：任务已暂停、尚未写入。点「覆盖」=覆盖本地文件；点「停止」=跳过此文件`)
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
    // 打开临时文件：不存在则建(w+)、存在则读写续传(r+)，长度钳到目标大小（完成前绝不碰正式目标）。
    // ⚠️ 禁用 'a+'（append）：① Windows 上 append 句柄 truncate 报 EPERM（实测复现，大下载必失败）；
    // ② append 模式忽略 write 的 position 参数，分片会追加到末尾而非写入 chunk.start，断点续传整体失效。
    mkdirSync(dirname(destPath), { recursive: true })
    let fh: fsPromises.FileHandle
    try {
      fh = await fsPromises.open(tmp, 'r+')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      fh = await fsPromises.open(tmp, 'w+')
    }
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
      if (st1.size !== fp.size) throw new AppError(`下载校验失败：本地 ${st1.size} 字节 ≠ 远端 ${fp.size} 字节`)
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
    if (!src || !dest) throw new AppError('复制任务缺少源/目标路径', 'io')
    const stat = await driver.stat(src)
    if (!stat.exists) throw new AppError('远端源文件不存在', 'io')
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
    if (!src || !dest || !destProfileId) throw new AppError('跨通道复制缺少源/目标信息')
    const { driver: destDriver, channel: destChannel } = this.opts.getDriver(destProfileId)
    if (!destDriver.writable) throw new AppError(`目标通道「${destChannel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
    const stat = await srcDriver.stat(src)
    if (!stat.exists || stat.isDir) throw new AppError('源文件不存在或为目录', 'io')
    t.size = stat.size ?? 0
    // 冲突：目标通道已有同名文件 → 挂起等确认
    const destStat = await destDriver.stat(dest)
    if (destStat.exists && !destStat.isDir && !this.overwrite.has(t.id)) {
      throw new AppError(`__fs_conflict__:${t.id}:目标通道已有同名文件：任务已暂停、尚未复制。点「覆盖」=覆盖目标同名文件；点「停止」=跳过此文件`)
    }
    this.overwrite.delete(t.id)
    const tmpFile = join(app.getPath('temp'), `fsx-${t.id}.part`)
    // F-04（2026-11-22 复核）：两阶段按 50/50 归一化进度——此前 download sample(n) + write
    // sample(size+n) 双计，进度先冲 200% 再跳回 100%，speed 采样同步放大
    const size = stat.size ?? 0
    try {
      await srcDriver.download(src, tmpFile, (n) => this.sample(t, Math.min(size, n / 2)))
      await destDriver.write(dest, createReadStream(tmpFile), (n) => this.sample(t, Math.min(size, size / 2 + n / 2)))
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
