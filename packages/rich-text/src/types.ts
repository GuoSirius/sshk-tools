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

/**
 * 图片库桥接契约（用户需求 2026-11-16：图片菜单支持本地/远程/云，
 * 选已配置 profile + 专属桶/目录，可上传也可从图床列图插入）。
 * 工具侧注入实现（密钥在 main 进程解析），本包不依赖 upload-core。
 */
export interface RichTextImageSource {
  id: string
  type: 'local' | 'remote' | 'cloud'
  /** 下拉展示名，如「云 · OSS 主账号（aliyun-oss edm-prod）」 */
  label: string
}

/** 专属项：桶 / 目录（按来源类型选用，留空走 profile 默认） */
export interface RichTextImageTarget {
  localDir?: string
  remotePath?: string
  bucket?: string
  prefix?: string
}

export interface RichTextImageItem {
  url: string
  name?: string
  size?: number
  modified?: number
  /** 对象 key / 相对路径（用于派生多级目录选项；可选兼容旧桥接） */
  key?: string
}

/** 列图分页结果：大目录（上千上万张）由图片库带 nextCursor 续拉「加载更多」 */
export interface RichTextImagePage {
  items: RichTextImageItem[]
  /** 非空表示未取尽；下次请求放进 opts.cursor 继续拉 */
  nextCursor?: string | null
}

/** 上传进度可观测点：Provider 无 byte 级上报，只有开始(0)/完成(100)；失败由 upload reject 表达 */
export interface RichTextUploadProgress {
  /** 0 或 100 */
  percent: number
  status: 'uploading' | 'success'
}

/** 上传进度回调（可选）：工具侧桥接在上传开始/完成时各调用一次 */
export type RichTextUploadProgressHook = (p: RichTextUploadProgress) => void

export interface RichTextImageLibrary {
  /** 列出可选图床来源（本地默认项 + 远程/云 profile），首次打开弹窗时调用一次 */
  sources(): Promise<RichTextImageSource[]>
  /** 上传到指定来源，返回可插入的 URL；onProgress 可选，用于逐项进度展示 */
  upload(
    file: File,
    source: RichTextImageSource,
    target?: RichTextImageTarget,
    onProgress?: RichTextUploadProgressHook,
  ): Promise<string>
  /**
   * 列出某来源已有图片（新在前由实现方保证），返回分页：
   * limit 为单页期望上限；cursor 传上次返回的 nextCursor 续拉下一页。
   */
  list(
    source: RichTextImageSource,
    target?: RichTextImageTarget,
    opts?: { limit?: number; cursor?: string },
  ): Promise<RichTextImagePage>
  /**
   * 列出某来源的真实目录（相对目标位置的完整路径，可多级，含空目录）。
   * 可选：未实现时图片库会降级用「已列图片 key」反推目录。
   */
  listDirectories?(source: RichTextImageSource, target?: RichTextImageTarget): Promise<string[]>
}
