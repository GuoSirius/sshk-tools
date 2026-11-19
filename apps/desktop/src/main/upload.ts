import path from 'node:path'
import {
  UploadService,
  LocalUploadProvider,
  RemoteUploadProvider,
  CloudUploadProvider,
} from '@sshk/upload-core'
import type {
  UploadedImagePage,
  UploadContext,
  UploadFile,
  UploadOverrides,
  UploadProgress,
  UploadResult,
  UploadTargetType,
  UploadValidation,
} from '@sshk/upload-core'
import {
  TOOL_IDS,
  listUploadProfiles,
  normalizeUploadConfig,
  pickCloudProfile,
  pickRemoteProfile,
  resolveUploadTool,
  uploadVendorMeta,
  type UploadGlobalConfig,
  type UploadProfileOption,
  type FileKind,
  normalizeFileKind,
} from '@sshk/shared'
import type { AppServices } from './services'

/**
 * R26 应用级上传运行时（宿主 main 进程持有，工具经 IPC 只传文件与工具级覆盖项）。
 *
 * - 全局 profile 连接信息从 `app.upload` 读；密钥默认只留在 safeStorage；
 *   仅当用户主动点「查看」时才按 id 下发（复用 llm:getApiKey 范式）。
 * - 每次调用重建 Service/Provider（成本极低），保证改配置后无需重启即生效。
 * - 校验：全局默认传给 Service，工具级 ctx.validation 由 mergeValidation 收紧（不能放宽）。
 */
const SECRET_TOOL_ID = TOOL_IDS.fileManager // 文件管理（2026-11-19 由 upload-manager 改名；密钥启动时自动迁移）
const DATA_URL_RE = /^data:[^;,]*;base64,([\s\S]+)$/
const PROFILE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export interface UploadRequest {
  /** 工具 id；用于读取 tools.<id>.upload 的覆盖项，省略则只用全局配置 */
  toolId?: string
  name: string
  size: number
  mime?: string
  /** 本地绝对路径（来自 os.pickFile） */
  source?: string
  /** data URL（来自 <input type=file> / 富文本 File） */
  dataUrl?: string
  /** 请求级覆盖：富文本「图片库」等场景显式指定来源；缺省回落工具级配置 */
  targetType?: UploadTargetType
  profileId?: string
  overrides?: UploadOverrides
}

/** 图库/文件库列取请求：只读，不需要文件内容 */
export interface UploadListRequest {
  toolId?: string
  targetType?: UploadTargetType
  profileId?: string
  overrides?: UploadOverrides
  limit?: number
  /** 列取翻页游标：传上次返回的 nextCursor 续拉 */
  cursor?: string
  /** 内容类别：image 只列图片（历史默认）、document 文档、code 代码、all 列全部文件；历史值 'file' 归一为 all */
  kind?: FileKind
}

/** 列图/列文件：历史值 'file' 兼容归一为 'all'，其余交由 Service/Provider 缺省（image）兜底 */
function normalizeListKind(kind: FileKind | string | undefined): FileKind | undefined {
  return normalizeFileKind(kind)
}

export interface UploadTestRequest {
  type: 'remote' | 'cloud'
  /** 配置页当前表单值（可能尚未保存）；复用 normalizeUploadConfig 做容错清洗 */
  profile: Record<string, unknown>
  /** 表单里临时填的密钥，只用于本次探测，不落盘、不进配置 */
  secret?: string
}

export interface UploadRuntimeOptions {
  services: AppServices
  onProgress: (p: UploadProgress) => void
}

interface Prepared {
  service: UploadService
  ctx: UploadContext
  file: UploadFile
}

function toUploadFile(req: UploadRequest): UploadFile {
  const name = path.basename(String(req?.name ?? '')).trim()
  if (!name) throw new Error('上传文件名不能为空')
  const file: UploadFile = { name, size: Number(req.size) || 0, mime: req.mime }
  if (req.source) file.source = String(req.source)
  const matched = req.dataUrl ? DATA_URL_RE.exec(String(req.dataUrl)) : null
  if (matched) file.data = Buffer.from(matched[1] ?? '', 'base64')
  if (!file.source && !file.data) throw new Error(`上传请求缺少文件内容：${name}`)
  if (file.size === 0 && file.data) file.size = file.data.byteLength
  return file
}

export class UploadRuntime {
  constructor(private readonly opts: UploadRuntimeOptions) {}

  private globalConfig(): UploadGlobalConfig {
    return normalizeUploadConfig(this.opts.services.config.get('app.upload'))
  }

  private prepare(req: UploadRequest, global: UploadGlobalConfig): Prepared {
    const services = this.opts.services
    const toolId = String(req.toolId ?? '').trim()
    const tool = resolveUploadTool(toolId ? services.config.get(`tools.${toolId}.upload`) : undefined)

    // 请求级显式指定（富文本图片库选了某个远程/云 profile）优先，其次工具级配置
    const reqTarget = req.targetType
    const targetType: UploadTargetType =
      reqTarget === 'local' || reqTarget === 'remote' || reqTarget === 'cloud' ? reqTarget : tool.targetType
    const profileId = req.profileId || tool.profileId
    const ov = req.overrides ?? {}
    const overrides: UploadOverrides = {
      localDir: ov.localDir || tool.overrides.localDir || undefined,
      remotePath: ov.remotePath || tool.overrides.remotePath || undefined,
      bucket: ov.bucket || tool.overrides.bucket || undefined,
      prefix: ov.prefix || tool.overrides.prefix || undefined,
    }

    const ctx: UploadContext = {
      targetType,
      profileId: profileId || undefined,
      overrides,
      validation: tool.validation,
    }
    const globalValidation: UploadValidation = {
      accept: global.validation.accept,
      maxSize: global.validation.maxSize,
    }
    const service = new UploadService({
      validation: globalValidation,
      onProgress: this.opts.onProgress,
    })
    service.register(new LocalUploadProvider({ defaultDir: global.local.defaultDir }))

    if (ctx.targetType === 'remote') {
      const p = pickRemoteProfile(global, ctx.profileId)
      if (!p) throw new Error('未找到远程上传 profile：请先在「文件管理」中添加并选择')
      const password = services.host.getToolSecret(SECRET_TOOL_ID, p.id)
      service.register(new RemoteUploadProvider({
        protocol: p.protocol,
        host: p.host,
        port: p.port,
        username: p.username,
        password,
        remoteDir: p.remoteDir,
        passive: p.passive,
        baseUrl: p.baseUrl,
      }))
      ctx.profileId = p.id
    }
    if (ctx.targetType === 'cloud') {
      const p = pickCloudProfile(global, ctx.profileId)
      if (!p) throw new Error('未找到云上传 profile：请先在「文件管理」中添加并选择')
      const accessKeySecret = services.host.getToolSecret(SECRET_TOOL_ID, p.id)
      service.register(new CloudUploadProvider({
        provider: p.provider,
        sdk: uploadVendorMeta(p.provider).sdk,
        region: p.region,
        endpoint: p.endpoint,
        bucket: p.bucket,
        accessKeyId: p.accessKeyId,
        accessKeySecret,
        baseUrl: p.baseUrl,
      }))
      ctx.profileId = p.id
    }

    return { service, ctx, file: toUploadFile(req) }
  }

  single(req: UploadRequest): Promise<UploadResult> {
    const { service, ctx, file } = this.prepare(req, this.globalConfig())
    return service.upload(file, ctx)
  }

  /** 只读场景（列表/列目录）共用的 service + ctx 组装，避免两处重复且保证口径一致 */
  private readonlyList(req: UploadListRequest): { service: UploadService; ctx: UploadContext } {
    const global = this.globalConfig()
    const toolId = String(req?.toolId ?? '').trim()
    const tool = resolveUploadTool(toolId ? this.opts.services.config.get(`tools.${toolId}.upload`) : undefined)
    const reqTarget = req?.targetType
    const targetType: UploadTargetType =
      reqTarget === 'local' || reqTarget === 'remote' || reqTarget === 'cloud' ? reqTarget : tool.targetType
    const ov = req?.overrides ?? {}
    const ctx: UploadContext = {
      targetType,
      profileId: req?.profileId || tool.profileId || undefined,
      overrides: {
        localDir: ov.localDir || tool.overrides.localDir || undefined,
        remotePath: ov.remotePath || tool.overrides.remotePath || undefined,
        bucket: ov.bucket || tool.overrides.bucket || undefined,
        prefix: ov.prefix || tool.overrides.prefix || undefined,
      },
    }
    const service = new UploadService({})
    service.register(new LocalUploadProvider({ defaultDir: global.local.defaultDir }))
    if (ctx.targetType === 'remote') {
      const p = pickRemoteProfile(global, ctx.profileId)
      if (!p) throw new Error('未找到远程上传 profile：请先在「文件管理」中添加并选择')
      service.register(new RemoteUploadProvider({
        protocol: p.protocol,
        host: p.host,
        port: p.port,
        username: p.username,
        password: this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id),
        remoteDir: p.remoteDir,
        passive: p.passive,
        baseUrl: p.baseUrl,
      }))
      ctx.profileId = p.id
    }
    if (ctx.targetType === 'cloud') {
      const p = pickCloudProfile(global, ctx.profileId)
      if (!p) throw new Error('未找到云上传 profile：请先在「文件管理」中添加并选择')
      service.register(new CloudUploadProvider({
        provider: p.provider,
        sdk: uploadVendorMeta(p.provider).sdk,
        region: p.region,
        endpoint: p.endpoint,
        bucket: p.bucket,
        accessKeyId: p.accessKeyId,
        accessKeySecret: this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id),
        baseUrl: p.baseUrl,
      }))
      ctx.profileId = p.id
    }
    return { service, ctx }
  }

  /** 图库/文件库：按请求级来源列出已有文件（只读，不需要文件）；返回分页与游标供大目录续拉 */
  async listImages(req: UploadListRequest): Promise<UploadedImagePage> {
    const { service, ctx } = this.readonlyList(req)
    return service.listImages({ ...ctx, limit: req?.limit, cursor: req?.cursor, kind: normalizeListKind(req?.kind) })
  }

  /** 图库/文件库：按来源列出真实目录（只读）；失败原样抛出，由前端降级并提示原因 */
  async listDirectories(req: UploadListRequest): Promise<string[]> {
    const { service, ctx } = this.readonlyList(req)
    return service.listDirectories(ctx)
  }

  /** 批量共用第一个请求解析出的工具级配置（同一批文件应属同一工具） */
  batch(reqs: UploadRequest[]): Promise<UploadResult[]> {
    const head: UploadRequest | undefined = Array.isArray(reqs) ? reqs[0] : undefined
    if (!head) return Promise.resolve([])
    const first = this.prepare(head, this.globalConfig())
    const files = [first.file, ...reqs.slice(1).map((r) => toUploadFile(r))]
    return first.service.uploadBatch(files, first.ctx)
  }

  getConfig(): UploadGlobalConfig {
    return this.globalConfig()
  }

  setConfig(raw: unknown): UploadGlobalConfig {
    const normalized = normalizeUploadConfig(raw)
    this.opts.services.config.set('app.upload', normalized)
    return normalized
  }

  profiles(type?: 'remote' | 'cloud'): UploadProfileOption[] {
    return listUploadProfiles(this.globalConfig(), type)
  }

  /** 密钥只写入 safeStorage；空串表示清除 */
  setSecret(profileId: string, value: string): boolean {
    const id = String(profileId ?? '').trim()
    if (!PROFILE_ID_RE.test(id)) throw new Error(`非法上传 profile ID：${id}`)
    this.opts.services.host.setToolSecret(SECRET_TOOL_ID, id, String(value ?? ''))
    return true
  }

  /** 列表只回「是否已配置」，绝不回明文 */
  secretState(): Record<string, boolean> {
    const cfg = this.globalConfig()
    const state: Record<string, boolean> = {}
    for (const p of [...cfg.remote.profiles, ...cfg.cloud.profiles]) {
      state[p.id] = Boolean(this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id))
    }
    return state
  }

  /** N3：用户主动点「查看」时才按 id 回传明文（复用 llm:getApiKey 范式），不随列表下发 */
  getSecret(profileId: string): string {
    const id = String(profileId ?? '').trim()
    if (!PROFILE_ID_RE.test(id)) throw new Error(`非法上传 profile ID：${id}`)
    return this.opts.services.host.getToolSecret(SECRET_TOOL_ID, id)
  }

  /**
   * N4 / N11：每个 remote / cloud profile 独立测试；密钥可用表单临时值，不落盘。
   * 一律返回结构化结果，绝不 reject —— 校验不通过 / 连不上是**预期内用户输入结果**，
   * 若抛给 ipcMain.handle，Electron 会往主进程终端打印
   * "Error occurred in handler for 'upload:test'" 堆栈，污染控制台。
   */
  async test(req: UploadTestRequest): Promise<{ ok: boolean; message: string }> {
    try {
      return { ok: true, message: await this.probe(req) }
    } catch (err) {
      return { ok: false, message: (err as Error).message || String(err) }
    }
  }

  private async probe(req: UploadTestRequest): Promise<string> {
    const type = req?.type === 'cloud' ? 'cloud' : 'remote'
    const raw: unknown = req?.profile
    const obj = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const id = String(obj['id'] ?? '').trim()
    const secret = typeof req?.secret === 'string' && req.secret
      ? req.secret
      : (id ? this.opts.services.host.getToolSecret(SECRET_TOOL_ID, id) : '')
    // 复用归一化，既校验必填项，也把厂商 / 字段收敛到合法值
    const cfg = normalizeUploadConfig({
      remote: { profiles: type === 'remote' ? [obj] : [], defaultId: id },
      cloud: { profiles: type === 'cloud' ? [obj] : [], defaultId: id },
    })
    if (type === 'remote') {
      const p = pickRemoteProfile(cfg, id)
      if (!p) throw new Error('远程配置不完整：名称 / ID / 主机不能为空')
      return await new RemoteUploadProvider({
        protocol: p.protocol, host: p.host, port: p.port, username: p.username,
        password: secret, remoteDir: p.remoteDir, passive: p.passive, baseUrl: p.baseUrl,
      }).testConnection()
    }
    const p = pickCloudProfile(cfg, id)
    if (!p) throw new Error('云配置不完整：ID / Bucket 不能为空')
    return await new CloudUploadProvider({
      provider: p.provider, sdk: uploadVendorMeta(p.provider).sdk, region: p.region,
      endpoint: p.endpoint, bucket: p.bucket, accessKeyId: p.accessKeyId,
      accessKeySecret: secret, baseUrl: p.baseUrl,
    }).testConnection()
  }
}
