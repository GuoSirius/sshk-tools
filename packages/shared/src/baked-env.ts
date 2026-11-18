/**
 * 构建期烤入环境变量 + 运行时覆盖白名单（用户 2026-11-18 拍板）。
 *
 * 语义分两层：
 *  1. 烤入默认值：electron.vite.config.ts 构建期把 .env 中声明的 SSHK_ 前缀键
 *     （签名私钥等构建专用键除外）注入 __SSHK_BAKED_ENV__ 字面量。打包版没有 .env，
 *     这些键仍能读到构建时的值——相当于 webpack 把 env 替换成字面量的效果。
 *  2. 覆盖白名单：默认所有烤入键【不允许】被本机环境变量覆盖（.env 即最终值）；
 *     仅 .env 中声明的 SSHK_APP_OVERRIDABLE（逗号分隔键名，白名单自身也锁死）列出的键，
 *     才允许用户本机同名环境变量覆盖——作为预留的定制入口，可设可不设。
 *
 * 未被烤入的键（.env 未声明）走运行时 process.env 读取，行为不变。
 */

declare const __SSHK_BAKED_ENV__: Record<string, string> | undefined

const BAKED: Record<string, string> =
  typeof __SSHK_BAKED_ENV__ !== 'undefined' ? (__SSHK_BAKED_ENV__ ?? {}) : {}

/** 覆盖白名单懒解析（经 getEnv 读取：烤入值优先；白名单自身永远锁死，不可被本机 env 覆盖） */
let overridable: Set<string> | null = null
function overridableKeys(): Set<string> {
  if (!overridable) {
    overridable = new Set(
      String(getEnv('SSHK_APP_OVERRIDABLE') ?? '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }
  return overridable
}

/**
 * 统一环境变量取值入口：
 *  - 烤入且不在白名单 → 直接返回烤入值（本机 env 无法覆盖）
 *  - 烤入且在白名单   → 本机 env 优先，回落烤入值
 *  - 未烤入           → 运行时 process.env（本机可设可不设）
 */
export function getEnv(key: string): string | undefined {
  const baked = BAKED[key]
  // SSHK_APP_OVERRIDABLE 自身永远锁死（否则本机可自行给自己授权覆盖）
  const canOverride = key !== 'SSHK_APP_OVERRIDABLE' && overridableKeys().has(key)
  if (baked !== undefined && !canOverride) return baked
  if (typeof process !== 'undefined' && process.env) {
    const live = process.env[key]
    if (live !== undefined && live !== '') return live
  }
  return baked
}
