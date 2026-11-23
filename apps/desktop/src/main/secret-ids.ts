import { AppError } from '@sshk/shared'
/**
 * 密钥标识校验（纯函数，无 Electron / Node 依赖，便于单测）。
 * 工具名、密钥名允许大小写字母 / 数字 / 连字符 / 下划线：
 * 早期正则只允许小写，导致 `visionApiKey` 这类驼峰名被判非法。
 */
const SECRET_PART_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const PROVIDER_ID_RE = /^prv_[0-9a-z]+$/

/** 工具专属密钥统一起 app:tool: 前缀，导出备份时自动排除，不混进 Provider 密钥 */
export function toolSecretId(toolId: string, name: string): string {
  if (!SECRET_PART_RE.test(toolId) || !SECRET_PART_RE.test(name)) {
    throw new AppError(`非法工具密钥标识: ${toolId}/${name}`)
  }
  return `app:tool:${toolId}:${name}`
}

/**
 * 上传通道密钥（应用级命名空间，2026-11-19 用户拍板提升）：
 * 通道 profile 数据在应用级（app.upload，消费方含 EDM 图片上传 / 模板工具图片库 / 预设导出），
 * 密钥同挂应用级，工具改名/卸载不牵连这些能力。
 */
export function uploadSecretId(profileId: string): string {
  if (!SECRET_PART_RE.test(profileId)) {
    throw new AppError(`非法上传密钥标识: ${profileId}`)
  }
  return `app:upload:${profileId}`
}

export function isProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id)
}
