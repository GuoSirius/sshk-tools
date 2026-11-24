import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as yaml from 'js-yaml'
import { AppError } from '@sshk/shared'

/**
 * 系统内容示例数据覆盖层（2026-11-24 台账 #189）：
 * 打包版系统内容「设计只读」（meta/njk/css 写入仍被 assertSystemEditable 拒绝），但示例数据
 * （sample.yaml）的表单/数据编辑放开——改动落 userData 覆盖层而非安装目录 resources/（普通用户
 * 无写权限，且升级 / 重装即被覆盖丢失）。读取与渲染一律「覆盖层优先，缺省回落系统根」；
 * 删除覆盖文件即恢复系统默认。
 * 覆盖层只允许出现 sample.yaml（isSampleFile 白名单），其余系统文件照旧只读，设计不被绕过。
 */

/** 是否示例数据文件（覆盖层唯一放行目标；POSIX 分隔，兼容反斜杠入参） */
export function isSampleFile(file: string): boolean {
  const norm = file.replace(/[\\/]+/g, '/')
  return norm === 'sample.yaml' || norm.endsWith('/sample.yaml')
}

/** 覆盖层内绝对路径；越权（逃出覆盖根）返回 null */
function overlayAbs(overlayRoot: string, file: string): string | null {
  const rootAbs = path.resolve(overlayRoot)
  const abs = path.resolve(rootAbs, file)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
  return abs
}

/** 读覆盖层 sample.yaml 原文；无覆盖返回 null */
export async function readSampleOverride(overlayRoot: string, file: string): Promise<string | null> {
  if (!isSampleFile(file)) return null
  const abs = overlayAbs(overlayRoot, file)
  if (!abs) return null
  try {
    return await fs.readFile(abs, 'utf8')
  } catch {
    return null
  }
}

/** 覆盖层 sample.yaml 解析为对象；无覆盖 / 解析失败返回 null（渲染回落系统根 sample.yaml） */
export async function readSampleOverrideYaml(overlayRoot: string, file: string): Promise<Record<string, unknown> | null> {
  const text = await readSampleOverride(overlayRoot, file)
  if (text === null) return null
  try {
    return (yaml.load(text) as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

/** 写覆盖层 sample.yaml（tmp + rename 原子写，总纲 §5.7）；非 sample.yaml / 越权路径直接拒绝 */
export async function writeSampleOverride(overlayRoot: string, file: string, content: string): Promise<void> {
  if (!isSampleFile(file)) throw new AppError(`覆盖层只允许 sample.yaml：${file}`, 'io')
  const abs = overlayAbs(overlayRoot, file)
  if (!abs) throw new AppError('越权覆盖路径', 'permission')
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, abs)
  } catch (err) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* 清理失败忽略 */
    }
    throw err
  }
}

/** 是否存在覆盖 */
export async function hasSampleOverride(overlayRoot: string, file: string): Promise<boolean> {
  if (!isSampleFile(file)) return false
  const abs = overlayAbs(overlayRoot, file)
  if (!abs) return false
  try {
    return (await fs.stat(abs)).isFile()
  } catch {
    return false
  }
}

/** 删除覆盖（恢复系统默认）；返回是否真删了。顺带自底向上清理沿途空目录（非空即停） */
export async function resetSampleOverride(overlayRoot: string, file: string): Promise<boolean> {
  if (!isSampleFile(file)) return false
  const abs = overlayAbs(overlayRoot, file)
  if (!abs) return false
  try {
    await fs.unlink(abs)
  } catch {
    return false
  }
  const rootAbs = path.resolve(overlayRoot)
  let dir = path.dirname(abs)
  while (dir.startsWith(rootAbs + path.sep)) {
    try {
      await fs.rmdir(dir) // 非空抛 ENOTEMPTY → 停止清理
    } catch {
      break
    }
    dir = path.dirname(dir)
  }
  return true
}
