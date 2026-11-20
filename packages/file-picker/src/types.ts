/**
 * 通用文件选择桥接契约（由 rich-text 图片库契约 2026-11-16/17 泛化而来）：
 * file-picker 只暴露纯回调接口，**不 import @sshk/upload-core**。
 * 工具侧注入实现（EDM、模板工具、富文本等），密钥与 profile 解析全在 main 进程，渲染层不接触。
 */

import type { FileKind } from '@sshk/shared'

/**
 * 内容类别：image=图片库（历史行为）；document=文档库；code=代码库；all=文件库（全部文件）。
 * 类别扩展名白名单与默认 accept 统一定义在 @sshk/shared/file-kinds（与列取过滤同一份，不漂移）。
 */
export type FilePickerKind = FileKind

/** 模式（=内容类别）：影响默认标题、页签/空态文案、卡片渲染与默认 accept，均可被应用方覆盖 */
export type FilePickerMode = FilePickerKind

export interface FilePickerSource {
  id: string
  type: 'local' | 'remote' | 'cloud'
  /** 下拉展示名，如「云 · OSS 主账号（aliyun-oss edm-prod）」 */
  label: string
}

/** 专属项：桶 / 目录（按来源类型选用，留空走 profile 默认） */
export interface FilePickerTarget {
  localDir?: string
  remotePath?: string
  bucket?: string
  prefix?: string
}

export interface FilePickerItem {
  url: string
  name?: string
  size?: number
  modified?: number
  /** 对象 key / 相对路径（用于派生多级目录选项；可选兼容旧桥接） */
  key?: string
}

/** 列取分页结果：大目录（上千上万个文件）由弹框带 nextCursor 续拉「加载更多」 */
export interface FilePickerPage {
  items: FilePickerItem[]
  /** 非空表示未取尽；下次请求放进 opts.cursor 继续拉 */
  nextCursor?: string | null
}

/** 上传进度可观测点：支持 byte/分片上报时为 0–100 中间值；否则只有开始(0)/完成(100)；失败由 upload reject 表达 */
export interface FilePickerUploadProgress {
  /** 0–100 */
  percent: number
  status: 'uploading' | 'success'
}

export type FilePickerUploadProgressHook = (p: FilePickerUploadProgress) => void

export interface FilePickerLibrary {
  /** 列出可选来源（本地默认项 + 远程/云 profile），首次打开弹窗时调用一次 */
  sources(): Promise<FilePickerSource[]>
  /** 上传到指定来源，返回可访问的 URL；onProgress 可选，用于逐项进度展示 */
  upload(
    file: File,
    source: FilePickerSource,
    target?: FilePickerTarget,
    onProgress?: FilePickerUploadProgressHook,
  ): Promise<string>
  /**
   * 列出某来源已有文件（新在前由实现方保证），返回分页：
   * limit 为单页期望上限；cursor 传上次返回的 nextCursor 续拉下一页；
   * kind=image 只列图片（与历史图片库行为一致）、document/code 按白名单过滤、all 列全部文件，实现方必须透传到底层。
   */
  list(
    source: FilePickerSource,
    target?: FilePickerTarget,
    opts?: { limit?: number; cursor?: string; kind?: FilePickerKind },
  ): Promise<FilePickerPage>
  /**
   * 列出某来源的真实目录（相对目标位置的完整路径，可多级，含空目录）。
   * 可选：未实现时弹框会降级用「已列文件 key」反推目录。
   */
  listDirectories?(source: FilePickerSource, target?: FilePickerTarget): Promise<string[]>
}

/** 上传存储命名策略：hash=内容寻址名（现状默认），original=保留原文件名 */
export type FilePickerNaming = 'hash' | 'original'

/**
 * 同名不同内容的冲突策略（仅 original 命名时生效）：
 * hash=同名追加 -hash8（与现有 hash 命名同语义，不覆盖已有文件）；overwrite=直接覆盖同名对象。
 */
export type FilePickerConflict = 'hash' | 'overwrite'

/** confirm 交付给应用方的最终条目：弹框不决定用途，插图/插链接/挂附件由应用方处理 */
export type FilePickerConfirmPayload = FilePickerItem[]
