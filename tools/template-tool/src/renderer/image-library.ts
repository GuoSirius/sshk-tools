import type {
  RichTextImageLibrary,
  RichTextImageSource,
  RichTextImageTarget,
} from '@sshk/rich-text'
import { host } from './host'

/**
 * 模板工具的图片库桥接：宿主全局上传通道经 createSafeHost（H2 零裸调），
 * 与 EDM 的桥接实现同构（来源 = 本地默认 + 已配置远程/云 profile）。
 * 密钥解析全在 main 进程，渲染层只拿 profile 概要与上传结果。
 * 本地默认项 id 用 __local__（非真实 profile，type=local 时 profileId 不下发）。
 */
const LOCAL_SOURCE_ID = '__local__'

interface ProfileOption {
  id: string
  name: string
  targetType: 'local' | 'remote' | 'cloud'
  label: string
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function createTemplateImageLibrary(toolId: string): RichTextImageLibrary {
  const requestOf = (source: RichTextImageSource, target?: RichTextImageTarget) => ({
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
    async sources(): Promise<RichTextImageSource[]> {
      const profiles = (await host.upload.profiles()) as ProfileOption[]
      return [
        { id: LOCAL_SOURCE_ID, type: 'local', label: '本地（应用默认上传目录）' },
        ...profiles
          .filter((p) => p.targetType !== 'local')
          .map((p) => ({ id: p.id, type: p.targetType, label: p.label })),
      ]
    },
    async upload(file, source, target, onProgress) {
      onProgress?.({ percent: 0, status: 'uploading' })
      const dataUrl = await readAsDataUrl(file)
      const result = (await host.upload.single({
        ...requestOf(source, target ?? {}),
        name: file.name,
        size: file.size,
        mime: file.type,
        dataUrl,
      })) as { url: string; key?: string; name: string }
      onProgress?.({ percent: 100, status: 'success' })
      return result.url
    },
    async list(source, target, limit) {
      const items = (await host.upload.listImages({ ...requestOf(source, target ?? {}), limit })) as {
        url: string
        key: string
        name: string
        size?: number
        modified?: number
      }[]
      return items.map((i) => ({ url: i.url, name: i.name, size: i.size, modified: i.modified, key: i.key }))
    },
  }
}
