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
    throw new Error(`非法工具密钥标识: ${toolId}/${name}`)
  }
  return `app:tool:${toolId}:${name}`
}

export function isProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id)
}
