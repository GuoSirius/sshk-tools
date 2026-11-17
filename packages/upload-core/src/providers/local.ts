import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { byNewestFirst, isImageFileName } from '../image-files'
import { MAX_DIRECTORIES, MAX_LIST_DEPTH, MAX_LIST_FILES } from '../directories'
import type { UploadedImageInfo, UploadedImagePage, UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

/** T3：本地目录 Provider（最快打通的链路）。全局默认目录 + 工具级 localDir 覆盖 */
export interface LocalProviderOptions {
  defaultDir: string
}

export class LocalUploadProvider implements UploadProvider {
  readonly type = 'local' as const

  constructor(private readonly options: LocalProviderOptions) {}

  async upload(file: UploadFile, ctx: UploadContext): Promise<UploadResult> {
    const dir = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    mkdirSync(dir, { recursive: true })
    const name = path.basename(file.name)
    const target = path.join(dir, name)
    if (file.source && existsSync(file.source)) copyFileSync(file.source, target)
    else writeFileSync(target, file.data ?? Buffer.alloc(0))
    return { url: pathToFileURL(target).href, key: name, name: file.name }
  }

  /**
   * 递归列出目录（含全部子目录）下的已有图片（新在前）；目录不存在视为空库。
   * 与云来源的前缀列举语义一致：选中父目录 = 看到自己 + 所有层级子目录的图。
   * cursor 为上一页返回的偏移量（字符串数字），大目录由调用方按页续拉。
   */
  async listImages(ctx: UploadContext & { limit?: number; cursor?: string | null }): Promise<UploadedImagePage> {
    const dir = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    if (!existsSync(dir)) return { items: [] }
    const all: UploadedImageInfo[] = []
    const walk = (cur: string, depth: number): void => {
      if (depth > MAX_LIST_DEPTH || all.length >= MAX_LIST_FILES) return
      let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[]
      try {
        entries = readdirSync(cur, { withFileTypes: true }) as unknown as {
          name: string
          isFile(): boolean
          isDirectory(): boolean
        }[]
      } catch {
        return
      }
      for (const entry of entries) {
        if (all.length >= MAX_LIST_FILES) return
        if (entry.name.startsWith('.')) continue
        const full = path.join(cur, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (entry.isFile() && isImageFileName(entry.name)) {
          let size = 0
          let modified = 0
          try {
            const st = statSync(full)
            size = st.size
            modified = st.mtimeMs
          } catch {
            continue
          }
          all.push({ url: pathToFileURL(full).href, key: entry.name, name: entry.name, size, modified })
        }
      }
    }
    walk(dir, 0)
    all.sort(byNewestFirst)
    const limit = ctx.limit ?? 500
    const offset = Math.max(0, Math.floor(Number(ctx.cursor) || 0))
    const items = all.slice(offset, offset + limit)
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null
    return { items, nextCursor }
  }

  /** 列出某目录下的直接子目录（单级，配合前端懒加载逐级下钻）；返回绝对文件系统路径 */
  async listDirectories(ctx: UploadContext): Promise<string[]> {
    const dir = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    if (!existsSync(dir)) return []
    let entries: { name: string; isDirectory(): boolean }[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[]
    } catch {
      return []
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_DIRECTORIES)
  }
}
