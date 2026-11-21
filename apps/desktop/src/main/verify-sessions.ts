/**
 * U2 验证引导：会话存储 + 自动判定器（plans/04 §四 U2-2/U2-3）。
 * 会话文件 userData/verify-sessions/<日期>.json，每步可标 pass/fail/skip + 备注，导出 markdown 由渲染层拼装。
 * 自动判定四类中 main 侧负责三类：fileExists / catalogState / logScan（hostCapability 渲染层自判）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { AppError } from '@sshk/shared'
import { dirname, join } from 'node:path'
import type { VerifySession } from '../shared/verify-steps'

/** 会话目录（userData/verify-sessions） */
export function verifySessionsDir(userDataDir: string): string {
  return join(userDataDir, 'verify-sessions')
}

/** 自 startDir 向上找仓库根（pnpm-workspace.yaml 标记），8 层内找不到返回 null */
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * 会话落点（用户 2026-11-17：验证标记/备注要随代码提交同步）：
 * dev（找到仓库根）= <repo>/docs/verify-sessions/<日期>.json —— 进 git，跨设备/多人增量累计；
 * 打包版（无仓库）= userData/verify-sessions/（本机留存，行为同旧）
 */
export function resolveSessionsDir(userDataDir: string, repoRoot: string | null): string {
  return repoRoot ? join(repoRoot, 'docs', 'verify-sessions') : join(userDataDir, 'verify-sessions')
}

/** 校验会话结构（防御 JSON 篡改/损坏） */
export function isValidSession(data: unknown): data is VerifySession {
  if (!data || typeof data !== 'object') return false
  const s = data as Partial<VerifySession>
  return typeof s.date === 'string' && typeof s.updatedAt === 'string' && !!s.results && typeof s.results === 'object'
}

/** 读会话：无 date 参数读最近一份；损坏文件视为不存在 */
export function loadSession(dir: string, date?: string): VerifySession | null {
  const target = date
    ? join(dir, `${date}.json`)
    : latestSessionFile(dir)
  if (!target || !existsSync(target)) return null
  try {
    const data: unknown = JSON.parse(readFileSync(target, 'utf8'))
    return isValidSession(data) ? data : null
  } catch {
    return null
  }
}

function latestSessionFile(dir: string): string | null {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  return files.length > 0 ? join(dir, files[files.length - 1]!) : null
}

/** 历史会话日期列表（升序） */
export function listSessions(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
}

/** 保存会话（按日期落盘，同日覆盖 = 同一工作日的持续进度） */
export function saveSession(dir: string, session: VerifySession): string {
  if (!isValidSession(session)) throw new AppError('会话结构非法，拒绝写入', 'permission')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${session.date}.json`)
  writeFileSync(path, JSON.stringify(session, null, 2))
  return path
}

// ── 自动判定器 ──

export type AutoCheckState = 'pass' | 'fail' | 'unknown'

export interface AutoCheckResult {
  state: AutoCheckState
  detail: string
}

/** 判定器依赖（便于单测注入） */
export interface AutoCheckDeps {
  /** 工具目录裁决结果（catalog：id → enabled/visible） */
  catalog: Record<string, { enabled: boolean; visible: boolean }>
  /** 各工具通道注册数（空对象 = 目录未加载） */
  channelCounts: Record<string, number>
  /** 日志目录中最近 error 行检索（返回脱敏后内容） */
  lastErrors: (toolId: string) => string[]
  /** 打包资源根（packaged 为 resources/，dev 为 null） */
  packagedResourceRoot: string | null
}

/** fileExists 判定：verify-ok（最近 verify 结果）/ edm-assets（打包资源落位） */
function checkFileExists(spec: string, deps: AutoCheckDeps): AutoCheckResult {
  if (spec === 'edm-assets') {
    if (!deps.packagedResourceRoot) return { state: 'unknown', detail: 'dev 环境无法判定，需打包版验证' }
    const path = join(deps.packagedResourceRoot, 'edm-studio', 'assets', 'edm')
    const ok = existsSync(path)
    return { state: ok ? 'pass' : 'fail', detail: ok ? `已找到 ${path}` : `${path} 不存在` }
  }
  if (spec === 'verify-ok') {
    return { state: 'unknown', detail: 'verify 结果以本地 pnpm verify 输出为准（husky 门禁已覆盖）' }
  }
  return { state: 'unknown', detail: `未知的 fileExists 判定：${spec}` }
}

/** catalogState 判定：工具启用/可见/通道注册 */
function checkCatalogState(spec: string, deps: AutoCheckDeps): AutoCheckResult {
  const keys = Object.keys(deps.catalog)
  if (keys.length === 0) return { state: 'unknown', detail: '目录尚未加载' }
  if (spec === 'grants') {
    // C6：目录已加载即视为通过候选（工具隐藏逻辑的 UI 验证仍需人工看列表）
    return { state: 'unknown', detail: `目录已加载 ${keys.length} 个工具，隐藏行为需人工看列表` }
  }
  const tool = deps.catalog[spec]
  if (!tool) return { state: 'fail', detail: `目录中不存在工具 ${spec}` }
  if (!tool.enabled || !tool.visible) {
    return { state: 'fail', detail: `${spec} enabled=${tool.enabled} visible=${tool.visible}` }
  }
  const channels = deps.channelCounts[spec] ?? 0
  return {
    state: channels > 0 ? 'pass' : 'warn' as AutoCheckState,
    detail: `${spec} 已启用可见，注册 ${channels} 条通道`,
  }
}

/** logScan 判定：该工具最近日志无 error 即 pass */
function checkLogScan(spec: string, deps: AutoCheckDeps): AutoCheckResult {
  const errors = deps.lastErrors(spec)
  if (errors.length === 0) return { state: 'pass', detail: `${spec} 最近日志无 error 记录` }
  return { state: 'fail', detail: `${spec} 最近 ${errors.length} 条 error（见日志定位）` }
}

/** 自动判定统一入口（main 侧三类） */
export function runAutoCheck(kind: string, spec: string, deps: AutoCheckDeps): AutoCheckResult {
  if (kind === 'fileExists') return checkFileExists(spec, deps)
  if (kind === 'catalogState') return checkCatalogState(spec, deps)
  if (kind === 'logScan') return checkLogScan(spec, deps)
  return { state: 'unknown', detail: `判定类别 ${kind} 由渲染层处理或未注册` }
}
