import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 目录名常量：产物根下的固定布局（数据契约 §7 / §8） */
export const OUTPUT_DIRS = ['outputs/edm', 'outputs/poster', 'assets/uploads', 'assets/brands', 'assets/templates'] as const

export const STORAGE_MANIFEST = '.storage-manifest.json'

export function resolveOutputRoot(configured: string | null | undefined, fallback: string): string {
  const root = configured && configured.trim() !== '' ? resolve(configured) : resolve(fallback)
  return root
}

/** 首次使用时创建产物目录布局（先检测后创建；幂等） */
export function ensureOutputDirs(root: string): void {
  for (const rel of OUTPUT_DIRS) {
    mkdirSync(join(root, ...rel.split('/')), { recursive: true })
  }
}

/** 相对路径转绝对路径；拒绝路径穿越（任何 `..` 段 / 绝对路径 / 盘符） */
export function resolveSafe(root: string, rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`禁止绝对路径进入产物系统: ${rel}`)
  }
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new Error(`产物路径越界: ${rel}`)
  }
  const abs = resolve(root, normalized)
  const check = relative(resolve(root), abs)
  if (check === '' || check.startsWith('..') || isAbsolute(check)) {
    throw new Error(`产物路径越界: ${rel}`)
  }
  return abs
}

/** 绝对路径转包内相对路径（正斜杠，跨平台一致） */
export function toRelPath(root: string, abs: string): string {
  return relative(resolve(root), resolve(abs)).replaceAll(sep, '/')
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export interface OutputStat {
  rel: string
  size: number
  sha256: string
}

/** 产物文件清单（迁移 / 备份用，数据契约 §8） */
export function listOutputFiles(root: string, subdirs: readonly string[] = OUTPUT_DIRS): OutputStat[] {
  const out: OutputStat[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else {
        out.push({ rel: toRelPath(root, full), size: statSync(full).size, sha256: sha256File(full) })
      }
    }
  }
  for (const rel of subdirs) walk(join(root, ...rel.split('/')))
  return out
}

/**
 * 覆盖式写产物（需求 17 / D19）：固定路径、直接覆盖、不留历史副本。
 * 自动创建父目录（先检测后创建）；只允许产物布局内的相对路径。
 */
export function writeOutput(root: string, rel: string, content: string | Uint8Array): string {
  const abs = resolveSafe(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return toRelPath(root, abs)
}

export function readOutput(root: string, rel: string): string {
  return readFileSync(resolveSafe(root, rel), 'utf8')
}

/** 邮件产物固定路径（覆盖式，无时间戳） */
export function edmOutputRel(mailId: string, stage: 'assembled' | 'inlined' | 'final'): string {
  return `outputs/edm/${mailId}/${stage}.html`
}

/** 海报产物固定路径 */
export function posterOutputRel(posterId: string, kind: 'badged' | 'poster'): string {
  return `outputs/poster/${posterId}/${kind === 'badged' ? 'badged.html' : 'poster.png'}`
}
