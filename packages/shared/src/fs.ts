/**
 * 文件系统（X6 · plans/08）契约：浏览/管理已配置上传通道的远端与云存储。
 *
 * 设计要点：
 * - 通道 = 上传配置里的 remote / cloud profile（同一 id 体系与 safeStorage 密钥），渲染层只拿
 *   脱敏元信息，绝不含密钥。
 * - 路径一律是「通道根相对」的规范化路径：'/' 或 'a/b'（无尾斜杠、无 '..'、无反斜杠）。
 *   云侧即 bucket 内的 key / 目录前缀；远程侧相对 remoteDir 根。越权/越根由 main 校验拒绝。
 * - 云侧目录是「公共前缀」虚拟目录；目录条目 path 不带尾斜杠。
 * - 传输（上传/下载/复制/递归删除）统一走传输队列任务，进度经 fs:transferEvent 推送。
 */

/** 条目类型 */
export type FsEntryKind = 'dir' | 'file'

/** 列表条目：目录 / 文件统一形态 */
export interface FsEntry {
  kind: FsEntryKind
  /** 条目名（最后一段） */
  name: string
  /** 通道根相对的完整路径（目录不带尾斜杠）；根为 '' */
  path: string
  /** 字节数；目录无意义（OSS 前缀） */
  size?: number
  /** 毫秒时间戳（OSS marker 为创建时间；FTP/SFTP 为 mtime） */
  modified?: number
  /** 权限（仅 SFTP 有值，0777 样式） */
  mode?: string
}

/** 列表分页：nextCursor 非空表示还有下一页（透传给下次 list 即可续拉） */
export interface FsListPage {
  entries: FsEntry[]
  nextCursor?: string | null
}

/** 通道元信息（脱敏；供文件系统页通道下拉） */
export interface FsChannelInfo {
  id: string
  name: string
  type: 'remote' | 'cloud' | 'local'
  /** 脱敏详情展示：FTP/SFTP 为 host:port；云为 厂商中文名 + bucket；本地为目录路径 */
  detail: string
  /** 远程协议 ftp | sftp */
  protocol?: string
  /** 云厂商 id（aliyun-oss 等） */
  provider?: string
  /** 起始目录（remote remoteDir；云/本地恒为 ''） */
  root: string
  /** 密钥是否已配置（未配置引导去「上传配置」；本地恒为 true） */
  hasSecret: boolean
  /** 写操作是否可用（如云厂商仅支持浏览时为 false） */
  writable: boolean
  /** 是否该类型下的默认 profile（下拉排序默认优先，2026-11-17 用户定版） */
  isDefault?: boolean
}

/** fs:profiles 响应：通道清单 + EDM 产物目录（联动上传用） */
export interface FsProfilesPayload {
  channels: FsChannelInfo[]
  outputRoot: string
}

/** main 侧 stat 结果：文件级冲突检测 / 存在性判断用 */
export interface FsStatResult {
  exists: boolean
  isDir?: boolean
  size?: number
  modified?: number
  /** etag / mtime 指纹（冲突检测的比对基准） */
  etag?: string
}

/** 读内容结果：base64 承载（图片预览与文本编辑共用一次通道形态） */
export interface FsReadResult {
  /** base64 内容 */
  contentBase64: string
  size: number
  modified?: number
  etag?: string
}

/** 写请求：expect 非空时先 stat 比对，不一致抛冲突错误（force=true 覆盖） */
export interface FsWriteRequest {
  profileId: string
  path: string
  contentBase64?: string
  expect?: { size?: number; modified?: number; etag?: string }
  force?: boolean
}

/** 删除请求：目录 → 递归删除，main 侧登记为传输队列 delete 任务（分批 + 进度） */
export interface FsRmRequest {
  profileId: string
  paths: { path: string; kind: FsEntryKind }[]
}

/** 复制 / 移动请求：一期仅同通道内 */
export interface FsCpRequest {
  profileId: string
  /** 源条目（dir 递归） */
  sources: { path: string; kind: FsEntryKind }[]
  /** 目标目录（通道根相对） */
  destDir: string
}

export interface FsMvRequest {
  profileId: string
  sources: { path: string; kind: FsEntryKind }[]
  destDir: string
}

/** 传输队列任务方向（cross = 跨通道复制：源通道下载到临时文件后写入目标通道） */
export type FsTransferKind = 'upload' | 'download' | 'copy' | 'delete' | 'cross'

export type FsTransferStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled' | 'conflict'

/** 传输队列任务（fs:transfer:list / fs:transferEvent 推送的都是全量形态） */
export interface FsTransferTask {
  id: string
  kind: FsTransferKind
  profileId: string
  profileName: string
  /** 展示名（文件名；删除任务为目录名） */
  name: string
  remotePath?: string
  localPath?: string
  /** 下载落点（本地完整路径）/ 复制目标远端路径 */
  destPath?: string
  destRemotePath?: string
  /** 跨通道复制：目标通道 id 与展示名 */
  destProfileId?: string
  destProfileName?: string
  size: number
  transferred: number
  status: FsTransferStatus
  error?: string
  /** 字节/秒（近一次采样） */
  speed?: number
  startedAt?: number
  finishedAt?: number
}

/** 传输任务入参：upload 需 localPath；download 生成 destPath；copy 需 destRemotePath；delete 需 remoteKind */
export interface FsTransferInput {
  kind: FsTransferKind
  profileId: string
  name: string
  remotePath?: string
  localPath?: string
  destPath?: string
  /** 复制任务：目标完整远端路径 */
  destRemotePath?: string
  /** 跨通道复制：目标通道 id（缺省 = 同通道复制） */
  destProfileId?: string
  /** 删除任务：dir 递归删除 / file 单文件 */
  remoteKind?: FsEntryKind
  /** 入队即已确认覆盖同名（如系统另存为对话框已提示替换），跳过引擎 conflict 二次确认 */
  overwrite?: boolean
  size?: number
}

/** 本地待上传文件（main 侧递归展平产物；relPath 保留目录结构） */
export interface FsLocalFile {
  name: string
  localPath: string
  /** 相对所选目录的路径（'a/b/c.png'），上传时拼到目标目录下 */
  relPath: string
  size: number
}

/** 跨通道复制请求：源通道条目（dir 会先在 main 侧递归展开成文件任务）复制到目标通道目录 */
export interface FsCrossCopyRequest {
  srcProfileId: string
  destProfileId: string
  sources: { path: string; kind: FsEntryKind }[]
  /** 目标目录（目标通道根相对；'' = 根） */
  destDir: string
}

/** 跨通道复制展开结果 */
export interface FsCrossCopyResult {
  taskIds: string[]
  /** 展开出的文件任务数（目录已递归展开） */
  files: number
  /** 目录被截断（超过任务上限）时为 true */
  truncated?: boolean
}

/** 递归搜索请求：在 path 前缀内（'' = 整个通道）按名称子串匹配 */
export interface FsSearchRequest {
  profileId: string
  path: string
  keyword: string
}

/** 递归搜索结果：truncated=true 表示已达上限，结果可能不全 */
export interface FsSearchResult {
  entries: FsEntry[]
  truncated: boolean
}

/** 目录容量统计结果（truncated=true 表示扫描达到上限，数值为已扫到的部分） */
export interface FsUsageResult {
  /** 文件总字节数 */
  size: number
  /** 文件个数 */
  files: number
  truncated: boolean
}


export const FS_TEXT_EXTENSIONS = [
  'css', 'js', 'mjs', 'cjs', 'html', 'htm', 'json', 'yaml', 'yml', 'njk', 'nunjucks',
  'txt', 'md', 'markdown', 'xml', 'svg', 'csv', 'tsv', 'ini', 'conf', 'toml', 'env',
  'ejs', 'hbs', 'liquid', 'pug', 'jinja', 'vue', 'ts', 'tsx', 'jsx', 'less', 'scss',
  'php', 'py', 'sh', 'bat', 'sql', 'gitignore', 'htaccess',
] as const

export const FS_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'] as const

/** 音视频（Chromium <video>/<audio> 原生可播的容器/编码；mkv/mov 等不保证可播，不给播放入口） */
export const FS_MEDIA_EXTENSIONS = ['mp4', 'webm', 'm4v', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'] as const

/** 音视频在线播放阈值（字节）：超过引导下载后本地播放（base64 过 IPC 的内存代价上限） */
export const FS_MEDIA_PLAY_LIMIT = 64 * 1024 * 1024

/** 文本编辑阈值（字节）：超过只读提示「文件过大，请下载编辑」 */
export const FS_TEXT_EDIT_LIMIT = 256 * 1024
/** 图片预览阈值（字节） */
export const FS_IMAGE_PREVIEW_LIMIT = 10 * 1024 * 1024
/** PDF 在线预览阈值（字节）：base64 过 IPC + Blob URL 交给 Chromium 内置 PDF viewer */
export const FS_PDF_PREVIEW_LIMIT = 50 * 1024 * 1024

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? '').trim())
  return m ? m[1]!.toLowerCase() : ''
}

export function isFsImageName(name: string): boolean {
  return (FS_IMAGE_EXTENSIONS as readonly string[]).includes(extOf(name))
}

export function isFsTextName(name: string): boolean {
  return (FS_TEXT_EXTENSIONS as readonly string[]).includes(extOf(name))
}

export function isFsMediaName(name: string): boolean {
  return (FS_MEDIA_EXTENSIONS as readonly string[]).includes(extOf(name))
}

/** 音视频 MIME（不可播的扩展返回 ''，由调用方兜底） */
export function fsMediaMime(name: string): string {
  switch (extOf(name)) {
    case 'mp4': case 'm4v': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'ogv': return 'video/ogg'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'ogg': case 'oga': return 'audio/ogg'
    case 'm4a': return 'audio/mp4'
    case 'flac': return 'audio/flac'
    case 'aac': return 'audio/aac'
    default: return ''
  }
}

/** 是否视频扩展（区别音频展示 <video>/<audio>） */
export function isFsVideoName(name: string): boolean {
  return ['mp4', 'webm', 'm4v', 'ogv'].includes(extOf(name))
}

/** 人类可读大小（B/KB/MB/GB，一位小数） */
export function fsFormatSize(bytes: number | undefined): string {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
