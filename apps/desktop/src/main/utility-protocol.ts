/**
 * utilityProcess 沙箱消息协议（#50 阶段三切片 1）：
 * parent（主进程宿主）↔ child（utilityProcess，加载外部包 main）。
 * 纯类型与守卫，供双方与单测共用。
 */

export interface UtilityInit {
  t: 'init'
  toolId: string
}
export interface UtilityRegister {
  t: 'register'
  channel: string
}
export interface UtilityIpcInvoke {
  t: 'ipc-invoke'
  reqId: number
  channel: string
  args: unknown[]
}
export interface UtilityIpcResult {
  t: 'ipc-result'
  reqId: number
  ok: boolean
  data?: unknown
  error?: string
}
export interface UtilityHostInvoke {
  t: 'host-invoke'
  reqId: number
  method: string
  args: unknown[]
}
export interface UtilityHostResult {
  t: 'host-result'
  reqId: number
  ok: boolean
  data?: unknown
  error?: string
}
export interface UtilityReady {
  t: 'ready'
}
export type UtilityMessage =
  | UtilityInit
  | UtilityRegister
  | UtilityIpcInvoke
  | UtilityIpcResult
  | UtilityHostInvoke
  | UtilityHostResult
  | UtilityReady

/** 已知消息类型白名单：未知类型一律拒绝 */
const UTILITY_TYPES = new Set(['init', 'register', 'ipc-invoke', 'ipc-result', 'host-invoke', 'host-result', 'ready'])

/** 宽松守卫：子进程消息不可信，字段逐个校验 */
export function asUtilityMessage(raw: unknown): UtilityMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m['t'] !== 'string' || !UTILITY_TYPES.has(m['t'])) return null
  return raw as UtilityMessage
}

/** 初始化参数约定：utilityProcess.fork 的 argv 末两位 = 包目录、外部 main 文件 */
export function parseChildArgv(argv: string[]): { packageDir: string; mainFile: string; toolId: string } {
  const rest = argv.slice(-3)
  return { toolId: rest[0] ?? '', packageDir: rest[1] ?? '', mainFile: rest[2] ?? '' }
}

/** 外部 main 契约与内置插件一致：default / register 导出注册函数 */
export function pickRegister(mod: Record<string, unknown>): unknown {
  return mod['default'] ?? mod['register']
}
