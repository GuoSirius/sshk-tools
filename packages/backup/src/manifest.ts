import type { CollectionName } from '@sshk/repository'

export const SCHEMA_VERSION = 1

export interface SecretKdf {
  /** 派生算法；当前固定 PBKDF2-SHA256（Argon2 需原生依赖，暂不引入） */
  algo: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  nonce: string
}

export interface BackupManifest {
  schemaVersion: number
  appVersion: string
  /** 北京时间 ISO 8601 带 +08:00（@sshk/shared/time） */
  exportedAt: string
  sourceOS: string
  includes: string[]
  counts: Partial<Record<CollectionName, number>>
  /** excluded | encrypted（D18） */
  secrets: 'excluded' | 'encrypted'
  secretKdf: SecretKdf | null
  /** 对全部条目（排序后 名称+内容）计算的 sha256 */
  checksum: string
}

export const README_TEXT = `sshk-tools 备份包

- 本包内路径全部为相对路径；导入时按目标机「产物目录」重新映射（数据契约 §4.4）。
- settings/app.json 中的 outputDir 为机器相关设置，导入时被忽略并保留本机值。
- secrets.enc 仅在导出端开启 SSHK_TOOLS_ALLOW_SECRET_MIGRATION=1 且输入迁移口令时存在；
  导入端需同一开关与口令才能还原，否则跳过密钥（其余数据照常导入）。
- 导入采用整包覆盖（D17）；导入前应用会自动生成 pre-import 快照，可回滚。
- 还原后需手动补：右键菜单重新注册、开机自启开关。
`
