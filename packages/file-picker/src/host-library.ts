/**
 * 通用「宿主上传能力」图片/文件库桥接（plans/11 §七 S2：单一实现，三处共用）。
 * file-picker 不依赖 upload-core / 任何工具的 host；这里定义最小宿主接口，由工具把
 * createSafeHost 的 upload 通道注入进来（EDM / 模板工具 / 内容管理共用本实现）。
 * 密钥与 profile 解析全在 main 进程，渲染层只拿 profile 概要与上传结果。
 */
import type {
  FilePickerLibrary,
  FilePickerSource,
  FilePickerTarget,
  FilePickerItem,
  FilePickerPage,
  FilePickerKind,
} from './types'

const LOCAL_SOURCE_ID = '__local__'

/** 工具注入的最小宿主上传接口（对应各工具 createSafeHost 的 upload 段） */
export interface HostUploadBridge {
  profiles(): Promise<unknown>
  single(req: Record<string, unknown>): Promise<unknown>
  listImages(req: Record<string, unknown>): Promise<unknown>
  listDirectories(req: Record<string, unknown>): Promise<unknown>
}

interface ProfileOption {
  id: string
  name?: string
  targetType: 'local' | 'remote' | 'cloud'
  label?: string
}

export interface HostImageLibraryOptions {
  /** 是否把 local 型 profile 也列为独立来源（EDM 历史行为=yes；模板工具=no）。缺省 false */
  includeLocalProfiles?: boolean
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 单一桥接实现：来源 = 本地默认 + 已配置远程/云 profile；上传/列图/列目录均透传宿主。 */
export function createHostImageLibrary(
  toolId: string,
  upload: HostUploadBridge,
  opts: HostImageLibraryOptions = {},
): FilePickerLibrary {
  const requestOf = (source: FilePickerSource, target?: FilePickerTarget) => ({
    toolId,
    targetType: source.type,
    profileId: source.type === 'local' ? undefined : source.id,
    overrides: {
      localDir: target?.localDir || undefined,
      remotePath: target?.remotePath || undefined,
      bucket: target?.bucket || undefined,
      prefix: target?.prefix || undefined,
    },
  })

  return {
    async sources(): Promise<FilePickerSource[]> {
      const profiles = (await upload.profiles()) as ProfileOption[]
      return [
        { id: LOCAL_SOURCE_ID, type: 'local', label: '本地（应用默认上传目录）' },
        ...profiles
          .filter((p) => opts.includeLocalProfiles || p.targetType !== 'local')
          .map((p) => ({ id: p.id, type: p.targetType, label: p.label || p.name || p.id })),
      ]
    },
    async upload(file, source, target, onProgress) {
      onProgress?.({ percent: 0, status: 'uploading' })
      try {
        const dataUrl = await readAsDataUrl(file)
        const result = await upload.single({
          ...requestOf(source, target ?? {}),
          name: file.name,
          size: file.size,
          mime: file.type,
          dataUrl,
        }) as { url: string }
        onProgress?.({ percent: 100, status: 'success' })
        return result.url
      } catch (err) {
        throw err
      }
    },
    async list(source, target, listOpts?: { limit?: number; cursor?: string; kind?: FilePickerKind }): Promise<FilePickerPage> {
      const page = await upload.listImages({
        ...requestOf(source, target ?? {}),
        limit: listOpts?.limit,
        cursor: listOpts?.cursor,
        kind: listOpts?.kind,
      }) as {
        items: { url: string; name?: string; key?: string; size?: number; modified?: number }[]
        nextCursor?: string | null
      }
      const items: FilePickerItem[] = page.items.map((i) => ({
        url: i.url, name: i.name, size: i.size, modified: i.modified, key: i.key,
      }))
      return { items, nextCursor: page.nextCursor ?? null }
    },
    async listDirectories(source, target) {
      return (await upload.listDirectories(requestOf(source, target ?? {}))) as string[]
    },
  }
}
