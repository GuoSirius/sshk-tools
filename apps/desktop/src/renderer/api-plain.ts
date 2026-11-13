import { toPlainArg } from './plain'

/**
 * 在渲染层入口给 window.api 套一层脱壳包装：
 * 所有方法入参先 toPlainArg（脱掉 Vue Proxy），再透传给 contextBridge 暴露的真 api。
 * 不替换监听注册的方法签名；window.api 的类型保持不变。
 */
export function installPlainApi(): void {
  const source = (globalThis as unknown as { api?: unknown }).api
  if (!source || typeof source !== 'object') return
  const wrapped: Record<string, unknown> = {}
  for (const [namespace, group] of Object.entries(source as Record<string, unknown>)) {
    if (!group || typeof group !== 'object') {
      wrapped[namespace] = group
      continue
    }
    const methods: Record<string, unknown> = {}
    for (const [name, fn] of Object.entries(group as Record<string, unknown>)) {
      methods[name] = typeof fn === 'function'
        ? (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args.map(toPlainArg))
        : fn
    }
    wrapped[namespace] = methods
  }
  ;(globalThis as unknown as { api: unknown }).api = wrapped
}
