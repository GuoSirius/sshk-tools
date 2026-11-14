/**
 * 运行时工具包信任模型（逻辑层）。
 *
 * 三重机制叠加、互不替代：
 *   TOFU 指纹     -> installed.json 的 sha256，回答「装完后有没有被换过」
 *   官方内置公钥   -> 回答「是不是官方发的」（数据单独维护在 ./official-keys.json）
 *   用户导入公钥   -> 回答「第三方发布者我认不认」
 * 哈希白名单是本机 installed.json，不是全局白名单。
 *
 * 公钥是数据、不是代码：多设备/轮换时只改 official-keys.json，不动本文件与任何逻辑。
 *
 * ── 规范签名对象（唯一裁决方，签名侧与验签侧必须严格一致）──────────────────
 *   canonicalManifestText(raw) = JSON.parse 后删除 package.signature，再 JSON.stringify(obj, null, 2) + '\n'
 *   payload = canonicalManifestText + '\n' + 其余文件（排除 tool.manifest.json 自身与 SIGNATURE）
 *             的 `name:sha256` 按 name 排序后的清单
 *
 *   为什么剔除 package.signature 且排除 manifest 自身哈希：
 *     签名值最终写回 manifest.package.signature，若它参与签名对象就构成「签名覆盖签名自身」
 *     的循环依赖，数学上永远验不过。manifest 已由 payload 第一行原文整体覆盖，再算一次哈希是冗余。
 *
 *   实现位置：
 *     签名侧 scripts/lib/tool-package.mjs::buildSignaturePayload（sign-tool / check-signature 共用）
 *     验签侧 apps/desktop/src/main/runtime-installer.ts::verifySignature
 *   SIGNATURE 文件内容：两行 —— keyId / base64 签名值。
 */

import officialKeys from './official-keys.json'

/** 宿主能力 API 版本；外部包 requiresHost.api 不满足则拒绝安装 */
export const HOST_API_VERSION = '1.0.0'
/** 宿主当前能读懂的 manifest 结构版本 */
export const TOOL_PACKAGE_SCHEMA_VERSION = 1
/** 分发包扩展名（zip 归档） */
export const TOOL_PACKAGE_EXT = '.sshktool'

/**
 * 官方 Ed25519 公钥：数据唯一真相源是 ./official-keys.json，此处只做导入与类型收窄。
 * 登记在此即 `official` 信任层级，接收方安装时无需手动导入公钥。
 * 支持多把并存与轮换：往 JSON 数组追加一条即可；keyId = 公钥 PEM 的 sha256（由 pnpm keys:init 生成并校验）。
 * 私钥绝不入库：只存于本机用户级 ~/.sshk/official-signing-key.pem 或环境变量 / CI Secret；
 * 每台设备各持一把、公钥多把并存（换设备见 docs/05-release/官方签名密钥跨设备开发.md）。
 *
 * 注意：本模块会被渲染层 import，因此这里保持纯数据，不引入 node:crypto 等 Node 专有依赖。
 */
export const OFFICIAL_PUBLIC_KEYS: readonly { keyId: string; pem: string; since: string }[] = officialKeys

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
