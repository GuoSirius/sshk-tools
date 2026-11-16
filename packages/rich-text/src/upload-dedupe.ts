/**
 * 上传去重指纹。
 *
 * 重复选择的判定维度：目标位置（源|桶|目录）+ 源文件名（带后缀）+ 内容 SHA-256。
 * - 文件名纳入 key：同一份内容复制多份、改成不同名字，视为不同文件，都允许上传；
 * - 内容 hash 纳入 key：同名但内容不同（改过再存）也算不同文件，不会被误当作已传过；
 * - 两者都相同才算重复（同位置、同名、同内容），不重复上传；
 * - 目标位置纳入 key：同一文件传到不同目录/来源属于不同意图，允许各传一份；
 * - Web Crypto 不可用时降级为「位置 + 文件名 + 大小」——装不上 hash 的环境也不至于完全不去重。
 */

export interface UploadFingerprintInput {
  /** 目标位置：sourceId|bucket|目录（与图片库的 scope 一致） */
  scope: string
  name: string
  size: number
  /** 内容 SHA-256 hex；空串表示不可用，触发降级 */
  hash: string
}

/** NUL 分隔符：文件名/目录里几乎不可能出现，避免拼接碰撞 */
const SEP = '\u0000'

/**
 * 构造去重 key = 位置 + 源文件名（带后缀）+ 内容 hash。
 * - 三条都拼进来：同名同内容同位置才算重复；改名或改内容或换位置都不重复。
 * - hash 不可用时降级用 size 顶替 hash 这一维（name 始终参与），仍不阻断上传。
 */
export function fingerprintKey(input: UploadFingerprintInput): string {
  const content = input.hash ? `h${SEP}${input.hash}` : `n${SEP}${input.size}`
  return `${input.scope}${SEP}${input.name}${SEP}${content}`
}

/** 存储名里用的 hash 长度（hex 字符）：8 位 = 32bit，图片库量级碰撞可忽略，文件名也不至于太长 */
const NAME_HASH_LEN = 8

/**
 * 内容寻址存储名：原文件名（去后缀）+ '-' + hash 前 8 位 + 原后缀。
 * 例：`banner.png` → `banner-a1b2c3d4.png`。
 * - 同名不同内容：hash 不同 → 两个文件并存，不再互相覆盖；
 * - 同名同内容：hash 相同 → 落到同一存储名，天然幂等。
 * hash 不可用时退回原名（此时由上传前去重兜底，仍不产生重复请求）。
 */
export function contentName(name: string, hash: string): string {
  if (!hash) return name
  // 点开头的文件（.gitignore / .env / .env.local）靠【完整文件名】被工具识别，
  // 插入 hash（.gitignore-a1b2c3d4）会让识别失效——这类文件保持原名，不改名。
  // 代价：同名不同内容的点文件仍会落在同一存储名上（覆盖），但这类文件本就不是图片上传的目标。
  if (name.startsWith('.')) return name
  const dot = name.lastIndexOf('.')
  // 无后缀时整段当主名，避免生成 -hash. 的空后缀
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${base}-${hash.slice(0, NAME_HASH_LEN)}${ext}`
}

/**
 * 计算文件内容 SHA-256（hex）。
 * 渲染层在安全上下文（dev localhost / 生产 file://）下可用 Web Crypto；
 * 取不到 subtle 或读取失败时返回空串，由 fingerprintKey 降级处理，不阻断上传。
 */
export async function hashFile(
  file: Blob,
  subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null,
): Promise<string> {
  if (!subtle) return ''
  try {
    const buf = await file.arrayBuffer()
    const digest = await subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}
