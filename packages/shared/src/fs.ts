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
  /** 毫秒时间戳：创建时间（本地 birthtime；远程/云多数无 → 缺省不冒充） */
  createdAt?: number
  /** 权限八进制（本地 / SFTP 有值，0777 样式） */
  mode?: string
  /** 属主（本地为 uid 数字；SFTP 同）；读不到缺省 */
  owner?: string
  /** 属组（同上） */
  group?: string
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

/** 音视频在线播放（2026-11-19）：流式下载到应用临时文件，返回 localres:// URL。
 *  file:// 在 app:///http:// 渲染层被 Chromium 拦截（一直加载中），改走 localres 白名单协议；
 *  base64 data URI 大文件（百 MB 级）无法解码播放且占数倍内存，已废弃。
 *  字段名保留 fileUrl（IPC 契约不变），值为 localres:/// 形态。 */
export interface FsReadMediaResult {
  fileUrl: string
  size: number
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
  /** 同源同目录复制时的新文件名（避免覆盖自身；仅单源有意义） */
  renameTo?: string
}

export interface FsMvRequest {
  profileId: string
  sources: { path: string; kind: FsEntryKind }[]
  destDir: string
  /** 重命名专用：给单个源指定新文件名（destDir 为原父目录时避免 dest===src 校验）；多源移动留空 */
  renameTo?: string
}

/** 传输队列任务方向（cross = 跨通道复制：源通道下载到临时文件后写入目标通道） */
export type FsTransferKind = 'upload' | 'download' | 'copy' | 'delete' | 'cross'

/**
 * 传输队列任务状态（plans/10 §4）。
 * paused = 协作式暂停（检查点停下，保留进度/检查点，可续传）
 */
export type FsTransferStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'canceled' | 'conflict'

/** 传输队列控制动作（plans/10：单一 fs:transfer:control 通道） */
export type FsTransferControlAction =
  | 'start' | 'pause' | 'resume' | 'stop' | 'retry' | 'remove'
  | 'startAll' | 'pauseAll' | 'stopAll' | 'retryFailed' | 'clearFinished' | 'clearAll'

export interface FsTransferControlRequest {
  action: FsTransferControlAction
  /** 单条控制的任务 id 集合；批量动作忽略 */
  ids?: string[]
  /** retry 冲突任务时放行覆盖 */
  overwrite?: boolean
}

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
  /** 跨通道移动：成功后删除源文件（项20） */
  moveSource?: boolean
  size: number
  transferred: number
  status: FsTransferStatus
  error?: string
  /** 字节/秒（近一次采样） */
  speed?: number
  startedAt?: number
  finishedAt?: number
  /** 可续传（有上传分片检查点 / 下载区间元数据，重试/继续可从进度续跑） */
  resumable?: boolean
  /** 分片进度（上传 multipart / 下载 Range 共用展示） */
  partsDone?: number
  partsTotal?: number
  /** 从持久化队列恢复的任务（恢复后一律 paused，不自动续跑） */
  persisted?: boolean
  /** 暂停中（已请求暂停、等待协作检查点落定，UI 文案「暂停中…」） */
  pausing?: boolean
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
  /** 跨通道移动：写目标成功后删除源文件（项20） */
  moveSource?: boolean
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
  /** 跨通道移动（项20）：复制成功后删除源文件；源通道须可写，否则报错 */
  move?: boolean
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
  /** 流式会话 id：渲染层生成，主进程逐批推送 fsSearchEvent 时原样带回用于过滤旧会话 */
  reqId?: string
  /** 云通道扫描页数上限（0 = 不限）；由渲染层读应用配置传入，主进程缺省回落 500 */
  maxPages?: number
}

/** 递归搜索结果：truncated=true 表示已达上限，结果可能不全 */
export interface FsSearchResult {
  entries: FsEntry[]
  truncated: boolean
}

/** 递归搜索流式批次（主进程 → 渲染层，边扫边推，避免长时间空白） */
export interface FsSearchEvent {
  reqId: string
  /** 本批新增的命中条目（累加即为当前结果） */
  entries: FsEntry[]
  /** 本次搜索是否已全部完成（完成批可为空）；是否截断以 invoke 返回的 FsSearchResult 为准 */
  done: boolean
  /** 已扫描目录数，供进度提示 */
  scannedDirs: number
}

/** 目录容量统计结果（truncated=true 表示扫描达到上限，数值为已扫到的部分） */
export interface FsUsageResult {
  /** 文件总字节数 */
  size: number
  /** 文件个数 */
  files: number
  truncated: boolean
}

/** chmod 请求（用户 2026-11-18 §十一）：本地 / SFTP 支持；modeOctal 为 4 位八进制（如 0644） */
export interface FsChmodRequest {
  profileId: string
  path: string
  modeOctal: string
}

/** 文本编码 / 换行符转换请求（§十一 转换格式 A）：全通道（经驱动读→转→写） */
export interface FsConvertTextRequest {
  profileId: string
  path: string
  /** 源编码：auto = 自动检测（BOM/UTF-8 校验 → GBK 兜底） */
  fromEncoding: 'auto' | 'utf-8' | 'gbk' | 'big5'
  /** 目标编码 */
  toEncoding: 'utf-8' | 'gbk'
  /** 换行符处理：keep = 原样保留 */
  newline: 'keep' | 'lf' | 'crlf'
}

/** 文本转换结果：detected 供 UI 提示实际使用的源编码 */
export interface FsConvertTextResult {
  detected: Exclude<FsConvertTextRequest['fromEncoding'], 'auto'>
  /** 转换的字节数（转换前） */
  bytes: number
  encodingChanged: boolean
  newlineChanged: boolean
}

/** 压缩请求（§十一 压缩/解压，仅本地通道）：sources 递归收集文件打入 zip */
export interface FsZipRequest {
  profileId: string
  /** 产物 zip 的完整路径（含文件名，须 .zip 结尾） */
  zipPath: string
  sources: { path: string; kind: FsEntryKind }[]
}

export interface FsZipResult {
  zipPath: string
  files: number
  size: number
}

/** 解压请求：目标通道可选（跨源解压，zip 读入内存后写入目标）；目标目录不存在自动创建 */
export interface FsUnzipRequest {
  profileId: string
  path: string
  /** 目标目录名（zip 同级新建；仅名称不含斜杠，防越界）；缺省 = zip 名去扩展名。destDir 存在时忽略 */
  destDirName?: string
  /** 目标通道（跨源解压）；缺省 = 源通道 */
  destProfileId?: string
  /** 目标目录（通道相对根路径 /a/b，不能为根）；缺省 = zip 同级 + destDirName */
  destDir?: string
  /** 目标目录已有同名条目时直接覆盖（渲染层覆盖确认后置 true） */
  overwrite?: boolean
}

export interface FsUnzipResult {
  destDir: string
  files: number
}

/** 目录备注（§十一 备注列）：应用侧存储，键 = profileId + path */
export interface FsAnnotation {
  profileId: string
  path: string
  note: string
}

/** 收藏夹条目 */
export interface FsFavorite {
  _id: string
  profileId: string
  profileName?: string
  path: string
  kind: FsEntryKind
  name: string
}

/** ── plans/10 传输队列可控化与分片 ── */

/** 分片上传设置（「更多 ▾ → 传输设置…」可配；阈值/片大小/并发实时生效、跨重启记忆） */
export interface FsMultipartSettings {
  /** 分片开关（关 = 全部单流直传） */
  enabled: boolean
  /** 超过该大小走分片（MB，1~1024，默认 50） */
  thresholdMb: number
  /** 单片大小（MB，5~100，默认 5） */
  partSizeMb: number
  /** 单任务分片并发（1~8，默认 3） */
  partsConcurrency: number
}

/** 分片设置读取结果：附带服务端遗留 uploadId 数（崩溃遗留，面板/设置展示 + 手动清理） */
export interface FsMultipartStatus extends FsMultipartSettings {
  /** 服务端遗留分片上传数（当前可写通道合计） */
  orphans: number
}

/** 分片计划：10000 片上限自动上调单片大小（plans/10 §5） */
export interface FsMultipartPlan {
  /** 单片字节数 */
  partSize: number
  /** 总片数 */
  partsTotal: number
  /** 是否因片数上限自动上调过单片大小 */
  partSizeAdjusted: boolean
  /** 实际生效的单片大小（MB） */
  partSizeMb: number
}

/** 上传分片计划（纯函数，main 与单测共用） */
export function fsMultipartPlan(sizeBytes: number, partSizeMbRaw: number): FsMultipartPlan {
  const MB = 1024 * 1024
  const MAX_PARTS = 10000
  let mb = Math.max(1, Math.floor(Number(partSizeMbRaw) || 1))
  let partSize = mb * MB
  let partsTotal = Math.max(1, Math.ceil(sizeBytes / partSize))
  let adjusted = false
  if (partsTotal > MAX_PARTS) {
    mb = Math.ceil(sizeBytes / (MAX_PARTS * MB))
    partSize = mb * MB
    partsTotal = Math.max(1, Math.ceil(sizeBytes / partSize))
    adjusted = true
  }
  return { partSize, partsTotal, partSizeAdjusted: adjusted, partSizeMb: mb }
}

/** 下载区间元数据（`<dest>.sshkpart.json`；end 为闭区间尾字节偏移） */
export interface FsRangeMeta {
  size: number
  fingerprint: string
  partSize: number
  ranges: { start: number; end: number }[]
}

/**
 * 下载缺失区间（纯函数）：已完成区间折叠成片序号比对，返回缺片列表。
 * 返回的 end 为开区间（ exclusive，供 readRange(remotePath, start, end) 直接用）。
 */
export function fsMissingChunks(size: number, partSize: number, done: { start: number; end: number }[]): { start: number; end: number }[] {
  if (size <= 0 || partSize <= 0) return []
  const total = Math.ceil(size / partSize)
  const doneIdx = new Set<number>()
  for (const r of done ?? []) {
    const idx = Math.floor(r.start / partSize)
    if (idx < 0 || idx >= total) continue
    if (r.end >= Math.min(size, (idx + 1) * partSize) - 1) doneIdx.add(idx)
  }
  const out: { start: number; end: number }[] = []
  for (let i = 0; i < total; i++) {
    if (!doneIdx.has(i)) out.push({ start: i * partSize, end: Math.min(size, (i + 1) * partSize) })
  }
  return out
}

/** 持久化判定（plans/10 §7）：只持久化未完结的 upload/download；copy/cross/delete 预留不写盘 */
export function fsTransferCanPersist(kind: FsTransferKind, status: FsTransferStatus): boolean {
  const kindOk = kind === 'upload' || kind === 'download'
  const statusOk = status === 'queued' || status === 'running' || status === 'paused' || status === 'conflict' || status === 'failed'
  return kindOk && statusOk
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

/** 音视频在线播放阈值缺省值（字节）：实际值可配（app.fs.mediaLimitMb，0=不限），超过引导下载后本地播放 */
export const FS_MEDIA_PLAY_LIMIT = 100 * 1024 * 1024

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

/** 八进制权限串 → rwx 文本（如 0644 → rw-r--r--）；非法输入返回 '' */
export function fsModeToRwx(mode: string | undefined): string {
  const m = /^0?[0-7]{3,4}$/.exec(String(mode ?? '').trim())
  if (!m) return ''
  const bits = parseInt(m[0]!, 8) & 0o777
  const chars = ['r', 'w', 'x']
  let out = ''
  for (let g = 2; g >= 0; g--) {
    for (let b = 0; b < 3; b++) out += (bits >> (g * 3 + b)) & 1 ? chars[b]! : '-'
  }
  return out
}

/** 是否 zip 文件（解压入口启用条件） */
export function isFsZipName(name: string): boolean {
  return /\.zip$/i.test(String(name ?? '').trim())
}
