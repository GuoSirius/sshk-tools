import type { App } from 'vue'
import { createLogFront, type FrontLogLevel } from '@sshk/shared'

/**
 * H3 渲染层日志捕获（plans/04 §一）：
 * - Vue errorHandler / window.onerror / unhandledrejection 三处兜底捕获 → 主进程落盘
 * - console.error 镜像转发（保留原终端输出）
 * - logFront 供页面主动上报（实现唯一口径在 shared/createLogFront，CR-25② · P0-7）
 * 红线：日志绝不写密钥明文（主进程侧还有一道脱敏）；本模块任何失败都静默。
 */
export type { FrontLogLevel }
export const logFront = createLogFront('renderer')

function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try { return JSON.stringify(value) } catch { return String(value) }
}

export function installFrontLog(app: App): void {
  app.config.errorHandler = (err, _instance, info) => {
    logFront('error', `Vue 异常：${err instanceof Error ? err.message : String(err)}`, { info, stack: err instanceof Error ? err.stack : undefined })
  }
  window.addEventListener('error', (e) => {
    logFront('error', `未捕获异常：${e.message}`, `${e.filename}:${e.lineno}:${e.colno}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    logFront('error', `未处理的 Promise 拒绝：${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined)
  })
  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    logFront('error', args.map(safeText).join(' '))
    originalError(...args)
  }
}
