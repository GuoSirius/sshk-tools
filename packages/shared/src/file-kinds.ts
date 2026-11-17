/**
 * 文件内容类别（kind）统一定义：列取过滤（upload-core 三 Provider / main）与
 * 选择弹框默认 accept、文案（file-picker）共用同一份扩展名白名单，避免两处漂移。
 * 「能传的」与「能列的」口径一致性原则沿用原 upload-core/image-files.ts。
 */

/** 文件内容类别：image=图片（历史行为）；document=文档；code=代码/配置；video=视频；all=全部文件 */
export type FileKind = 'image' | 'document' | 'code' | 'video' | 'all'

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif'] as const

export const DOCUMENT_EXTS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.rtf',
  '.odt', '.ods', '.odp', '.epub', '.wps', '.et', '.dps',
] as const

export const CODE_EXTS = [
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue',
  '.py', '.pyw', '.java', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.php', '.rb', '.swift', '.kt', '.kts', '.scala', '.dart', '.lua', '.r', '.pl',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.gradle', '.mk',
] as const

/** 视频类：不收 .ts（MPEG-TS 与 TypeScript 代码扩展名冲突，归属代码类） */
export const VIDEO_EXTS = [
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
  '.m4v', '.mpg', '.mpeg', '.3gp', '.rm', '.rmvb', '.vob', '.mts', '.m2ts',
] as const

const KIND_EXTS: Record<Exclude<FileKind, 'all'>, ReadonlySet<string>> = {
  image: new Set<string>(IMAGE_EXTS),
  document: new Set<string>(DOCUMENT_EXTS),
  code: new Set<string>(CODE_EXTS),
  video: new Set<string>(VIDEO_EXTS),
}

/** 取文件名的小写扩展名（含点，如 '.png'；无扩展名返回 ''） */
export function extNameOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 文件名是否属于指定类别；all 恒真（全部文件）；kind 缺省返回 false——调用方应显式补 'image' 缺省，宁缺勿滥 */
export function isKindFileName(kind: FileKind | undefined, name: string): boolean {
  if (kind === 'all') return true
  if (!kind) return false
  return KIND_EXTS[kind].has(extNameOf(name))
}

/** 弹框默认 accept 属性（文件选择器过滤；all / 未知类别不限制） */
export const FILE_KIND_ACCEPT: Record<FileKind, string> = {
  image: 'image/*',
  document: DOCUMENT_EXTS.join(','),
  code: CODE_EXTS.join(','),
  video: 'video/*',
  all: '',
}

/** 类别中文展示名：图片 / 文档 / 代码 / 视频 / 文件（弹框标题、页签、空态文案用） */
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  image: '图片',
  document: '文档',
  code: '代码',
  video: '视频',
  all: '文件',
}

/** 历史值兼容：'file' 归一为 'all'；其余透传（缺省行为由调用方决定，一般为 image） */
export function normalizeFileKind(kind: string | undefined): FileKind | undefined {
  if (kind === 'file') return 'all'
  if (kind === 'image' || kind === 'document' || kind === 'code' || kind === 'video' || kind === 'all') return kind
  return undefined
}
