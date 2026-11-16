/**
 * X5-A 构建裁剪：内建工具选择 + 依赖闭合（纯函数，构建期消费）。
 *
 * 语义（用户 2026-11-16 拍板）：
 * - 打包时通过 SSHK_BUILTIN_TOOLS=a,b 指定内建工具；未指定的工具不跟随打包
 * - c 被 a 依赖（a.dependsOn 含 c）→ c 自动搭进去（依赖闭包，root 之外拉入的记 pulledIn）
 * - 未设置 / all / * = 全量（默认零行为变化）
 *
 * 消费方：electron.vite.config.ts（define __SSHK_BUILTIN_TOOLS__ + stub 插件，
 * 并把结果写 apps/desktop/.build-selection.json 供 electron-builder.config.cjs
 * 计算 extraResources——单一事实源在构建期落盘，打包配置只读盘不重算）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface BuiltinToolInfo {
  id: string
  dependsOn: string[]
}

export interface BuiltinSelection {
  mode: 'all' | 'list'
  /** mode=list：最终内建清单（root + 依赖闭包，按 tools/ 目录序去重）；mode=all 为 null */
  ids: string[] | null
  excluded: string[]
  /** 非用户显式选择、被依赖闭包拉入的工具 id */
  pulledIn: string[]
}

/** 解析 SSHK_BUILTIN_TOOLS：空 / all / * → 全量；逗号 / 分号 / 空白分隔 → 去重 id 列表 */
export function parseBuiltinSpec(raw: string | undefined): string[] | 'all' {
  const v = (raw ?? '').trim()
  if (!v || v === 'all' || v === '*') return 'all'
  const ids = v.split(/[,;，；\s]+/).map((s) => s.trim()).filter(Boolean)
  return ids.length ? [...new Set(ids)] : 'all'
}

/**
 * 依赖闭包裁决。roots 含未知 id 直接抛错（列可用清单，防拼错静默打成全量）；
 * dependsOn 指向未知工具 / 环也容忍（运行时健康检查本来就按 dep-missing 报）。
 */
export function resolveBuiltinSelection(roots: string[] | 'all', manifests: BuiltinToolInfo[]): BuiltinSelection {
  if (roots === 'all') return { mode: 'all', ids: null, excluded: [], pulledIn: [] }
  const byId = new Map(manifests.map((m) => [m.id, m]))
  const missing = roots.filter((id) => !byId.has(id))
  if (missing.length) {
    throw new Error(
      `SSHK_BUILTIN_TOOLS 含未知工具 id：${missing.join('、')}（可用：${manifests.map((m) => m.id).join('、') || '无'}）`,
    )
  }
  const kept = new Set<string>()
  const pulledIn: string[] = []
  const walk = (id: string, viaRoot: boolean): void => {
    if (kept.has(id)) return
    kept.add(id)
    if (!viaRoot) pulledIn.push(id)
    for (const dep of byId.get(id)?.dependsOn ?? []) walk(dep, false)
  }
  for (const id of roots) walk(id, true)
  const all = manifests.map((m) => m.id)
  return {
    mode: 'list',
    ids: all.filter((id) => kept.has(id)),
    excluded: all.filter((id) => !kept.has(id)),
    pulledIn: all.filter((id) => pulledIn.includes(id)),
  }
}

/** 扫描 tools/<id>/tool.manifest.json 收集 id 与 dependsOn（损坏清单跳过，交由发现逻辑/门禁报错） */
export function collectBuiltinToolInfo(repoRoot: string): BuiltinToolInfo[] {
  const dir = join(repoRoot, 'tools')
  if (!existsSync(dir)) return []
  const out: BuiltinToolInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const mf = join(dir, entry.name, 'tool.manifest.json')
    if (!existsSync(mf)) continue
    try {
      const m = JSON.parse(readFileSync(mf, 'utf8')) as { id?: unknown; dependsOn?: unknown }
      const id = typeof m.id === 'string' && m.id ? m.id : entry.name
      const dependsOn = Array.isArray(m.dependsOn) ? m.dependsOn.filter((d): d is string => typeof d === 'string') : []
      out.push({ id, dependsOn })
    } catch {
      /* 清单损坏：发现逻辑构建期会告警，这里不重复报 */
    }
  }
  return out
}

/** 一步到位：解析环境变量 + 依赖闭合（electron.vite.config / 打包配置共用） */
export function resolveBuiltinSelectionFromEnv(env: string | undefined, manifests: BuiltinToolInfo[]): BuiltinSelection {
  return resolveBuiltinSelection(parseBuiltinSpec(env), manifests)
}
