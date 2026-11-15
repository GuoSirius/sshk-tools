import path from 'node:path'
import {
  UploadService,
  LocalUploadProvider,
  RemoteUploadProvider,
  CloudUploadProvider,
} from '@sshk/upload-core'
import type {
  UploadContext,
  UploadFile,
  UploadProgress,
  UploadResult,
  UploadValidation,
} from '@sshk/upload-core'
import {
  listUploadProfiles,
  normalizeUploadConfig,
  pickCloudProfile,
  pickRemoteProfile,
  resolveUploadTool,
  type UploadGlobalConfig,
  type UploadProfileOption,
} from '@sshk/shared'
import type { AppServices } from './services'

/**
 * R26 应用级上传运行时（宿主 main 进程持有，工具经 IPC 只传文件与工具级覆盖项）。
 *
 * - 全局 profile 连接信息从 `app.upload` 读；密钥从 safeStorage 读，绝不下发渲染层。
 * - 每次调用重建 Service/Provider（成本极低），保证改配置后无需重启即生效。
 * - 校验：全局默认传给 Service，工具级 ctx.validation 由 mergeValidation 收紧（不能放宽）。
 */
const SECRET_TOOL_ID = 'upload-config'
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

    const ctx: UploadContext = {
      targetType: tool.targetType,
      profileId: tool.profileId || undefined,
      overrides: {
        localDir: tool.overrides.localDir || undefined,
        remotePath: tool.overrides.remotePath || undefined,
        bucket: tool.overrides.bucket || undefined,
        prefix: tool.overrides.prefix || undefined,
      },
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

    if (tool.targetType === 'remote') {
      const p = pickRemoteProfile(global, tool.profileId)
      if (!p) throw new Error('未找到远程上传 profile：请先在「上传配置」中添加并选择')
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
    if (tool.targetType === 'cloud') {
      const p = pickCloudProfile(global, tool.profileId)
      if (!p) throw new Error('未找到云上传 profile：请先在「上传配置」中添加并选择')
      const accessKeySecret = services.host.getToolSecret(SECRET_TOOL_ID, p.id)
      service.register(new CloudUploadProvider({
        provider: p.provider,
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

  /** 只回「是否已配置」，绝不回明文 */
  secretState(): Record<string, boolean> {
    const cfg = this.globalConfig()
    const state: Record<string, boolean> = {}
    for (const p of [...cfg.remote.profiles, ...cfg.cloud.profiles]) {
      state[p.id] = Boolean(this.opts.services.host.getToolSecret(SECRET_TOOL_ID, p.id))
    }
    return state
  }
}
