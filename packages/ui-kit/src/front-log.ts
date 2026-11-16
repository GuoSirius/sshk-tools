/**
 * H3 工具侧日志上报：主动 logFront(level, msg, detail) → 主进程脱敏落盘。
 * 捕获类（Vue 异常/console.error）由宿主 renderer 的 installFrontLog 统一接管，
 * 工具渲染层与宿主同窗口运行，无需自行安装。
 * 红线：任何调用失败静默；绝不传密钥明文。
 */
export type FrontLogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogFrontApi {
  logFront?: (payload: { level: FrontLogLevel; scope: string; msg: string; detail?: unknown }) => void
}

export function logFront(level: FrontLogLevel, msg: string, detail?: unknown): void {
  try {
    const api = (globalThis as unknown as { api?: { logs?: LogFrontApi } }).api
    api?.logs?.logFront?.({ level, scope: 'tool', msg, detail })
  } catch { /* 日志永不反向影响业务 */ }
}
