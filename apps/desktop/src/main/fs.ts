import { createReadStream, existsSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import {
  CloudFsDriver,
  LocalFsDriver,
  RemoteFsDriver,
  fsBasename,
  fsDestPath,
  normalizeRootRel,
} from '@sshk/upload-core'
import type { FsDriver } from '@sshk/upload-core'
import {
  TOOL_IDS,
  fsFormatSize,
  normalizeUploadConfig,
  uploadVendorMeta,
  type FsChannelInfo,
  type FsCrossCopyRequest,
  type FsCrossCopyResult,
  type FsCpRequest,
  type FsLocalFile,
  type FsListPage,
  type FsMvRequest,
  type FsProfilesPayload,
  type FsReadResult,
  type FsRmRequest,
  type FsSearchRequest,
  type FsSearchResult,
  type FsStatResult,
  type FsTransferInput,
  type FsTransferTask,
  type FsUsageResult,
  type FsWriteRequest,
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
/** 本地目录展平的文件数上限 */
const MAX_LOCAL_FILES = 5000
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

/** 传输队列引擎：任务表 + 按通道并发调度 + 进度节流推送 */
class FsTransferEngine {
  private readonly tasks = new Map<string, FsTransferTask>()
  private readonly queued: string[] = []
  private readonly runningByProfile = new Map<string, number>()
  private readonly canceled = new Set<string>()
  private readonly overwrite = new Set<string>()
  /** 速度采样（id → 上次字节/时间），不进任务对象，避免污染推送载荷 */
  private readonly samples = new Map<string, { bytes: number; at: number }>()
  private seq = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: {
    getDriver: (profileId: string) => RuntimeResolved
    /** 同通道并发上限：远程 3 / 云 5 */
    concurrencyOf: (profileId: string) => number
    onEvent: (task: FsTransferTask) => void
  }) {}

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
    this.pump()
    return ids
  }

  cancel(ids: string[]): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t) continue
      if (t.status === 'queued' || t.status === 'conflict') this.setStatus(t, 'canceled')
      else if (t.status === 'running') this.canceled.add(id)
    }
    this.pump()
    return true
  }

  /** 手动重试：失败/取消任务重新入队；overwrite=true 时放行冲突任务（覆盖执行） */
  retry(ids: string[], overwrite = false): boolean {
    for (const id of ids) {
      const t = this.tasks.get(id)
      if (!t) continue
      if (t.status === 'conflict' && overwrite) this.overwrite.add(id)
      if (t.status !== 'running') {
        if (t.status === 'canceled') this.canceled.delete(id)
        this.samples.delete(id)
        this.setStatus(t, 'queued', { transferred: 0, error: undefined, finishedAt: undefined })
        this.queued.push(id)
      }
    }
    this.pump()
    return true
  }

  /** 清掉已完结任务（成功/失败/取消/冲突），进行中的保留 */
  clearFinished(): number {
    let removed = 0
    for (const [id, t] of [...this.tasks.entries()]) {
      if (t.status === 'queued' || t.status === 'running') continue
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
    const finished = status !== 'queued' && status !== 'running'
    Object.assign(t, patch, { status, ...(finished ? { finishedAt: Date.now() } : {}) })
    if (status !== 'running') {
      this.runningByProfile.set(t.profileId, Math.max(0, (this.runningByProfile.get(t.profileId) ?? 1) - 1))
    }
    this.push(t)
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

  /** 进度采样：更新 transferred/speed 并节流推送 */
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
    this.assertNotCanceled(t)
  }

  private async execute(t: FsTransferTask): Promise<void> {
    this.setStatus(t, 'running')
    // 失败自动重试 1 次（取消/冲突除外）
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
        if (msg.startsWith('__fs_canceled__')) {
          this.setStatus(t, 'canceled')
          return
        }
        if (attempt === 0 && !this.canceled.has(t.id)) {
          logger.warn('upload', `fs 传输首次失败，自动重试：${t.name}：${msg}`)
          continue
        }
        this.setStatus(t, 'failed', { error: msg, speed: undefined })
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
      this.setStatus(t, 'conflict', { error: '远端已存在同名文件' })
      return
    }
    this.overwrite.delete(t.id)
    const stream = createReadStream(localPath)
    await driver.write(String(t.remotePath ?? ''), stream, (n) => this.sample(t, n))
    logger.info('upload', `fs 上传完成：${t.remotePath}（${fsFormatSize(st.size)}）`)
  }

  private async runDownload(t: FsTransferTask, driver: FsDriver): Promise<void> {
    const remotePath = String(t.remotePath ?? '')
    const destPath = String(t.destPath ?? '')
    if (!destPath) throw new Error('缺少下载落点')
    const stat = await driver.stat(remotePath)
    if (!stat.exists || stat.isDir) throw new Error('远端文件不存在或为目录')
    t.size = stat.size ?? 0
    if (existsSync(destPath) && !this.overwrite.has(t.id)) {
      this.setStatus(t, 'conflict', { error: '本地已存在同名文件' })
      return
    }
    this.overwrite.delete(t.id)
    await driver.download(remotePath, destPath, (n) => this.sample(t, n))
    logger.info('upload', `fs 下载完成：${remotePath} → ${destPath}（${fsFormatSize(stat.size ?? 0)}）`)
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
      this.setStatus(t, 'conflict', { error: `目标通道已存在同名文件` })
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
      onEvent: this.opts.onEvent,
    })
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

  // ── 只读操作 ──

  async list(req: { profileId: string; path: string; cursor?: string | null }): Promise<FsListPage> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    return await driver.list(path, { cursor: req?.cursor ?? null, pageSize: 500 })
  }

  async stat(req: { profileId: string; path: string }): Promise<FsStatResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (!path) return { exists: true, isDir: true }
    return await driver.stat(path)
  }

  async read(req: { profileId: string; path: string; maxBytes?: number }): Promise<FsReadResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (!path) throw new Error('目录没有可读内容')
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
    if (!path) throw new Error('根目录无需创建')
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
      if (!path) throw new Error('根目录不可删除')
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
          const childDest = `${destBase}/${e.name}`
          if (e.kind === 'file') inline.push({ src: e.path, dest: childDest })
          else await expandDir(e.path, childDest)
        }
        cursor = page.nextCursor ?? null
      } while (cursor)
    }

    for (const item of (req?.sources ?? []).slice(0, 500)) {
      const src = this.assertPath(item.path)
      if (!src) throw new Error('根目录不可复制')
      const dest = fsDestPath(destDir, src)
      if (dest === src || dest.startsWith(`${src}/`)) throw new Error('目标目录不能是源条目自身或其子目录')
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
      if (!src) throw new Error('根目录不可移动')
      // 重命名时 dest 用新名（与 src 同父目录）；普通移动沿用原文件名
      const dest = renameTo ? (destDir ? `${destDir}/${renameTo}` : renameTo) : fsDestPath(destDir, src)
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
                const destPath = `${destBase}/${e.name}`
                await driver.mv(e.path, destPath)
                movedPairs.push({ src: e.path, dest: destPath })
                moved++
              }
              else await moveTree(e.path, `${destBase}/${e.name}`)
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
    }
    return true
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

    const expand = async (path: string, kind: 'dir' | 'file'): Promise<void> => {
      if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
      if (kind === 'file') {
        const stat = await srcDriver.stat(path)
        inputs.push({
          kind: 'cross',
          profileId: srcChannel.id,
          destProfileId: destChannel.id,
          name: fsBasename(path),
          remotePath: path,
          // path 由驱动逐级 fsJoin 生成（已规范化），直接拼目标目录即可
          destRemotePath: destDir ? `${destDir}/${path}` : path,
          moveSource: Boolean(req?.move),
          size: stat.size ?? 0,
        })
        return
      }
      const page = await srcDriver.list(path, { pageSize: 2000 })
      for (const e of page.entries) {
        if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
        await expand(e.path, e.kind)
      }
      if (page.nextCursor) truncated = true
    }

    for (const item of (req?.sources ?? []).slice(0, 200)) {
      const src = this.assertPath(item.path)
      if (!src) throw new Error('根目录不可复制')
      if (src === destDir || destDir.startsWith(`${src}/`)) throw new Error('目标目录不能是源条目自身或其子目录')
      await expand(src, item.kind === 'dir' ? 'dir' : 'file')
    }
    if (!inputs.length) return { taskIds: [], files: 0, truncated }
    const taskIds = this.engine.add(inputs, (id) => this.resolve(id))
    logger.info('upload', `fs 跨通道复制入队：${srcChannel.name} → ${destChannel.name}，${inputs.length} 个文件${truncated ? '（已截断）' : ''}`)
    return { taskIds, files: inputs.length, truncated }
  }

  // ── 二期只读扩展：递归搜索 / 目录容量统计 ──

  async search(req: FsSearchRequest): Promise<FsSearchResult> {
    const { driver } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    const keyword = String(req?.keyword ?? '').trim()
    if (!keyword) return { entries: [], truncated: false }
    return await driver.search(path, keyword, { maxResults: 300 })
  }

  async usage(req: { profileId: string; path: string }): Promise<FsUsageResult> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    const r = await driver.usage(path)
    logger.info('upload', `fs 容量统计：${channel.id}/${path || '(根)'} → ${fsFormatSize(r.size)} / ${r.files} 个文件${r.truncated ? '（截断）' : ''}`)
    return r
  }

  async write(req: FsWriteRequest): Promise<boolean> {
    const { driver, channel } = this.resolve(req?.profileId)
    const path = this.assertPath(req?.path)
    if (!path) throw new Error('写入路径不能为空')
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

  transferCancel(ids: string[]): boolean {
    return this.engine.cancel(Array.isArray(ids) ? ids : [])
  }

  transferRetry(ids: string[], overwrite = false): boolean {
    return this.engine.retry(Array.isArray(ids) ? ids : [], Boolean(overwrite))
  }

  transferClear(): { removed: number } {
    return { removed: this.engine.clearFinished() }
  }

  /** 下载任务重试时允许覆盖本地同名文件 */
  async transferRetryOverwrite(ids: string[]): Promise<boolean> {
    return this.engine.retry(Array.isArray(ids) ? ids : [], true)
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

  /** 递归展平本地待上传路径（保留相对目录结构；上限 5000 个文件） */
  flattenLocal(paths: string[]): FsLocalFile[] {
    const out: FsLocalFile[] = []
    const walk = (abs: string, rel: string): void => {
      if (out.length >= MAX_LOCAL_FILES) return
      let st
      try { st = statSync(abs) } catch { return }
      if (st.isFile()) {
        out.push({ name: rel.split('/').pop() ?? rel, localPath: abs, relPath: rel || fsBasename(abs), size: st.size })
        return
      }
      if (!st.isDirectory()) return
      let names: string[] = []
      try { names = readdirSync(abs).sort() } catch { return }
      for (const name of names) {
        if (out.length >= MAX_LOCAL_FILES) return
        walk(join(abs, name), rel ? `${rel}/${name}` : name)
      }
    }
    for (const raw of Array.isArray(paths) ? paths.slice(0, 100) : []) {
      const abs = String(raw ?? '')
      if (!abs || !existsSync(abs)) continue
      walk(abs, fsBasename(abs))
    }
    return out
  }
}
