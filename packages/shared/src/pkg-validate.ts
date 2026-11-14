import { TOOL_PACKAGE_SCHEMA_VERSION } from './trust'
import { IPC_CHANNELS } from './ipc'
import type { ToolDescriptor, ToolPackageContract } from './types'

/**
 * .sshktool 导入包校验（纯函数层，阶段一）。
 *
 * 结构 / 契约 / Zip Slip / 白名单 —— 安装入口的第一道闸，安装前把畸形包拦下。
 * Ed25519 验签与 TOFU 指纹落库在 apps/desktop/src/main/runtime-installer.ts 完成。
 * 宿主不猜：所有拒绝都给出具体原因，UI 原样展示给用户。
 */

const CHANNEL_VALUES = new Set<string>(Object.values(IPC_CHANNELS))
/** 分发包允许出现的文件扩展名（源码分发型工具包） */
const ALLOWED_EXTS = new Set([
  '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.css', '.scss',
  '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.md', '.py', '.txt',
])
/** 允许的无扩展名文件：签名文件（两行 keyId / base64），带签名包必须能过结构闸 */
const ALLOWED_EXACT_FILES = new Set(['SIGNATURE'])
export const PACKAGE_FILE_LIMIT = 2000
export const PACKAGE_SIZE_LIMIT = 50 * 1024 * 1024

/** Zip Slip：解压条目禁止绝对路径、盘符、反斜杠、.. 穿越、空段 */
export function checkZipSlip(entryName: string): string | null {
  if (!entryName || entryName.endsWith('/')) return `空条目或目录占位: ${entryName}`
  if (/^[a-zA-Z]:/.test(entryName)) return `盘符绝对路径: ${entryName}`
  if (/^[/\\]/.test(entryName)) return `根路径绝对引用: ${entryName}`
  if (entryName.includes('\\')) return `反斜杠路径（仅允许 POSIX 分隔）: ${entryName}`
  const segments = entryName.split('/')
  if (segments.some((s) => s === '..')) return `路径穿越（..）: ${entryName}`
  if (segments.some((s) => s.trim() === '')) return `空路径段: ${entryName}`
  return null
}

export interface PackageFileEntry {
  name: string
  size: number
}

/** 包内容白名单：扩展名 / 文件数 / 总体积；返回违规原因列表（空 = 通过） */
export function assertAllowedFiles(files: PackageFileEntry[]): string[] {
  const errors: string[] = []
  if (files.length === 0) return ['包内没有任何文件']
  if (files.length > PACKAGE_FILE_LIMIT) errors.push(`文件数超上限（${files.length} > ${PACKAGE_FILE_LIMIT}）`)
  let total = 0
  for (const file of files) {
    const slip = checkZipSlip(file.name)
    if (slip) { errors.push(slip); continue }
    // 无扩展名文件（如 SIGNATURE）不能走 slice(-1)，否则会误取最后一个字符
    const dot = file.name.lastIndexOf('.')
    const ext = dot < 0 ? '' : file.name.slice(dot).toLowerCase()
    if (!ALLOWED_EXACT_FILES.has(file.name) && !ALLOWED_EXTS.has(ext)) {
      errors.push(`不允许的文件类型: ${file.name}`)
    }
    if (file.size > PACKAGE_SIZE_LIMIT) errors.push(`单文件超 50MB: ${file.name}`)
    total += file.size
  }
  if (total > PACKAGE_SIZE_LIMIT) errors.push(`包总体积超 50MB（${Math.round(total / 1024 / 1024)}MB）`)
  return errors
}

/**
 * 导入包契约校验：manifest 必填结构 + package 段（外部包必填）。
 * 返回错误列表（空 = 通过）；sandbox 只接受 utility，main 必须带签名。
 */
export function validateToolPackage(manifest: Partial<ToolDescriptor>): string[] {
  const errors: string[] = []
  if (!manifest || typeof manifest !== 'object') return ['manifest 不是对象']
  if (typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(manifest.id)) {
    errors.push(`工具 id 非法: ${String(manifest.id)}`)
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('缺少 name')
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push('缺少 description')
  if (!Array.isArray(manifest.menus) || manifest.menus.length === 0) errors.push('缺少 menus（至少一个功能菜单）')

  const pkg = manifest.package as ToolPackageContract | undefined
  if (!pkg) {
    errors.push('外部导入包必须声明 package 契约（schemaVersion / requiresHost / sandbox / ipcAllowlist）')
    return errors
  }
  if (pkg.schemaVersion !== TOOL_PACKAGE_SCHEMA_VERSION) {
    errors.push(`schemaVersion ${pkg.schemaVersion} 与宿主 ${TOOL_PACKAGE_SCHEMA_VERSION} 不匹配，请升级应用或更换包`)
  }
  if (!pkg.requiresHost || typeof pkg.requiresHost.api !== 'string' || !Array.isArray(pkg.requiresHost.capabilities)) {
    errors.push('package.requiresHost 结构不完整（api / capabilities）')
  }
  if (pkg.sandbox === 'main' && !pkg.signature) {
    errors.push('申请 main 权限必须带签名；未签名包只能以 utility 沙箱安装')
  }
  if (pkg.sandbox !== 'main' && pkg.sandbox !== 'utility') {
    errors.push(`sandbox 只能是 main / utility: ${String(pkg.sandbox)}`)
  }
  if (!Array.isArray(pkg.ipcAllowlist)) {
    errors.push('package.ipcAllowlist 必须是数组')
  } else {
    for (const channel of pkg.ipcAllowlist) {
      if (!CHANNEL_VALUES.has(channel)) errors.push(`未声明的 IPC 通道: ${channel}`)
    }
  }
  if (pkg.signature && pkg.signature.algorithm !== 'ed25519') {
    errors.push(`签名算法仅支持 ed25519: ${String(pkg.signature.algorithm)}`)
  }
  return errors
}
