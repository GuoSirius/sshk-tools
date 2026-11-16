import { mapWithConcurrency, withRetry } from './concurrency'
import { DEFAULT_VALIDATION, mergeValidation, validateFile } from './validation'
import type {
  UploadedImagePage,
  UploadBatchOptions,
  UploadContext,
  UploadFile,
  UploadProgress,
  UploadProvider,
  UploadResult,
  UploadTargetType,
  UploadValidation,
} from './types'

export interface UploadServiceOptions {
  /** 全局默认校验；工具级 ctx.validation 只能收紧 */
  validation?: UploadValidation
  concurrency?: number
  retries?: number
  onProgress?: (p: UploadProgress) => void
}

/**
 * 应用级上传服务（B1 内核）。由 main 进程持有实例，渲染层经 IPC 调用，
 * profile 中的密钥在此解析后直接交给 Provider，绝不下发到渲染层。
 */
export class UploadService {
  private readonly providers = new Map<UploadTargetType, UploadProvider>()

  constructor(private readonly options: UploadServiceOptions = {}) {}

  register(provider: UploadProvider): void {
    this.providers.set(provider.type, provider)
  }

  private providerFor(type: UploadTargetType): UploadProvider {
    const provider = this.providers.get(type)
    if (!provider) throw new Error(`未注册 ${type} 上传 Provider`)
    return provider
  }

  private notify(p: UploadProgress, override?: (p: UploadProgress) => void): void {
    (override ?? this.options.onProgress)?.(p)
  }

  async upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult> {
    const rule = mergeValidation(this.options.validation ?? DEFAULT_VALIDATION, ctx.validation)
    const check = validateFile(file, rule)
    if (!check.ok) {
      this.notify({ name: file.name, percent: 0, status: 'failed', error: check.reason })
      throw new Error(check.reason)
    }

    const provider = this.providerFor(ctx.targetType)
    this.notify({ name: file.name, percent: 0, status: 'uploading' })
    try {
      const result = await provider.upload(file, ctx)
      this.notify({ name: file.name, percent: 100, status: 'success' })
      return result
    } catch (err) {
      this.notify({ name: file.name, percent: 0, status: 'failed', error: (err as Error).message })
      throw err
    }
  }

  /** 富文本图片库：列出某来源已有图片（跟随翻页分页）；Provider 不支持时给出明确错误 */
  async listImages(ctx: UploadContext & { limit?: number; cursor?: string | null }): Promise<UploadedImagePage> {
    const provider = this.providerFor(ctx.targetType)
    if (!provider.listImages) throw new Error(`${ctx.targetType} 来源不支持列出图片`)
    return provider.listImages(ctx)
  }

  /** 富文本图片库：列出某来源的真实目录（含空目录）；Provider 不支持时给出明确错误 */
  async listDirectories(ctx: UploadContext): Promise<string[]> {
    const provider = this.providerFor(ctx.targetType)
    if (!provider.listDirectories) throw new Error(`${ctx.targetType} 来源不支持列出目录`)
    return provider.listDirectories(ctx)
  }

  /** 批量：先整批校验（避免部分上传后才发现不合规），再按并发上限上传，逐个重试 */
  async uploadBatch(
    files: UploadFile[],
    ctx: UploadContext,
    opts: UploadBatchOptions = {},
  ): Promise<UploadResult[]> {
    const rule = mergeValidation(this.options.validation ?? DEFAULT_VALIDATION, ctx.validation)
    for (const file of files) {
      const check = validateFile(file, rule)
      if (!check.ok) {
        this.notify({ name: file.name, percent: 0, status: 'failed', error: check.reason }, opts.onProgress)
        throw new Error(check.reason)
      }
    }

    const provider = this.providerFor(ctx.targetType)
    const concurrency = opts.concurrency ?? this.options.concurrency ?? 3
    const retries = opts.retries ?? this.options.retries ?? 0

    return await mapWithConcurrency(files, concurrency, async (file) => {
      this.notify({ name: file.name, percent: 0, status: 'uploading' }, opts.onProgress)
      try {
        const result = await withRetry(() => provider.upload(file, ctx), retries)
        this.notify({ name: file.name, percent: 100, status: 'success' }, opts.onProgress)
        return result
      } catch (err) {
        this.notify({ name: file.name, percent: 0, status: 'failed', error: (err as Error).message }, opts.onProgress)
        throw err
      }
    })
  }
}
