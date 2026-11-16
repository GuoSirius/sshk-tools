import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { format } from '@sshk/shared'

/**
 * H3 日志落盘（plans/04 地基）：
 * - 分级（debug/info/warn/error）+ 按天滚动文件（北京时间命名，D22）
 * - 渲染层日志经 log:frontend 单向通道汇入（installFrontLog 捕获 + 主动上报）
 * - 脱敏红线：apiKey/secret/password/token/口令 类键值一律 ***；绝不写密钥明文
 * - 保留 7 天，启动时清理过期文件
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const KEEP_DAYS = 7
const MAX_LINE = 8_000
const SENSITIVE_RE =
  /(api[-_]?key|apikey|secret|password|passwd|token|accesskey|口令|密钥|密码)(["']?\s*[:=]\s*)(["']?)[^"',;\s}]{4,}/gi

/** 值脱敏：命中敏感键的值替换为 ***（键名保留，便于定位问题） */
function redact(text: string): string {
  return text.replace(SENSITIVE_RE, (_m, key: string, sep: string, quote: string) => `${key}${sep}${quote}***`)
}

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function todayStamp(): string {
  return format(undefined, 'YYYY-MM-DD')
}

function write(level: LogLevel, scope: string, msg: string, detail?: unknown): void {
  try {
    const dir = logDir()
    mkdirSync(dir, { recursive: true })
    let line = `[${format(undefined, 'HH:mm:ss')}] [${level.toUpperCase().padEnd(5)}] [${scope}] ${redact(String(msg))}`
    if (detail !== undefined && detail !== null) {
      const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
      if (text) line += ` | ${redact(text)}`
    }
    if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE) + ' …(截断)'
    appendFileSync(join(dir, `sshk-${todayStamp()}.log`), line + '\n', 'utf8')
  } catch {
    // 日志写盘失败绝不反向影响业务（磁盘满/权限等），静默
  }
}

export const logger = {
  logDir,
  debug: (scope: string, msg: string, detail?: unknown): void => write('debug', scope, msg, detail),
  info: (scope: string, msg: string, detail?: unknown): void => write('info', scope, msg, detail),
  warn: (scope: string, msg: string, detail?: unknown): void => write('warn', scope, msg, detail),
  error: (scope: string, msg: string, detail?: unknown): void => write('error', scope, msg, detail),

  /** 目录信息（设置页展示） */
  describe(): { dir: string; sizeBytes: number; files: { name: string; sizeBytes: number }[] } {
    const dir = logDir()
    let files: { name: string; sizeBytes: number }[] = []
    try {
      files = readdirSync(dir)
        .filter((name) => /^sshk-\d{4}-\d{2}-\d{2}\.log$/.test(name))
        .map((name) => ({ name, sizeBytes: statSync(join(dir, name)).size }))
        .sort((a, b) => b.name.localeCompare(a.name))
    } catch { /* 目录不存在 */ }
    return { dir, sizeBytes: files.reduce((acc, f) => acc + f.sizeBytes, 0), files }
  },

  /** 清理 7 天前的日志文件（保留今天），返回删除数 */
  clean(): number {
    let removed = 0
    try {
      const cutoff = Date.now() - KEEP_DAYS * 86_400_000
      for (const name of readdirSync(logDir())) {
        if (!/^sshk-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue
        if (name === `sshk-${todayStamp()}.log`) continue
        if (statSync(join(logDir(), name)).mtimeMs < cutoff) {
          unlinkSync(join(logDir(), name))
          removed++
        }
      }
    } catch { /* 忽略 */ }
    return removed
  },
}
