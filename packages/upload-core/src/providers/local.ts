import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { UploadContext, UploadFile, UploadProvider, UploadResult } from '../types'

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
}
