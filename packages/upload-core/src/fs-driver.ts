import type { Readable } from 'node:stream'
import { AppError } from '@sshk/shared'
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

  /** 递归搜索：在 path 前缀内（'' = 整个通道根）按名称子串匹配（大小写不敏感）；truncated 达上限。
   *  onBatch 每攒够一批/每完成一层就回推，调用方（main）转发给渲染层做流式显示。 */
  search(path: string, keyword: string, opts?: { maxResults?: number; onBatch?: FsSearchBatchFn }): Promise<FsSearchResult>

  /** 目录容量统计：前缀/目录下文件总字节与个数（达到扫描上限时 truncated=true） */
  usage(path: string): Promise<FsUsageResult>

  /**
   * 删除权限前置探测（用户 2026-11-18）：copy+delete 组合与递归删除类操作执行前调用，
   * 无删除权限时抛 permission 错误直接拒绝——避免「复制成功后删源失败」的半程操作。
   * dir = 将被删改内容所在目录（根可省略）；探测必须零副作用（不得改动现有文件）。
   */
  ensureCanDelete(op: string, dir?: string): Promise<void>

  /**
   * chmod（§十一 编辑权限）：仅本地 / SFTP 实现；其余通道为 undefined（UI 据此置灰）。
   * modeOctal 为 4 位八进制（如 0644）。
   */
  chmod?(path: string, modeOctal: string): Promise<void>
}

/** 删除权限探测失败的统一拒绝错误（各驱动复用，文案口径一致） */
export function deleteDeniedError(op: string, channelKind: string): Error {
  return new AppError(
    `「${op}」已取消：当前${channelKind}凭据没有删除权限（未执行任何修改，源文件原样保留）。请先为凭据开通删除/写入权限后重试。`,
    'permission',
  )
}

// ── 递归遍历通用骨架（远程/本地驱动共用） ──

/** 递归遍历安全上限：搜索/统计共用的深度与条目截断（逐层 list 慢，必须限深） */
export const REMOTE_WALK_MAX_DEPTH = 6
export const REMOTE_WALK_MAX_ENTRIES = 20_000

interface WalkItem { entry: FsEntry }

/** 递归搜索流式批次：entries 为本批新增命中，scannedDirs 为已完成列的目录数 */
export interface FsSearchBatch {
  entries: FsEntry[]
  scannedDirs: number
  done: boolean
}
export type FsSearchBatchFn = (batch: FsSearchBatch) => void

/**
 * 通用递归遍历：listPageFn 返回单级目录条目（path 为通道根相对路径），
 * visit 收到每个条目；返回是否因上限截断。BFS、限深、限总量。
 */
export async function walkRemote(
  root: string,
  listPageFn: (dirRel: string) => Promise<FsEntry[]>,
  visit: (item: WalkItem) => 'stop' | void,
  onDir?: (dirRel: string) => void,
): Promise<boolean> {
  let truncated = false
  let seen = 0
  const queue: { rel: string; depth: number }[] = [{ rel: root, depth: 0 }]
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!
    let children: FsEntry[]
    try { children = await listPageFn(rel) } catch { continue } // 单层失败不阻断整体
    onDir?.(rel) // 完成一层即报进度（流式搜索进度提示）
    for (const e of children) {
      seen++
      if (seen > REMOTE_WALK_MAX_ENTRIES) { truncated = true; queue.length = 0; break }
      if (visit({ entry: e }) === 'stop') { truncated = true; queue.length = 0; return truncated }
      if (e.kind === 'dir' && depth + 1 < REMOTE_WALK_MAX_DEPTH) queue.push({ rel: e.path, depth: depth + 1 })
    }
  }
  return truncated
}

/** 名称子串匹配（大小写不敏感） */
export function nameMatches(name: string, kw: string): boolean {
  return !kw || name.toLowerCase().includes(kw)
}

/** 目录恒在前、名称升序（§3.2 排序契约的存储层兜底；页面还有可切排序） */
export function sortFsEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}
