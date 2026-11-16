import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { byNewestFirst, isImageFileName } from '../image-files'
import { joinDir, MAX_DIRECTORIES, MAX_DIRECTORY_DEPTH, normalizeDirPath } from '../directories'
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
   * 列出目录下已有图片（新在前）；目录不存在视为空库。
   * cursor 为上一页返回的偏移量（字符串数字），大目录由调用方按页续拉。
   */
  async listImages(ctx: UploadContext & { limit?: number; cursor?: string | null }): Promise<UploadedImagePage> {
    const dir = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    if (!existsSync(dir)) return { items: [] }
    const limit = ctx.limit ?? 500
    const offset = Math.max(0, Math.floor(Number(ctx.cursor) || 0))
    const all: UploadedImageInfo[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !isImageFileName(entry.name)) continue
      const full = path.join(dir, entry.name)
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
    all.sort(byNewestFirst)
    const items = all.slice(offset, offset + limit)
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null
    return { items, nextCursor }
  }

  /** 列出根目录下所有真实子目录的完整相对路径（可多级，含空目录），带深度/数量上限 */
  async listDirectories(ctx: UploadContext): Promise<string[]> {
    const root = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    if (!existsSync(root)) return []
    const out: string[] = []
    const walk = (dir: string, relative: string, depth: number): void => {
      if (depth > MAX_DIRECTORY_DEPTH || out.length >= MAX_DIRECTORIES) return
      let entries: { name: string; isDirectory(): boolean }[]
      try {
        entries = readdirSync(dir, { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[]
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= MAX_DIRECTORIES) return
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const full = joinDir(relative, e.name)
        out.push(full)
        walk(path.join(dir, e.name), full, depth + 1)
      }
    }
    walk(root, normalizeDirPath(''), 0)
    return out.sort((a, b) => a.localeCompare(b))
  }
}
