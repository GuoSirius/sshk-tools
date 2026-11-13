import { toPlainArg } from './plain'

/**
 * 渲染层入口组装 window.api：
 * preload 暴露到 window.sshkApiBridge（exposeInMainWorld 的属性只读、不可覆盖，
 * 直接改写 window.api 会抛 "Cannot assign to read only property"），
 * 这里逐方法套 toPlainArg 后组装成 window.api —— Vue Proxy 在跨 contextBridge
 * 之前就被脱掉，彻底根治 "An object could not be cloned"。
 * 必须在 main.ts 挂载前调用（之后所有组件拿到的都是脱壳后的 api）。
 */
export function installPlainApi(): void {
  const source: unknown = (globalThis as unknown as { sshkApiBridge?: unknown }).sshkApiBridge
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
