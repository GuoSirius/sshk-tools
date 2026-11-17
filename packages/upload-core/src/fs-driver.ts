import type { Readable } from 'node:stream'
import type { FsEntry, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'

/**
 * 文件系统驱动统一接口（X6）：远程（FTP/SFTP）与云（OSS）各实现一份。
 * 全部路径为通道根相对（'' 表示根）；写操作语义见 plans/08 §二能力矩阵。
 */
export interface FsDriver {
  /** 部分云厂商仅支持浏览（list）；写操作前由调用方检查并给出明确提示 */
  readonly writable: boolean

  /** 列单级目录：目录恒在前、名称升序；cursor 透传续拉 */
  list(path: string, opts?: { pageSize?: number; cursor?: string | null }): Promise<FsListPage>

  /** 文件 stat（目录 marker 亦可）；不存在返回 { exists: false }，不抛错 */
  stat(path: string): Promise<FsStatResult>

  /** 新建目录（含 marker；远程 mkdir -p 语义） */
  mkdir(path: string): Promise<void>

  rmFile(path: string): Promise<void>

  /** 递归删目录：云按前缀分批删（分批+进度）；远程单连接自顶向下删 */
  rmDir(path: string, onProgress?: (done: number, total: number) => void): Promise<number>

  /** 同通道复制（云 copyObject；远程下载+重传，调用方队列化） */
  cp(src: string, dest: string): Promise<void>

  /** 同通道移动（云 copy+delete；远程 rename） */
  mv(src: string, dest: string): Promise<void>

  /** 读全量内容（预览/编辑/复制用；调用方负责大小阈值） */
  readBuffer(path: string): Promise<{ data: Buffer; size: number; modified?: number; etag?: string }>

  /** 写内容：Buffer 或流；onProgress 报告累计写入字节（传输进度） */
  write(path: string, body: Buffer | Readable, onProgress?: (bytes: number) => void): Promise<void>

  /** 流式下载到本地文件（传输队列下载任务用） */
  download(path: string, destFile: string, onProgress?: (bytes: number) => void): Promise<void>

  /** 递归搜索：在 path 前缀内（'' = 整个通道根）按名称子串匹配（大小写不敏感）；truncated 达上限 */
  search(path: string, keyword: string, opts?: { maxResults?: number }): Promise<FsSearchResult>

  /** 目录容量统计：前缀/目录下文件总字节与个数（达到扫描上限时 truncated=true） */
  usage(path: string): Promise<FsUsageResult>
}

/** 目录恒在前、名称升序（§3.2 排序契约的存储层兜底；页面还有可切排序） */
export function sortFsEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}
