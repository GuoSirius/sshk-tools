/**
 * 运行时工具包信任模型（契约层，本轮不含实现）。
 *
 * 三重机制叠加、互不替代：
 *   TOFU 指纹     -> installed.json 的 sha256，回答「装完后有没有被换过」
 *   官方内置公钥   -> 回答「是不是官方发的」
 *   用户导入公钥   -> 回答「第三方发布者我认不认」
 * 签名对象 = manifest + 整包哈希；哈希白名单是本机 installed.json，不是全局白名单。
 */

/** 宿主能力 API 版本；外部包 requiresHost.api 不满足则拒绝安装 */
export const HOST_API_VERSION = '1.0.0'
/** 宿主当前能读懂的 manifest 结构版本 */
export const TOOL_PACKAGE_SCHEMA_VERSION = 1
/** 分发包扩展名（zip 归档） */
export const TOOL_PACKAGE_EXT = '.sshktool'

/**
 * 官方 Ed25519 公钥（PEM）。当前为空：官方签名体系上线时在此登记，支持多把并存与轮换。
 * keyId 用于匹配包内 signature.keyId；不把私钥、不把校验逻辑放进渲染层。
 */
export const OFFICIAL_PUBLIC_KEYS: readonly { keyId: string; pem: string; since: string }[] = []

export type TrustLevel = 'official' | 'user-imported' | 'tofu' | 'unsigned'

export interface ImportedPublicKey {
  keyId: string
  pem: string
  label: string
  importedAt: string
}

export interface InstalledPackageRecord {
  id: string
  version: string
  /** 整包 SHA-256：TOFU 指纹，升级时必须重新确认 */
  sha256: string
  trustLevel: TrustLevel
  sandbox: 'main' | 'utility'
  installedAt: string
  signatureKeyId?: string
}

/**
 * 加载位置裁决（决策矩阵，纯函数）：
 * 只有「签名有效 + 公钥可信 + 用户显式信任」才允许进主进程；
 * 未签名 / 校验失败一律 utility 沙箱，不允许隐式提权。
 */
export function canLoadInMain(input: {
  signatureValid: boolean
  keyTrusted: boolean
  explicitlyTrusted: boolean
}): boolean {
  return input.signatureValid && input.keyTrusted && input.explicitlyTrusted
}

/** 外部包默认沙箱；builtin 缺省 package 时仍走 main */
export const EXTERNAL_DEFAULT_SANDBOX = 'utility' as const
