import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError, fsFormatSize, type FsReadMediaResult } from '@sshk/shared'
import { fsBasename } from '@sshk/upload-core'
import { beginMediaDownload, finishMediaDownload, updateMediaDownload } from '../../media-stream'
import { logger } from '../../logger'
import type { FsCore } from './runtime'

/**
 * 音视频在线播放（2026-11-19 · P3-3 自 fs.ts 拆出）：
 * 流式落临时文件返回 localres:// URL，边下边播；临时目录启动清理 24h 前残留。
 * 临时目录：系统 temp 下 sshk-media（播放器经 localres:// 回放，关闭后不即删，启动清理）。
 */

/** 启动清理 24h 前残留播放文件 */
export function cleanMediaTemp(): void {
  try {
    const dir = join(os.tmpdir(), 'sshk-media')
    if (!existsSync(dir)) return
    const cutoff = Date.now() - 24 * 3600 * 1000
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      try { if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true }) } catch { /* 单个失败忽略 */ }
    }
  } catch { /* 清理失败不影响功能 */ }
}

export async function readMedia(core: FsCore, req: { profileId: string; path: string }): Promise<FsReadMediaResult> {
  const { driver, channel } = core.resolve(req?.profileId)
  const p = core.assertPath(req?.path)
  if (p === '/') throw new AppError('目录没有可读内容', 'io')
  const stat = await driver.stat(p)
  if (!stat.exists || stat.isDir) throw new AppError('文件不存在（可能已被删除）', 'io')
  const total = stat.size ?? 0
  const safeName = fsBasename(p).replace(/[\\/:*?"<>|]+/g, '_')
  const dir = join(os.tmpdir(), 'sshk-media')
  mkdirSync(dir, { recursive: true })
  const destFile = join(dir, `${Date.now().toString(36)}-${safeName}`)

  // 边下边播（用户 2026-11-19）：注册会话后立即返回 localres URL，后台边下边写；
  // localres handler 见会话 streaming 时等字节就绪，浏览器收到首段即可开播，无需等全量。
  beginMediaDownload(destFile, total)
  let lastEmit = 0
  void driver.download(p, destFile, (uploaded) => {
    updateMediaDownload(destFile, uploaded)
    // 进度事件节流（100ms），避免高频推送
    const now = Date.now()
    if (now - lastEmit >= 100) {
      lastEmit = now
      core.onMediaEvent?.({ key: destFile, uploaded, total, done: false })
    }
  }).then(() => {
    finishMediaDownload(destFile)
    core.onMediaEvent?.({ key: destFile, uploaded: total, total, done: true })
    logger.info('upload', `fs 在线播放下载完成：${channel.id}/${p} → 临时文件（${fsFormatSize(total)}）`)
  }).catch((err: Error) => {
    finishMediaDownload(destFile, err.message)
    core.onMediaEvent?.({ key: destFile, uploaded: 0, total, done: true, error: err.message })
    logger.warn('upload', `fs 在线播放下载失败：${channel.id}/${p} - ${err.message}`)
  })

  // file:// 被 app:///http:// 渲染层拦截，改走 localres://（白名单 + Range + 边下边播）
  return {
    fileUrl: pathToFileURL(destFile).href.replace(/^file:\/\//i, 'localres://'),
    size: total,
    mediaKey: destFile,
  }
}
