import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { now, type ToolCatalogPayload, type ToolHealthPayload, type ToolHealthRow } from '@sshk/shared'
import { logger } from './logger'

/**
 * N2 工具健康度面板（plans/04 §三）：
 * 复用 buildCatalog 的裁决结果（可见性/插件/依赖/告警）+ 主进程插件状态 + 日志 error 检索，
 * 聚合出每工具一行健康摘要。纯展示数据，无任何敏感信息；各段独立容错。
 */

const LOG_SCAN_FILES = 2
const ERROR_LINE_RE = /^\[(\d{2}:\d{2}:\d{2})\] \[ERROR\] \[([^\]]+)\] (.*)$/

/** 在日志行内找与工具相关的最近 error（工具 id 出现在 scope 或消息中）；纯函数便于单测 */
export function lastToolError(lines: string[], toolId: string): { time: string; text: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || !line.includes(toolId)) continue
    const m = ERROR_LINE_RE.exec(line)
    if (!m) continue
    return { time: m[1] ?? '', text: (m[3] ?? '').slice(0, 300) }
  }
  return null
}

/** 读取最近 N 天的日志行（文件名升序拼接，越新越靠后，便于「从后往前找最近」） */
function recentLogLines(maxFiles: number): string[] {
  try {
    const dir = logger.logDir()
    const names = readdirSync(dir).filter((n) => /^sshk-\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort().slice(-maxFiles)
    return names.flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n'))
  } catch {
    return []
  }
}

function safeLogDir(): string {
  try {
    return logger.logDir()
  } catch {
    return ''
  }
}

/** 供 U2 自动判定（logScan）复用：某工具最近日志的 error 行文本（已脱敏；无则空数组） */
export function toolRecentErrors(toolId: string): string[] {
  const hit = lastToolError(recentLogLines(LOG_SCAN_FILES), toolId)
  return hit ? [hit.text] : []
}

/** 清单最小投影：只取主进程插件通道数 */
interface ManifestLite {
  id: string
  plugin?: { channels?: string[] }
}

/** 主入口：聚合健康数据（目录裁决 + 插件状态 + 日志检索），绝不 throw 过 IPC 边界（H1/N11） */
export function collectToolHealth(
  catalog: ToolCatalogPayload,
  manifests: readonly ManifestLite[],
): ToolHealthPayload {
  const lines = recentLogLines(LOG_SCAN_FILES)
  const channels = new Map(manifests.map((m) => [m.id, m.plugin?.channels?.length ?? 0]))
  const tools: ToolHealthRow[] = catalog.tools.map((tool) => {
    const plugin = catalog.pluginStatus[tool.id]
    const pluginText = !plugin
      ? (tool.pluginError ? `失败：${tool.pluginError}` : '无主进程插件')
      : (plugin.loaded ? '已加载' : `失败：${plugin.error ?? '未知原因'}`)
    const missingDeps = tool.dependsOn.filter((depId) => {
      const dep = catalog.tools.find((t) => t.id === depId)
      return !dep || !dep.visible
    })
    let state: ToolHealthRow['state'] = 'ok'
    if (!tool.enabled) state = 'disabled'
    else if (plugin ? !plugin.loaded : Boolean(tool.pluginError)) state = 'plugin-failed'
    else if (missingDeps.length > 0) state = 'dep-missing'
    else if (tool.warnings.length > 0) state = 'warn'
    return {
      id: tool.id,
      name: tool.name,
      enabled: tool.enabled,
      visible: tool.visible,
      state,
      plugin: pluginText,
      channels: channels.get(tool.id) ?? 0,
      missingDeps,
      warnings: [...tool.warnings],
      lastError: lastToolError(lines, tool.id),
    }
  })
  const ok = tools.filter((t) => t.state === 'ok').length
  return { generatedAt: now(), logDir: safeLogDir(), ok, abnormal: tools.length - ok, tools }
}
