import { zipSync, unzipSync } from 'fflate'
import { fsBasename } from '@sshk/upload-core'
import {
  AppError,
  fsFormatSize,
  isFsZipName,
  type FsUnzipRequest,
  type FsUnzipResult,
  type FsZipRequest,
  type FsZipResult,
} from '@sshk/shared'
import { logger } from '../../logger'
import type { FsCore } from './runtime'

/**
 * 压缩/解压与遗留分片清理（P3-3 自 fs.ts 拆出）：
 * zip/unzip（仅本地通道 + 可选跨源解压，内存型操作防 OOM 上限可配）+ cleanOrphanUploads（崩溃遗留 uploadId 手动清理）。
 */

/** zip 压缩/解压上限的可配置键与缺省值（内存型操作，防 OOM；渲染层可在「压缩上限设置」调整） */
const CFG_ZIP_FILE_CAP = 'app.fs.zipFileCap'
const CFG_ZIP_BYTES_CAP = 'app.fs.zipBytesCap'
const FS_ZIP_FILE_CAP_DEFAULT = 3000
const FS_ZIP_BYTES_CAP_DEFAULT = 500 * 1024 * 1024
/** 配置读取后的合法区间钳制（防止误填离谱值） */
const FS_ZIP_FILE_CAP_MIN = 10
const FS_ZIP_FILE_CAP_MAX = 100_000
const FS_ZIP_BYTES_CAP_MIN = 1024 * 1024
const FS_ZIP_BYTES_CAP_MAX = 4 * 1024 * 1024 * 1024

/** 从配置读 zip 上限（缺省/非法回落默认值并钳制到合法区间） */
function readZipCaps(get: (key: string) => unknown): { fileCap: number; bytesCap: number } {
  const fileCap = Math.min(
    FS_ZIP_FILE_CAP_MAX,
    Math.max(FS_ZIP_FILE_CAP_MIN, Math.floor(Number(get(CFG_ZIP_FILE_CAP)) || FS_ZIP_FILE_CAP_DEFAULT)),
  )
  const bytesCap = Math.min(
    FS_ZIP_BYTES_CAP_MAX,
    Math.max(FS_ZIP_BYTES_CAP_MIN, Math.floor(Number(get(CFG_ZIP_BYTES_CAP)) || FS_ZIP_BYTES_CAP_DEFAULT)),
  )
  return { fileCap, bytesCap }
}

/** 压缩为 zip（仅本地通道）：sources 递归收集文件 → fflate zipSync → 写回当前目录 */
export async function zip(core: FsCore, req: FsZipRequest): Promise<FsZipResult> {
  const { driver, channel } = core.resolve(req?.profileId)
  if (channel.type !== 'local') throw new AppError('压缩仅支持本地目录通道', 'io')
  const zipPath = core.assertPath(req?.zipPath)
  if (!/\.zip$/i.test(zipPath)) throw new AppError('压缩包名须以 .zip 结尾')
  const exists = await driver.stat(zipPath)
  if (exists.exists) throw new AppError('同名压缩包已存在，请换一个名字', 'io')
  const { fileCap, bytesCap } = readZipCaps((k) => core.services.config.get(k))
  const zipData: Record<string, Uint8Array> = {}
  let files = 0
  let bytes = 0

  const addFile = async (rel: string, zipRel: string): Promise<void> => {
    if (files >= fileCap) throw new AppError(`超过单次压缩 ${fileCap} 个文件上限，已中止`, 'io')
    const { data } = await driver.readBuffer(rel)
    if (bytes + data.length > bytesCap) {
      throw new AppError(`超过单次压缩 ${fsFormatSize(bytesCap)} 上限，已中止`)
    }
    zipData[zipRel] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    files++
    bytes += data.length
  }
  const addTree = async (srcRel: string, zipBase: string): Promise<void> => {
    let cursor: string | null = null
    do {
      const page = await driver.list(srcRel, { pageSize: 2000, cursor })
      for (const e of page.entries) {
        if (e.kind === 'file') await addFile(e.path, zipBase ? `${zipBase}/${e.name}` : e.name)
        else await addTree(e.path, zipBase ? `${zipBase}/${e.name}` : e.name)
      }
      cursor = page.nextCursor ?? null
    } while (cursor)
  }
  for (const item of (req?.sources ?? []).slice(0, 200)) {
    const src = core.assertPath(item.path)
    if (src === '/') throw new AppError('根目录不可压缩', 'io')
    if (item.kind === 'file') await addFile(src, fsBasename(src))
    else await addTree(src, fsBasename(src))
  }
  if (!files) throw new AppError('没有可压缩的内容')
  const zipped = zipSync(zipData, { level: 6 })
  await driver.write(zipPath, Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength))
  logger.info('upload', `fs 压缩：${channel.id}/${zipPath}（${files} 个文件 / ${fsFormatSize(zipped.length)}）`)
  return { zipPath, files, size: zipped.length }
}

/** 解压 zip（仅本地通道）：解到 zip 同级 `<zip 名去扩展名>/`，防路径穿越 */
export async function unzip(core: FsCore, req: FsUnzipRequest): Promise<FsUnzipResult> {
  const { driver: srcDriver } = core.resolve(req?.profileId)
  const zipPath = core.assertPath(req?.path)
  if (!isFsZipName(zipPath)) throw new AppError('仅支持 .zip 压缩包')
  const stat = await srcDriver.stat(zipPath)
  if (!stat.exists || stat.isDir) throw new AppError('压缩包不存在', 'io')
  const { fileCap, bytesCap } = readZipCaps((k) => core.services.config.get(k))
  if ((stat.size ?? 0) > bytesCap) throw new AppError(`压缩包过大（${fsFormatSize(stat.size)} 超过上限）`)
  const { data } = await srcDriver.readBuffer(zipPath)
  const entries = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  // 安全检查前置：防路径穿越（任何非法条目直接中止，未解出任何文件）
  for (const name of Object.keys(entries)) {
    if (/^[\\/]/.test(name) || name.includes('..') || name.includes('\\')) {
      throw new AppError(`压缩包含非法路径条目：${name}（已中止，未解出任何文件）`, 'io')
    }
  }
  // 目标通道：可选跨源（用户 2026-11-19）；目标目录不存在自动创建
  const dest = core.resolve(req?.destProfileId || req?.profileId)
  if (!dest.driver.writable) throw new AppError(`通道「${dest.channel.name}」不支持写操作（当前仅阿里云 OSS / AWS S3 支持写）`)
  const zipParent = zipPath.lastIndexOf('/') <= 0 ? '/' : zipPath.slice(0, zipPath.lastIndexOf('/'))
  const destDirRaw = String(req?.destDir ?? '').trim()
  let destDir: string
  if (destDirRaw) {
    destDir = core.assertPath(destDirRaw)
  } else {
    const destName = String(req?.destDirName ?? '').trim() || fsBasename(zipPath).replace(/\.zip$/i, '')
    if (/[\\/]/.test(destName) || destName === '.' || destName === '..') throw new AppError('解压目标目录名不能包含斜杠或路径段', 'io')
    destDir = zipParent === '/' ? `/${destName}` : `${zipParent}/${destName}`
  }
  if (destDir === '/') throw new AppError('目标目录不能为根目录', 'io')
  const dst = await dest.driver.stat(destDir)
  if (dst.exists && !dst.isDir) throw new AppError('目标路径已存在且不是目录', 'io')
  if (dst.exists && !req?.overwrite) {
    // 冲突预检（用户 2026-11-19）：顶层条目与目标目录已有条目同名 → 抛标记错误，渲染层覆盖确认后重试
    const topNames = new Set(Object.keys(entries).map((n) => n.replace(/\/+$/, '').split('/')[0] ?? ''))
    try {
      const page = await dest.driver.list(destDir, { pageSize: 1000 })
      const conflicts = [...topNames].filter((n) => page.entries.some((e) => e.name === n))
      if (conflicts.length) {
        throw new AppError(`__UNZIP_CONFLICT__:${conflicts.slice(0, 8).join('、')}${conflicts.length > 8 ? ` …共 ${conflicts.length} 个` : ''}`)
      }
    } catch (e) {
      if (String((e as Error).message).startsWith('__UNZIP_CONFLICT__')) throw e
      // 目标目录列取失败：不阻断，退化为直接覆盖写
    }
  } else if (!dst.exists) {
    await dest.driver.mkdir(destDir) // 自动创建（用户 2026-11-19）
  }
  let files = 0
  let bytes = 0
  for (const [name, content] of Object.entries(entries)) {
    if (bytes + content.length > bytesCap) throw new AppError(`解压内容超过 ${fsFormatSize(bytesCap)} 上限，已中止`)
    if (files >= fileCap) throw new AppError(`解压内容超过 ${fileCap} 个文件上限，已中止`, 'io')
    if (name.endsWith('/')) {
      await dest.driver.mkdir(`${destDir}/${name.replace(/\/+$/, '')}`)
      continue
    }
    await dest.driver.write(`${destDir}/${name}`, Buffer.from(content.buffer, content.byteOffset, content.byteLength))
    files++
    bytes += content.length
  }
  logger.info('upload', `fs 解压：${zipPath} → ${dest.channel.id}/${destDir}（${files} 个文件 / ${fsFormatSize(bytes)}）`)
  return { destDir, files }
}

/** 压缩/解压上限（可配置；bytes 以 MB 供 UI 展示，内部按字节持久化） */
export function zipLimits(core: FsCore): { fileCap: number; bytesCapMb: number } {
  const { fileCap, bytesCap } = readZipCaps((k) => core.services.config.get(k))
  return { fileCap, bytesCapMb: Math.round(bytesCap / (1024 * 1024)) }
}

export function setZipLimits(core: FsCore, req: { fileCap?: number; bytesCapMb?: number }): { fileCap: number; bytesCapMb: number } {
  const cfg = core.services.config
  if (req?.fileCap != null) {
    const v = Math.floor(Number(req.fileCap))
    if (!Number.isFinite(v)) throw new AppError('文件数上限必须是数字', 'io')
    cfg.set(CFG_ZIP_FILE_CAP, Math.min(FS_ZIP_FILE_CAP_MAX, Math.max(FS_ZIP_FILE_CAP_MIN, v)))
  }
  if (req?.bytesCapMb != null) {
    const v = Math.floor(Number(req.bytesCapMb))
    if (!Number.isFinite(v)) throw new AppError('容量上限必须是数字')
    cfg.set(CFG_ZIP_BYTES_CAP, Math.min(FS_ZIP_BYTES_CAP_MAX, Math.max(FS_ZIP_BYTES_CAP_MIN, v * 1024 * 1024)))
  }
  return zipLimits(core)
}

/** 遗留分片手动清理：遍历可写云通道 abort 全部 in-progress uploadId（崩溃遗留；二次确认后调用） */
export async function cleanOrphanUploads(core: FsCore): Promise<number> {
  let cleaned = 0
  for (const ch of core.channels()) {
    if (ch.type !== 'cloud' || !ch.writable) continue
    try {
      const { driver } = core.resolve(ch.id)
      const mp = driver.multipart
      if (!mp?.listUploads) continue
      const ups = await mp.listUploads()
      for (const u of ups) {
        try {
          await mp.abort(u.key, u.uploadId)
          cleaned++
        } catch { /* 单个失败不阻断（可能并发中被别的进程清掉） */ }
      }
    } catch { /* 通道不可用跳过 */ }
  }
  logger.info('upload', `fs 遗留分片清理：完成 ${cleaned} 个 uploadId`)
  return cleaned
}
