/**
 * C2 协同契约：rich-text 只暴露纯回调，**不 import @sshk/upload-core**。
 * 工具侧（EDM，B7/T7）注入实现，内部经 api('upload:single') 走 Upload Service；
 * 密钥与 profile 解析全在 main 进程完成，渲染层不接触。
 */

/** 入参为本地文件，返回可插入富文本的 URL */
export type RichTextUploadHook = (file: File) => Promise<string>

export interface RichTextImageRule {
  /** 提示用，如 'image/*'；真正校验在 Upload Service 侧 */
  accept?: string
  /** 组件侧快速拦截的字节上限（0 / 缺省 = 不拦截） */
  maxSize?: number
}
