/**
 * C2 协同契约：rich-text 只暴露纯回调，**不 import @sshk/upload-core**。
 * 工具侧（EDM，B7/T7）注入实现，内部经 api('upload:single') 走 Upload Service；
 * 密钥与 profile 解析全在 main 进程完成，渲染层不接触。
 *
 * 图片库桥接契约已于 2026-11-17 泛化到 @sshk/file-picker（FilePicker*），
 * 此处按旧名（RichTextImage*）别名导出，工具侧存量引用无需改动。
 */

/** 入参为本地文件，返回可插入富文本的 URL */
export type RichTextUploadHook = (file: File) => Promise<string>

export interface RichTextImageRule {
  /** 提示用，如 'image/*'；真正校验在 Upload Service 侧 */
  accept?: string
  /** 组件侧快速拦截的字节上限（0 / 缺省 = 不拦截） */
  maxSize?: number
}

export type {
  /** 图库条目（url/name/size/key…） */
  FilePickerItem as RichTextImageItem,
  /** 图库桥接契约（sources/upload/list/listDirectories） */
  FilePickerLibrary as RichTextImageLibrary,
  /** 列图分页结果 */
  FilePickerPage as RichTextImagePage,
  /** 上传来源（local/remote/cloud + 展示名） */
  FilePickerSource as RichTextImageSource,
  /** 专属项：桶/目录 */
  FilePickerTarget as RichTextImageTarget,
} from '@sshk/file-picker'

/** 上传进度可观测点：Provider 无 byte 级上报，只有开始(0)/完成(100)；失败由 upload reject 表达 */
export interface RichTextUploadProgress {
  /** 0 或 100 */
  percent: number
  status: 'uploading' | 'success'
}

/** 上传进度回调（可选）：工具侧桥接在上传开始/完成时各调用一次 */
export type RichTextUploadProgressHook = (p: RichTextUploadProgress) => void
