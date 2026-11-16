import { ElMessage } from 'element-plus'
import type { RichTextImageLibrary, RichTextImageSource, RichTextImageTarget, RichTextUploadHook } from '@sshk/rich-text'
import { extractInlineImages, replaceInlineImages, replacementFor } from '../core/inline-images.js'
import { beginUploadSession, endUploadSession } from './upload-progress'
import { host } from './host'

/**
 * C2 唯一注入点：EDM 把共享上传能力接给富文本 / 图片字段。
 * rich-text 包不 import upload-core，只通过 onUploadImage 回调拿 URL；
 * 本文件是工具侧唯一实现，密钥、profile、校验都在 main 进程。
 *
 * toolId 由宿主 :tool-id 注入、经 useToolId() 取用后传入，源码不再硬编码工具 ID。
 *
 * 图片库桥接（2026-11-16 ④⑤）：富文本图片菜单可选 本地 / 远程 / 云 来源，
 * 支持专属桶/目录覆盖，上传后插入；也可列出该来源已有图片挑选插入。
 * 本地默认项 id 用 __local__（非真实 profile，type=local 时 profileId 不下发）。
 */
const LOCAL_SOURCE_ID = '__local__'
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 上传失败（如尚未配置通道）时回退 dataURL，保证离线编辑不被阻断 */
export function createImageUploader(toolId: string): RichTextUploadHook {
  return async (file: File): Promise<string> => {
    const dataUrl = await readAsDataUrl(file)
    beginUploadSession(1)
    try {
      const result = await host.upload.single({
        toolId,
        name: file.name,
        size: file.size,
        mime: file.type,
        dataUrl,
      })
      return result.url
    } catch (err) {
      ElMessage.warning(`上传未成功，已保留本地图片：${(err as Error).message}`)
      return dataUrl
    } finally {
      endUploadSession()
    }
  }
}

/**
 * T8：把历史数据里残留的内联图片批量上传，并回写为内容资源 URL。
 * 逐张上传（失败保留原 data: 不阻断生成），最后统一替换，避免边传边改字符串。
 */
export async function uploadInlineImages(html: string, toolId: string): Promise<string> {
  const images = extractInlineImages(html)
  if (images.length === 0) return html
  beginUploadSession(images.length)
  const pairs: { raw: string; replacement: string }[] = []
  try {
    for (const img of images) {
      try {
        const result = await host.upload.single({
          toolId,
          name: img.name,
          size: img.size,
          mime: img.mime,
          dataUrl: img.dataUrl,
        })
        pairs.push({ raw: img.raw, replacement: replacementFor(img, result.url) })
      } catch {
        // 单张失败不影响其余图片，也不阻断保存
      }
    }
  } finally {
    endUploadSession()
  }
  return replaceInlineImages(html, pairs)
}

interface ProfileOption {
  id: string
  name: string
  targetType: 'local' | 'remote' | 'cloud'
  label: string
}

/** 富文本「图片库」桥接：来源 = 本地默认 + 已配置远程/云 profile；密钥解析全在 main */
export function createImageLibrary(toolId: string): RichTextImageLibrary {
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
        ...profiles.map((p) => ({ id: p.id, type: p.targetType, label: p.label })),
      ]
    },
    async upload(file, source, target, onProgress) {
      onProgress?.({ percent: 0, status: 'uploading' })
      try {
        const dataUrl = await readAsDataUrl(file)
        const result = await host.upload.single({ ...requestOf(source, target ?? {}), name: file.name, size: file.size, mime: file.type, dataUrl })
        onProgress?.({ percent: 100, status: 'success' })
        return result.url
      } catch (err) {
        // 失败由 reject 表达，UI 据此标记该项并可重试/删除
        throw err
      }
    },
    async list(source, target, limit) {
      const items = (await host.upload.listImages({ ...requestOf(source, target ?? {}), limit })) as {
        url: string
        name: string
        key?: string
        size?: number
        modified?: number
      }[]
      return items.map((i) => ({ url: i.url, name: i.name, size: i.size, modified: i.modified, key: i.key }))
    },
  }
}
