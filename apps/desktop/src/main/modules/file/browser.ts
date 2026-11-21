import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import iconv from 'iconv-lite'
import { fsBasename, fsDestPath } from '@sshk/upload-core'
import {
  AppError,
  fsFormatSize,
  type FsChmodRequest,
  type FsConvertTextRequest,
  type FsConvertTextResult,
  type FsCrossCopyRequest,
  type FsCrossCopyResult,
  type FsCpRequest,
  type FsListPage,
  type FsLocalFile,
  type FsMvRequest,
  type FsReadResult,
  type FsRmRequest,
  type FsSearchRequest,
  type FsSearchResult,
  type FsStatResult,
  type FsTransferInput,
  type FsUsageResult,
  type FsWriteRequest,
} from '@sshk/shared'
import type { FsSearchBatchFn } from '@sshk/upload-core'
import { logger } from '../../logger'
import { migrateAnnotations, readSearchMaxPages, readUploadCap } from './metadata'
import type { FsCore } from './runtime'

/**
 * 通道文件浏览与管理（P3-3 自 fs.ts 拆出）：
 * list/stat/read/mkdir/rm/cp/mv/crossCopy/search/usage/chmod/convertText/write
 * + 本地文件选择（pickUpload）/递归展平（flattenLocal）。
 * 写操作全部审计落日志；递归删除/远端复制/跨通道走传输队列（FsTransferEngine）。
 */

/** 文本编码/换行符转换的文件大小上限（§十一 转换格式 A） */
const FS_TEXT_CONVERT_LIMIT = 20 * 1024 * 1024

/** 本地绝对路径取最后一段：系统弹框/拖拽在 Windows 下是反斜杠路径，不适用 root-rel 的 fsBasename */
function localBasename(abs: string): string {
  const s = String(abs ?? '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i < 0 ? s : s.slice(i + 1)
}

export async function list(core: FsCore, req: { profileId: string; path: string; cursor?: string | null }): Promise<FsListPage> {
  const { driver } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  return await driver.list(path, { cursor: req?.cursor ?? null, pageSize: 500 })
}

export async function stat(core: FsCore, req: { profileId: string; path: string }): Promise<FsStatResult> {
  const { driver } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') return { exists: true, isDir: true }
  return await driver.stat(path)
}

export async function read(core: FsCore, req: { profileId: string; path: string; maxBytes?: number }): Promise<FsReadResult> {
  const { driver } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('目录没有可读内容', 'io')
  const maxBytes = Math.max(1, Math.floor(Number(req?.maxBytes) || 10 * 1024 * 1024))
  const stat = await driver.stat(path)
  if (!stat.exists) throw new AppError('远端文件不存在（可能已被删除）', 'io')
  if (stat.isDir) throw new AppError('目录没有可读内容', 'io')
  if ((stat.size ?? 0) > maxBytes) {
    throw new AppError(`文件过大（${fsFormatSize(stat.size)} 超过 ${fsFormatSize(maxBytes)}），请下载后编辑`, 'io')
  }
  const { data, size, modified, etag } = await driver.readBuffer(path)
  return { contentBase64: data.toString('base64'), size: size || (stat.size ?? 0), modified, etag }
}

// ── 写操作（全部审计落日志） ──

export async function mkdir(core: FsCore, req: { profileId: string; path: string }): Promise<boolean> {
  const { driver, channel } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('根目录无需创建', 'io')
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  await driver.mkdir(path)
  logger.info('upload', `fs 新建目录：${channel.id}/${path}`)
  return true
}

export async function rm(core: FsCore, req: FsRmRequest): Promise<{ taskIds: string[] }> {
  const { driver, channel } = core.resolve(req?.profileId)
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  const taskIds: string[] = []
  const files: string[] = []
  for (const item of (req?.paths ?? []).slice(0, 500)) {
    const path = core.assertPath(item.path)
    if (path === '/') throw new AppError('根目录不可删除', 'io')
    if (item.kind === 'dir') {
      // 递归删除（高危）入队列：分批 + 进度 + 可取消
      taskIds.push(...core.engine.add([{
        kind: 'delete',
        profileId: channel.id,
        name: fsBasename(path),
        remotePath: path,
      }], (id) => core.resolve(id)))
    } else {
      files.push(path)
    }
  }
  for (const path of files) {
    await driver.rmFile(path)
    logger.info('upload', `fs 删除文件：${channel.id}/${path}`)
  }
  return { taskIds }
}

export async function cp(core: FsCore, req: FsCpRequest): Promise<{ taskIds: string[] }> {
  const { driver, channel } = core.resolve(req?.profileId)
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  const destDir = core.assertPath(req?.destDir)
  const taskIds: string[] = []
  const inline: { src: string; dest: string }[] = []
  const CP_DIR_CAP = 1500
  let dirCopies = 0

  /** 云/本地目录：对象存储没有真实目录，driver.cp 只支持单对象 copyObject——必须递归展开成文件逐个复制（项19） */
  const expandDir = async (dirPath: string, destBase: string): Promise<void> => {
    let cursor: string | null = null
    do {
      const page = await driver.list(dirPath, { pageSize: 2000, cursor })
      for (const e of page.entries) {
        if (dirCopies >= CP_DIR_CAP) throw new AppError(`目录复制超过 ${CP_DIR_CAP} 个文件上限，已中止`, 'io')
        const childDest = destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`
        if (e.kind === 'file') inline.push({ src: e.path, dest: childDest })
        else await expandDir(e.path, childDest)
      }
      cursor = page.nextCursor ?? null
    } while (cursor)
  }

  const cpRenameTo = String(req?.renameTo ?? '').trim()
  if (cpRenameTo && (/[\\/]/.test(cpRenameTo) || cpRenameTo === '.' || cpRenameTo === '..')) {
    throw new AppError('新名称不能包含斜杠或为 . / ..')
  }
  for (const item of (req?.sources ?? []).slice(0, 500)) {
    const src = core.assertPath(item.path)
    if (src === '/') throw new AppError('根目录不可复制', 'io')
    // 同源同目录复制（含重命名）必须给新名，否则覆盖自身；不同目录沿用原文件名
    const dest = cpRenameTo && (destDir === core.parentOf(src))
      ? (destDir === '/' ? `/${cpRenameTo}` : `${destDir}/${cpRenameTo}`)
      : fsDestPath(destDir, src)
    if (!cpRenameTo && (dest === src || dest.startsWith(`${src}/`))) throw new AppError('目标目录不能是源条目自身或其子目录，请在弹框中换一个文件名', 'io')
    // FTP/SFTP 复制 = 下载+重传（无服务端复制），大文件慢 → 队列化（§二能力矩阵）
    if (channel.type === 'remote') {
      taskIds.push(...core.engine.add([{
        kind: 'copy',
        profileId: channel.id,
        name: fsBasename(src),
        remotePath: src,
        destRemotePath: dest,
      }], (id) => core.resolve(id)))
    } else if (item.kind === 'dir') {
      // 云/本地目录递归展开；云侧还需先建目录 marker 保证空目录可见
      await driver.mkdir(dest)
      await expandDir(src, dest)
      dirCopies++
    } else {
      inline.push({ src, dest })
    }
  }
  for (const { src, dest } of inline) {
    await driver.cp(src, dest)
    logger.info('upload', `fs 复制：${channel.id}/${src} → ${dest}`)
  }
  return { taskIds }
}

export async function mv(core: FsCore, req: FsMvRequest): Promise<boolean> {
  const { driver, channel } = core.resolve(req?.profileId)
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  const destDir = core.assertPath(req?.destDir)
  // 重命名：新文件名单独指定（仅单源有意义），目标 = 父目录/新名
  const renameTo = String(req?.renameTo ?? '').trim()
  if (renameTo && (/[\\/]/.test(renameTo) || renameTo === '.' || renameTo === '..')) {
    throw new AppError('新名称不能包含斜杠或为 . / ..')
  }
  const MV_DIR_CAP = 1500
  for (const item of (req?.sources ?? []).slice(0, 500)) {
    const src = core.assertPath(item.path)
    if (src === '/') throw new AppError('根目录不可移动', 'io')
    // 重命名时 dest 用新名（与 src 同父目录）；普通移动沿用原文件名
    const dest = renameTo ? (destDir === '/' ? `/${renameTo}` : `${destDir}/${renameTo}`) : fsDestPath(destDir, src)
    if (!renameTo && (dest === src || dest.startsWith(`${src}/`))) throw new AppError('目标目录不能是源条目自身或其子目录', 'io')
    if (renameTo && dest === src) return true // 名称未变，无需操作
    if (item.kind === 'dir' && channel.type === 'cloud') {
      // 云目录「移动」= 逐文件 copy+delete（copyObject 不接受目录路径），最后删源 marker（项19）。
      // 用户 2026-11-18：执行前探测删除权限（无权限直接拒绝）；移动记录 (源,目标) 对，
      // 中途失败自动还原已移文件（复制回源 + 删目标副本），做到目录移动的文件级原子化
      await driver.ensureCanDelete('移动目录', src)
      const movedPairs: Array<{ src: string; dest: string }> = []
      let moved = 0
      const moveTree = async (dirPath: string, destBase: string): Promise<void> => {
        let cursor: string | null = null
        do {
          const page = await driver.list(dirPath, { pageSize: 2000, cursor })
          for (const e of page.entries) {
            if (moved >= MV_DIR_CAP) throw new AppError(`目录移动超过 ${MV_DIR_CAP} 个文件上限，已中止`, 'io')
            if (e.kind === 'file') {
              const destPath = destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`
              await driver.mv(e.path, destPath)
              movedPairs.push({ src: e.path, dest: destPath })
              moved++
            }
            else await moveTree(e.path, destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`)
          }
          cursor = page.nextCursor ?? null
        } while (cursor)
      }
      try {
        await moveTree(src, dest)
        await driver.rmFile(src.endsWith('/') ? src : `${src}/`).catch(() => { /* marker 可能不存在 */ })
      } catch (err) {
        // 精确还原：只动本次移动涉及的目标副本（不碰 dest 既有内容），复制回源位后删除
        let restored = 0
        for (const pair of movedPairs) {
          try { await driver.cp(pair.dest, pair.src); await driver.rmFile(pair.dest); restored++ } catch { /* 还原失败如实报告 */ }
        }
        throw new AppError(
          `目录移动未完成：${(err as Error).message}` +
          (restored
            ? `。已自动还原 ${restored}/${movedPairs.length} 个已移文件，源目录保持原样。`
            : '。自动还原未完成，请按提示核对源与目标目录。'),
        )
      }
      logger.info('upload', `fs 云目录移动：${channel.id}/${src} → ${dest}（${moved} 个文件）`)
    } else {
      await driver.mv(src, dest)
      logger.info('upload', `fs 移动：${channel.id}/${src} → ${dest}`)
    }
    // §十一：备注随条目迁移（重命名/移动后原路径备注跟到新路径）
    await migrateAnnotations(core, channel.id, src, dest, item.kind === 'dir' ? 'dir' : 'file')
  }
  return true
}

/**
 * 跨通道复制（二期）：目录在 main 侧递归展开成文件任务（限 1500 个，超出截断），
 * 每个文件一个 cross 任务（源下载到临时文件 → 写入目标通道），复用传输队列。
 */
export async function crossCopy(core: FsCore, req: FsCrossCopyRequest): Promise<FsCrossCopyResult> {
  const { driver: srcDriver, channel: srcChannel } = core.resolve(req?.srcProfileId)
  const { driver: destDriver, channel: destChannel } = core.resolve(req?.destProfileId)
  if (srcChannel.id === destChannel.id) throw new AppError('源与目标为同一通道：请用同通道复制')
  if (!destDriver.writable) throw new AppError(`目标通道「${destChannel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  if (req?.move && !srcDriver.writable) throw new AppError(`源通道「${srcChannel.name}」不支持删除，无法跨通道移动（仅复制）`)
  if (req?.move) await srcDriver.ensureCanDelete('跨通道移动')
  const destDir = core.assertPath(req?.destDir ?? '')
  const CROSS_TASK_CAP = 1500
  const inputs: FsTransferInput[] = []
  let truncated = false

  const expand = async (path: string, kind: 'dir' | 'file', destBase: string): Promise<void> => {
    if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
    if (kind === 'file') {
      const stat = await srcDriver.stat(path)
      inputs.push({
        kind: 'cross',
        profileId: srcChannel.id,
        destProfileId: destChannel.id,
        name: fsBasename(path),
        remotePath: path,
        // 用户 2026-11-19 定版：只搬运被复制项本身，不搬层级——destBase 逐层由「被复制项名」起算，
        // 复制 /a/b 粘贴到目标根得到 /b（而不是源根的 /a/b 整条链）
        destRemotePath: destBase,
        moveSource: Boolean(req?.move),
        size: stat.size ?? 0,
      })
      return
    }
    const page = await srcDriver.list(path, { pageSize: 2000 })
    for (const e of page.entries) {
      if (inputs.length >= CROSS_TASK_CAP) { truncated = true; return }
      await expand(e.path, e.kind, destBase === '/' ? `/${e.name}` : `${destBase}/${e.name}`)
    }
    if (page.nextCursor) truncated = true
  }

  for (const item of (req?.sources ?? []).slice(0, 200)) {
    const src = core.assertPath(item.path)
    if (src === '/') throw new AppError('根目录不可复制', 'io')
    if (src === destDir || destDir.startsWith(`${src}/`)) throw new AppError('目标目录不能是源条目自身或其子目录', 'io')
    // 顶层落点 = 目标目录 / 被复制项名（子内容相对该项展开）
    await expand(src, item.kind === 'dir' ? 'dir' : 'file', fsDestPath(destDir, src))
  }
  if (!inputs.length) return { taskIds: [], files: 0, truncated }
  const taskIds = core.engine.add(inputs, (id) => core.resolve(id))
  logger.info('upload', `fs 跨通道复制入队：${srcChannel.name} → ${destChannel.name}，${inputs.length} 个文件${truncated ? '（已截断）' : ''}`)
  return { taskIds, files: inputs.length, truncated }
}

// ── 二期只读扩展：递归搜索 / 目录容量统计 ──

export async function search(core: FsCore, req: FsSearchRequest, onBatch?: FsSearchBatchFn): Promise<FsSearchResult> {
  const { driver } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  const keyword = String(req?.keyword ?? '').trim()
  if (!keyword) return { entries: [], truncated: false }
  return await driver.search(path, keyword, {
    maxResults: 300,
    maxPages: readSearchMaxPages((k) => core.services.config.get(k)),
    onBatch,
  })
}

export async function usage(core: FsCore, req: { profileId: string; path: string }): Promise<FsUsageResult> {
  const { driver, channel } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  const r = await driver.usage(path)
  logger.info('upload', `fs 容量统计：${channel.id}${path === '/' ? '/(根)' : path} → ${fsFormatSize(r.size)} / ${r.files} 个文件${r.truncated ? '（截断）' : ''}`)
  return r
}

// ── §十一 扩展（用户 2026-11-18 定版）：chmod / 文本转换 ──

/** chmod：本地 / SFTP 驱动实现（FTP/云 UI 置灰，main 再兜底拒绝） */
export async function chmod(core: FsCore, req: FsChmodRequest): Promise<boolean> {
  const { driver, channel } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('根目录不支持 chmod', 'io')
  if (!driver.chmod) throw new AppError(`通道「${channel.name}」不支持 chmod（本地与 SFTP 通道可用）`)
  const modeOctal = String(req?.modeOctal ?? '').trim()
  await driver.chmod(path, modeOctal)
  logger.info('upload', `fs chmod：${channel.id}/${path} → ${modeOctal}`)
  return true
}

/** 文本编码 / 换行符转换（转换格式 A，全通道）：读 → 解码 → 转换 → 编码 → 写回 */
export async function convertText(core: FsCore, req: FsConvertTextRequest): Promise<FsConvertTextResult> {
  const { driver, channel } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('根目录不是文件', 'io')
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作`)
  const stat = await driver.stat(path)
  if (!stat.exists || stat.isDir) throw new AppError('文件不存在或为目录', 'io')
  if ((stat.size ?? 0) > FS_TEXT_CONVERT_LIMIT) {
    throw new AppError(`文件过大（${fsFormatSize(stat.size)} 超过 ${fsFormatSize(FS_TEXT_CONVERT_LIMIT)}），请下载后本地转换`, 'io')
  }
  const { data } = await driver.readBuffer(path)
  // 源编码解析：显式指定直接用；auto = BOM → UTF-8 严格校验 → GBK 兜底
  let from = req?.fromEncoding ?? 'auto'
  let body = data
  let hadBom = false
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    hadBom = true
    if (from === 'auto' || from === 'utf-8') { from = 'utf-8'; body = data.subarray(3) }
  }
  if (from === 'auto') {
    const strict = new TextDecoder('utf-8', { fatal: true })
    try { strict.decode(data); from = 'utf-8' }
    catch { from = 'gbk' } // UTF-8 解不开 → 按 GBK（大陆文件最常见的非 UTF-8 编码）
  }
  if (!iconv.encodingExists(from)) throw new AppError(`不支持的源编码：${from}`)
  if (!iconv.encodingExists(req?.toEncoding ?? 'utf-8')) throw new AppError(`不支持的目标编码：${req?.toEncoding}`)
  let text = iconv.decode(body, from)
  if (from === 'utf-8' && hadBom) text = text.replace(/^\uFEFF/, '')

  // 换行符规范化：先统一到 LF，再按目标形态输出
  let newlineChanged = false
  if (req?.newline !== 'keep') {
    const unified = text.replace(/\r\n/g, '\n')
    const targetText = req?.newline === 'crlf' ? unified.replace(/\n/g, '\r\n') : unified
    newlineChanged = targetText !== text
    text = targetText
  }

  // 目标编码编码：utf-8 且原带 BOM → 保留 BOM
  const encoded = iconv.encode(text, req?.toEncoding ?? 'utf-8')
  const out = req?.toEncoding === 'utf-8' && hadBom
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded])
    : encoded
  const encodingChanged = from !== (req?.toEncoding ?? 'utf-8')
  if (!encodingChanged && !newlineChanged) {
    return { detected: from as FsConvertTextResult['detected'], bytes: data.length, encodingChanged: false, newlineChanged: false }
  }
  await driver.write(path, out)
  logger.info('upload', `fs 文本转换：${channel.id}/${path} ${from} → ${req?.toEncoding}（换行 ${req?.newline}，${fsFormatSize(data.length)}）`)
  return {
    detected: from as FsConvertTextResult['detected'],
    bytes: data.length,
    encodingChanged,
    newlineChanged,
  }
}

export async function write(core: FsCore, req: FsWriteRequest): Promise<boolean> {
  const { driver, channel } = core.resolve(req?.profileId)
  const path = core.assertPath(req?.path)
  if (path === '/') throw new AppError('写入路径不能为空', 'io')
  if (!driver.writable) throw new AppError(`通道「${channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持）`)
  // 冲突检测：保存前重新 stat，比对 etag / 大小+时间，不一致提示覆盖（§四）
  if (req?.expect && !req?.force) {
    const stat = await driver.stat(path)
    const etagChanged = Boolean(req.expect.etag) && Boolean(stat.etag) && req.expect.etag !== stat.etag
    const metaChanged = !req.expect.etag && (
      (req.expect.size != null && stat.size != null && req.expect.size !== stat.size) ||
      (req.expect.modified != null && stat.modified != null && req.expect.modified !== stat.modified))
    if (!stat.exists || etagChanged || metaChanged) {
      throw new AppError('远端文件已变化：请在覆盖与放弃之间选择（保存时可选择覆盖）', 'io')
    }
  }
  const buf = Buffer.from(String(req?.contentBase64 ?? ''), 'base64')
  await driver.write(path, buf)
  logger.info('upload', `fs 写入：${channel.id}/${path}（${fsFormatSize(buf.length)}）`)
  return true
}

// ── 本地文件选择 / 展平 ──

export async function pickUpload(opts?: { type?: 'file' | 'dir' | 'any' }): Promise<string[]> {
  const type = opts?.type === 'dir' ? 'dir' : opts?.type === 'any' ? 'any' : 'file'
  const properties = type === 'dir'
    ? ['openDirectory', 'multiSelections'] as const
    : type === 'any'
      ? ['openFile', 'openDirectory', 'multiSelections'] as const
      : ['openFile', 'multiSelections'] as const
  const dialogOpts = { properties: [...properties] }
  const win = BrowserWindow.getFocusedWindow()
  const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
  return result.canceled ? [] : result.filePaths
}

/** 递归展平本地待上传路径（保留相对目录结构；上限可配置，默认 10000）
 *  注意：入参是本地绝对路径（系统弹框/拖拽，Windows 下带反斜杠），不能走 root-rel 的 fsBasename */
export function flattenLocal(core: FsCore, paths: string[]): FsLocalFile[] {
  const out: FsLocalFile[] = []
  const cap = readUploadCap((k) => core.services.config.get(k))
  const full = (): boolean => cap > 0 && out.length >= cap // cap=0 不限
  const walk = (abs: string, rel: string): void => {
    if (full()) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.isFile()) {
      out.push({ name: rel.split('/').pop() ?? rel, localPath: abs, relPath: rel || localBasename(abs), size: st.size })
      return
    }
    if (!st.isDirectory()) return
    let names: string[] = []
    try { names = readdirSync(abs).sort() } catch { return }
    for (const name of names) {
      if (full()) return
      walk(join(abs, name), rel ? `${rel}/${name}` : name)
    }
  }
  for (const raw of Array.isArray(paths) ? paths.slice(0, 100) : []) {
    const abs = String(raw ?? '')
    if (!abs || !existsSync(abs)) continue
    walk(abs, localBasename(abs))
  }
  return out
}
