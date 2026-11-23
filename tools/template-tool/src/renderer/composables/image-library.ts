import { createHostImageLibrary, type FilePickerLibrary } from '@sshk/file-picker'
import { host } from '../host'

/**
 * 模板工具的图片库桥接：收敛到 @sshk/file-picker 单一实现（plans/11 §七 S2）。
 * 默认过滤 local 型 profile（仅保留本地默认项 + 远程/云），与既有行为一致。
 */
export function createTemplateImageLibrary(toolId: string): FilePickerLibrary {
  return createHostImageLibrary(toolId, host.upload)
}
