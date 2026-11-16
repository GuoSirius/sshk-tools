/**
 * R26 B1：上传能力核心类型。
 * 设计：Provider 只负责「单文件传输」，并发 / 重试 / 进度 / 校验统一由 UploadService 承担，
 * 避免每个 Provider 重复实现一遍（与《上传能力规划.md》§三的 uploadBatch 保持兼容，留作扩展点）。
 */

export type UploadTargetType = 'local' | 'remote' | 'cloud'

/** 校验规则：全局默认 + 工具级收紧 */
export interface UploadValidation {
  /** 允许的扩展名（含点、小写，如 ['.png', '.jpg']）；空数组 = 不限制 */
  accept?: string[]
  /** 单文件字节上限；0 / 缺省 = 不限制 */
  maxSize?: number
}

export interface UploadFile {
  /** 文件名（含扩展名） */
  name: string
  /** 字节数 */
  size: number
  mime?: string
  /** 本地绝对路径（main 进程持有）或 data URL */
  source?: string
  /** 无本地路径时的直接内容 */
  data?: Uint8Array
}

/** 工具级可覆盖的非固定信息（连接信息仍在全局 profile 中） */
export interface UploadOverrides {
  /** 本地目录覆盖（targetType=local 时生效） */
  localDir?: string
  remotePath?: string
  bucket?: string
  prefix?: string
}

export interface UploadContext {
  targetType: UploadTargetType
  /** 选中的全局 profile；由 main 进程解析后注入，渲染层不接触密钥 */
  profileId?: string
  overrides?: UploadOverrides
  /** 工具级校验：只能比全局默认更严 */
  validation?: UploadValidation
}

export interface UploadResult {
  /** 可回填到编辑器 / 表单的 URL */
  url: string
  /** 云对象 key 或远程相对路径 */
  key?: string
  name: string
}

/** 图床已有图片（富文本图片库 / 图床浏览用） */
export interface UploadedImageInfo {
  url: string
  /** 云对象 key / 远程路径 / 本地文件名 */
  key: string
  name: string
  size?: number
  /** 毫秒时间戳（七牛 putTime 是 100ns 单位，仅用于排序展示） */
  modified?: number
}

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed'

export interface UploadProgress {
  name: string
  /** 0–100 */
  percent: number
  status: UploadStatus
  error?: string
}

export interface UploadProvider {
  readonly type: UploadTargetType
  upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult>
  /** 可选扩展点：Provider 自带的原生批量传输；Service 默认用并发单文件实现 */
  uploadBatch?(files: UploadFile[], ctx: UploadContext): Promise<UploadResult[]>
  /** 可选扩展点：列出该来源已有图片（富文本「从图床选择插入」用）；不支持时 Service 抛错 */
  listImages?(ctx: UploadContext & { limit?: number }): Promise<UploadedImageInfo[]>
}

export interface UploadBatchOptions {
  concurrency?: number
  retries?: number
  onProgress?: (p: UploadProgress) => void
}

/** 全局预设 profile（连接信息在 main 进程经 safeStorage 解析） */
export interface UploadProfile {
  id: string
  name: string
  targetType: UploadTargetType
  /** remote profile: ftp | sftp */
  protocol?: 'ftp' | 'sftp'
  [key: string]: unknown
}
