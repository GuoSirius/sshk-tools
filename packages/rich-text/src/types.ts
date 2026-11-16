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

export interface RichTextImageLibrary {
  /** 列出可选图床来源（本地默认项 + 远程/云 profile），首次打开弹窗时调用一次 */
  sources(): Promise<RichTextImageSource[]>
  /** 上传到指定来源，返回可插入的 URL */
  upload(file: File, source: RichTextImageSource, target?: RichTextImageTarget): Promise<string>
  /** 列出某来源已有图片（新在前由实现方保证） */
  list(source: RichTextImageSource, target?: RichTextImageTarget): Promise<RichTextImageItem[]>
}
