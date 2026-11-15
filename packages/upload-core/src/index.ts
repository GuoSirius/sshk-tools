/**
 * @sshk/upload-core — 应用级上传能力（R26）。
 * B1：types + UploadProvider 接口 + 校验/并发/重试骨架 + UploadService。
 * B4 / B5 分别落地 Local / Remote(ftp|sftp) / Cloud Provider。
 * main 进程持有 Service 实例，经 IPC upload:single / upload:batch 暴露；密钥不进渲染层。
 */
export type {
  UploadBatchOptions,
  UploadContext,
  UploadFile,
  UploadOverrides,
  UploadProfile,
  UploadProgress,
  UploadProvider,
  UploadResult,
  UploadStatus,
  UploadTargetType,
  UploadValidation,
} from './types'
export { DEFAULT_VALIDATION, mergeValidation, validateFile } from './validation'
export type { ValidationFailure, ValidationOutcome, ValidationSuccess } from './validation'
export { mapWithConcurrency, withRetry } from './concurrency'
export { UploadService } from './service'
export type { UploadServiceOptions } from './service'
export { LocalUploadProvider, RemoteUploadProvider, CloudUploadProvider } from './providers'
export type { LocalProviderOptions, RemoteProfile, CloudProfile } from './providers'
