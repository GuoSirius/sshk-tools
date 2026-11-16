import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { byNewestFirst, isImageFileName } from '../image-files'
import type { UploadedImageInfo, UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

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

  /** 列出目录下已有图片（新在前）；目录不存在视为空库 */
  async listImages(ctx: UploadContext & { limit?: number }): Promise<UploadedImageInfo[]> {
    const dir = path.resolve(ctx.overrides?.localDir || this.options.defaultDir || '.')
    if (!existsSync(dir)) return []
    const limit = ctx.limit ?? 200
    const out: UploadedImageInfo[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= limit) break
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
      out.push({ url: pathToFileURL(full).href, key: entry.name, name: entry.name, size, modified })
    }
    return out.sort(byNewestFirst)
  }
}
