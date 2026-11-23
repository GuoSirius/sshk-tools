import { createHostImageLibrary, resolveLastUploadTarget, type FilePickerLibrary } from '@sshk/file-picker'
import { dataUrlToFile, extractInlineImages, replaceInlineImages, replacementFor } from '../core/inline-images.js'
import { beginUploadSession, endUploadSession } from './upload-progress'
import { host } from './host'

/**
 * C2 唯一注入点：EDM 把共享上传能力全部收敛到 @sshk/file-picker。
 * 富文本工具栏 / 粘贴上传 / 图片字段 / favicon 均走 FilePickerDialog + library.upload（请求级目标），
 * 不再依赖工具级上传配置（targetType/profileId/overrides 已从 manifest 删除，只留 validation）。
 *
 * toolId 由宿主 :tool-id 注入、经 useToolId() 取用后传入，源码不硬编码工具 ID。
 * 图片库桥接：本地默认项 id 用 __local__（type=local 时 profileId 不下发）；
 * EDM 历史行为把 local 型 profile 也列为独立来源，故 includeLocalProfiles=true。
 */
/** 富文本「图片库」桥接：收敛到 @sshk/file-picker 单一实现（plans/11 §七 S2）。 */
export function createImageLibrary(toolId: string): FilePickerLibrary {
  return createHostImageLibrary(toolId, host.upload, { includeLocalProfiles: true })
}

/**
 * T8：把历史数据里残留的内联 data: 图片批量上传，并回写为内容资源 URL。
 * 无用户交互时机（保存流程内静默执行），故复用 FilePicker 上次保存的目标
 * （resolveLastUploadTarget：无记录回落默认源）；单张失败保留原 data: 不阻断保存。
 * 全批走 library.upload（请求级 target），彻底摆脱工具级上传配置。
 */
export async function uploadInlineImages(html: string, toolId: string): Promise<string> {
  const images = extractInlineImages(html)
  if (images.length === 0) return html
  const library = createImageLibrary(toolId)
  // D58 全局统一位置记忆：直接读全局「上次位置」，无记录回落默认源。
  // 读不到（无任何来源）时保留原内联图片，不阻断保存。
  const picked = await resolveLastUploadTarget(library)
  if (!picked) return html
  beginUploadSession(images.length)
  const pairs: { raw: string; replacement: string }[] = []
  try {
    for (const img of images) {
      try {
        const url = await library.upload(dataUrlToFile(img.dataUrl, img.name, img.mime), picked.source, picked.target)
        pairs.push({ raw: img.raw, replacement: replacementFor(img, url) })
      } catch {
        // 单张失败不影响其余图片，也不阻断保存
      }
    }
  } finally {
    endUploadSession()
  }
  return replaceInlineImages(html, pairs)
}
