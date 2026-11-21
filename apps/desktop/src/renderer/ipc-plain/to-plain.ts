/**
 * 渲染层 IPC 入参脱壳（P0-8 · N3：renderer ipc-plain/ 收敛）。
 * 与 preload toPlain 的语义差异由 plain-core 的 keepFunctions 参数化承载：
 * 函数 / symbol 原样保留——监听注册（onChanged / onDelta）的回调参数必须
 * 原样跨 contextBridge 传递，不能像 IPC 那样丢弃。
 */
import { toPlainCore } from '../../plain/plain-core'

export function toPlainArg<T>(value: T): T {
  return toPlainCore(value, { keepFunctions: true })
}
