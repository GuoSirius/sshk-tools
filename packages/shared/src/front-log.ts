/**
 * H3 前端日志上报唯一口径（CR-25② · P0-7 收敛）：
 * 此前 FrontLogLevel 类型 + logFront 实现在 apps/renderer/front-log.ts 与
 * ui-kit/front-log.ts 各一份（加 IPC 边界内联共 4 处），scope 字段是唯一差异。
 * shared 收敛为工厂：宿主 renderer 传 'renderer'，工具传 'tool'，各自一行薄包装。
 * 红线不变：日志绝不写密钥明文（主进程侧还有一道脱敏）；任何失败都静默。
 */
export type FrontLogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogFrontApi {
  logFront?: (payload: { level: FrontLogLevel; scope: string; msg: string; detail?: unknown }) => void
}

export function createLogFront(scope: 'renderer' | 'tool'): (level: FrontLogLevel, msg: string, detail?: unknown) => void {
  return function logFront(level: FrontLogLevel, msg: string, detail?: unknown): void {
    try {
      const api = (globalThis as unknown as { api?: { logs?: LogFrontApi } }).api
      api?.logs?.logFront?.({ level, scope, msg, detail })
    } catch { /* 日志永不反向影响业务 */ }
  }
}
