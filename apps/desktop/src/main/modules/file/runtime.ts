import { join } from 'node:path'
import { app } from 'electron'
import { AppError } from '@sshk/shared'
import {
  CloudFsDriver,
  LocalFsDriver,
  RemoteFsDriver,
  normalizeRootRel,
} from '@sshk/upload-core'
import {
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
  type FsListPage,
  type FsLocalFile,
  type FsMediaEvent,
  type FsMultipartSettings,
  type FsMultipartStatus,
  type FsMvRequest,
  type FsProfilesPayload,
  type FsReadMediaResult,
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
} from '@sshk/shared'
import type { FsSearchBatchFn } from '@sshk/upload-core'
import { logger } from '../../logger'
import type { AppServices } from '../../services'
import * as archive from './archive'
import * as browser from './browser'
import * as media from './media'
import * as metadata from './metadata'
import { readMultipartSettings } from './metadata'
import { FsTransferEngine, type RuntimeResolved } from './transfer'

/**
 * 文件系统运行时门面（X6 F-4 / plans/08 · P3-3 自 fs.ts 拆分为 modules/file/）：
 * main 进程持有，对已配置上传通道做远端/云文件浏览与管理 + 统一传输队列。
 *
 * - 通道 = 文件管理（原上传管理/上传配置）的 remote/cloud profile；密钥经 safeStorage 注入驱动，渲染层零接触。
 * - 路径安全：所有入参先过 normalizeRootRel（`..` / 反斜杠 / 控制字符拒绝，§六）。
 * - 传输队列：同通道并发限制（远程 3 / 云 5）、失败自动重试 1 次、可取消/手动重试、
 *   冲突（远端已存在同名 / 本地已存在同名）先确认再执行；进度节流推给渲染层（transfer.ts）。
 * - 域拆分：transfer（队列引擎）/browser（浏览读写）/archive（压缩解压）/media（在线播放）/metadata（传输参数+备注收藏）。
 * - IPC 通道名与行为零变化（P3-3 铁律）；FsRuntime 类名与对外行为不变，仅文件组织归位。
 */

const PROFILE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export interface FsRuntimeOptions {
  services: AppServices
  /** 传输任务变化推送（main/ipc/fs.ts 转发给渲染层） */
  onEvent: (task: FsTransferTask) => void
  /** 媒体边下边播进度推送（main/ipc/fs.ts 转发给渲染层播放器） */
  onMediaEvent: (e: FsMediaEvent) => void
}

/** 域模块共享的运行时核心（browser/archive/media/metadata 以此消费解析与引擎能力） */
export interface FsCore {
  readonly services: AppServices
  readonly onEvent: (task: FsTransferTask) => void
  readonly onMediaEvent: (e: FsMediaEvent) => void
  readonly engine: FsTransferEngine
  /** 通道解析：profile + safeStorage 密钥 → 驱动（每次调用重建，改配置即时生效） */
  resolve(profileIdRaw: string): RuntimeResolved
  channels(): FsChannelInfo[]
  assertPath(raw: string): string
  assertProfileId(id: string): string
  /** 条目的父目录（内部规范形式） */
  parentOf(path: string): string
}

export class FsRuntime implements FsCore {
  readonly services: AppServices
  readonly onEvent: (task: FsTransferTask) => void
  readonly onMediaEvent: (e: FsMediaEvent) => void
  readonly engine: FsTransferEngine

  constructor(opts: FsRuntimeOptions) {
    this.services = opts.services
    this.onEvent = opts.onEvent
    this.onMediaEvent = opts.onMediaEvent
    this.engine = new FsTransferEngine({
      getDriver: (profileId) => this.resolve(profileId),
      concurrencyOf: (profileId) => {
        const ch = this.channels().find((c) => c.id === profileId)
        return ch?.type === 'cloud' ? 5 : 3
      },
      multipartSettings: () => readMultipartSettings((k) => this.services.config.get(k)),
      onEvent: this.onEvent,
      storeDir: join(app.getPath('userData'), 'fs-transfer'),
    })
    // plans/10 §7：启动恢复持久化任务（一律 paused，不自动续跑）
    this.engine.restore()
    // 音视频临时播放文件：启动清理 24h 前残留
    media.cleanMediaTemp()
  }

  private globalConfig() {
    return normalizeUploadConfig(this.services.config.get('app.upload'))
  }

  assertProfileId(id: string): string {
    const v = String(id ?? '').trim()
    if (!PROFILE_ID_RE.test(v)) throw new AppError(`非法通道 id：${v}`)
    return v
  }

  /** 通道解析：profile + safeStorage 密钥 → 驱动（每次调用重建，改配置即时生效） */
  resolve(profileIdRaw: string): RuntimeResolved {
    const profileId = this.assertProfileId(profileIdRaw)
    const cfg = this.globalConfig()
    // 本地目录通道（二期，2026-11-17 定版：通道顺序 云→远端→本地）
    if (profileId === 'local') {
      const root = String(cfg.local.defaultDir ?? '').trim()
      if (!root) throw new AppError('本地目录未配置：请到「文件管理」设置本地默认目录并保存', 'io')
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
      const password = this.services.getUploadSecret(remote.id)
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
      const accessKeySecret = this.services.getUploadSecret(cloud.id)
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
          // 传输设置里的超时（秒→毫秒）注入云 SDK，弱网可调大；缺省回落 5 分钟
          requestTimeoutMs: readMultipartSettings((k) => this.services.config.get(k)).requestTimeoutSec * 1000,
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
    throw new AppError('未找到对应上传通道：请先在「文件管理」中添加', 'io')
  }

  assertPath(raw: string): string {
    return normalizeRootRel(raw)
  }

  /** 条目的父目录（内部规范形式） */
  parentOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i <= 0 ? '/' : path.slice(0, i)
  }

  // ── 音视频在线播放 ──

  readMedia(req: { profileId: string; path: string }): Promise<FsReadMediaResult> {
    return media.readMedia(this, req)
  }

  // ── 只读操作与浏览/写操作（browser 域） ──

  list(req: { profileId: string; path: string; cursor?: string | null }): Promise<FsListPage> {
    return browser.list(this, req)
  }

  stat(req: { profileId: string; path: string }): Promise<FsStatResult> {
    return browser.stat(this, req)
  }

  read(req: { profileId: string; path: string; maxBytes?: number }): Promise<FsReadResult> {
    return browser.read(this, req)
  }

  mkdir(req: { profileId: string; path: string }): Promise<boolean> {
    return browser.mkdir(this, req)
  }

  rm(req: FsRmRequest): Promise<{ taskIds: string[] }> {
    return browser.rm(this, req)
  }

  cp(req: FsCpRequest): Promise<{ taskIds: string[] }> {
    return browser.cp(this, req)
  }

  mv(req: FsMvRequest): Promise<boolean> {
    return browser.mv(this, req)
  }

  crossCopy(req: FsCrossCopyRequest): Promise<FsCrossCopyResult> {
    return browser.crossCopy(this, req)
  }

  search(req: FsSearchRequest, onBatch?: FsSearchBatchFn): Promise<FsSearchResult> {
    return browser.search(this, req, onBatch)
  }

  usage(req: { profileId: string; path: string }): Promise<FsUsageResult> {
    return browser.usage(this, req)
  }

  chmod(req: FsChmodRequest): Promise<boolean> {
    return browser.chmod(this, req)
  }

  convertText(req: FsConvertTextRequest): Promise<FsConvertTextResult> {
    return browser.convertText(this, req)
  }

  write(req: FsWriteRequest): Promise<boolean> {
    return browser.write(this, req)
  }

  pickUpload(opts?: { type?: 'file' | 'dir' | 'any' }): Promise<string[]> {
    return browser.pickUpload(opts)
  }

  flattenLocal(paths: string[]): FsLocalFile[] {
    return browser.flattenLocal(this, paths)
  }

  // ── 压缩/解压（archive 域） ──

  zip(req: FsZipRequest): Promise<FsZipResult> {
    return archive.zip(this, req)
  }

  unzip(req: FsUnzipRequest): Promise<FsUnzipResult> {
    return archive.unzip(this, req)
  }

  zipLimits(): { fileCap: number; bytesCapMb: number } {
    return archive.zipLimits(this)
  }

  setZipLimits(req: { fileCap?: number; bytesCapMb?: number }): { fileCap: number; bytesCapMb: number } {
    return archive.setZipLimits(this, req)
  }

  cleanOrphanUploads(): Promise<number> {
    return archive.cleanOrphanUploads(this)
  }

  // ── 元数据（metadata 域：备注/收藏/下载目录/传输参数） ──

  annotationList(profileId: string): Promise<Record<string, string>> {
    return metadata.annotationList(this, profileId)
  }

  annotationSet(req: { profileId: string; path: string; note: string }): Promise<boolean> {
    return metadata.annotationSet(this, req)
  }

  favoriteList(): Promise<FsFavorite[]> {
    return metadata.favoriteList(this)
  }

  favoriteAdd(req: { profileId: string; path: string; kind: 'dir' | 'file'; name: string }): Promise<FsFavorite> {
    return metadata.favoriteAdd(this, req)
  }

  favoriteRemove(id: string): Promise<boolean> {
    return metadata.favoriteRemove(this, id)
  }

  downloadDir(profileId: string): string {
    return metadata.downloadDir(this, profileId)
  }

  setDownloadDir(dir: string): string {
    return metadata.setDownloadDir(this, dir)
  }

  transferMultipart(): Promise<FsMultipartStatus> {
    return metadata.transferMultipart(this)
  }

  setTransferMultipart(req: Partial<FsMultipartSettings>): FsMultipartSettings {
    return metadata.setTransferMultipart(this, req)
  }

  transferCaps(): { uploadCap: number; downloadCap: number; searchMaxPages: number; mediaLimitMb: number; previewDirectLink: boolean } {
    return metadata.transferCaps(this)
  }

  setTransferCaps(req: { uploadCap?: number; downloadCap?: number; searchMaxPages?: number; mediaLimitMb?: number; previewDirectLink?: boolean }): { uploadCap: number; downloadCap: number; searchMaxPages: number; mediaLimitMb: number; previewDirectLink: boolean } {
    return metadata.setTransferCaps(this, req)
  }

  // ── 传输队列（engine 薄委托） ──

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
      const hasSecret = Boolean(this.services.getUploadSecret(p.id))
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
      const hasSecret = Boolean(this.services.getUploadSecret(p.id))
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
    return { channels: this.channels(), outputRoot: this.services.outputRoot }
  }

  /** EDM 产物目录（「上传到此处」联动用；渲染层据此打开产物目录选择） */
  outputRoot(): string {
    return this.services.outputRoot
  }
}
