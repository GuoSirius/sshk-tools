/**
 * R26 B1：上传能力核心类型。
 * 设计：Provider 只负责「单文件传输」，并发 / 重试 / 进度 / 校验统一由 UploadService 承担，
 * 避免每个 Provider 重复实现一遍（与《上传能力规划.md》§三的 uploadBatch 保持兼容，留作扩展点）。
 */

import type { FileKind } from '@sshk/shared'
import type { UploadTargetType } from './upload-manager'

/** Q-23 第二步：UploadTargetType 真相源统一到 upload-manager，本入口仅 re-export（消除重复定义） */
export type { UploadTargetType } from './upload-manager'

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
  /** 单文件传输进度回调（0–100）：Provider 支持 byte/分片上报时逐次调用，用于逐项真实进度 */
  onProgress?: (percent: number) => void
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

/** 列图分页结果：大目录（上千上万张）由调用方带 nextCursor 续拉，避免一次列爆 */
export interface UploadedImagePage {
  items: UploadedImageInfo[]
  /** 非空表示还有剩余数据；把它作为下次请求的 cursor 传入即可续拉 */
  nextCursor?: string | null
}

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed'

export interface UploadProgress {
  name: string
  /** 0–100 */
  percent: number
  status: UploadStatus
  error?: string
}

/**
 * 列取内容类别：image 只列图片（历史默认行为），document 文档 / code 代码 / video 视频，
 * all 列全部文件。类别与扩展名白名单统一定义在 @sshk/shared/file-kinds。
 */
export type UploadListKind = FileKind

/** 列图/列文件只读上下文：分页 + 内容类别（kind 缺省按 image 处理，保持历史行为） */
export type UploadListQuery = UploadContext & { limit?: number; cursor?: string | null; kind?: UploadListKind }

export interface UploadProvider {
  readonly type: UploadTargetType
  upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult>
  /** 可选扩展点：Provider 自带的原生批量传输；Service 默认用并发单文件实现 */
  uploadBatch?(files: UploadFile[], ctx: UploadContext): Promise<UploadResult[]>
  /**
   * 可选扩展点：列出该来源已有文件（「从图床选择插入」用）；不支持时 Service 抛错。
   * 分页语义：cursor 传上次返回的 nextCursor 续拉；limit 为本页期望收集上限（实现方内部可再按
   * 单请求上限翻页）；返回 nextCursor 非空表示未取尽，调用方可继续拉。
   * kind=image（缺省）只列图片，document/code/video 按白名单过滤，all 列全部文件——实现方必须区分处理。
   */
  listImages?(ctx: UploadListQuery): Promise<UploadedImagePage>
  /**
   * 可选扩展点：列出该来源的真实目录（富文本图片库下拉用）。
   * 返回相对当前前缀的子目录路径段（不含尾斜杠，可多级），不去重图片文件；
   * 与 listImages 从图片 key 反推目录不同，这里能列出空目录。不支持时 Service 抛错。
   */
  listDirectories?(ctx: UploadContext): Promise<string[]>
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
