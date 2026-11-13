/**
 * 渲染层 IPC 入参脱壳（与 preload/plain.ts 算法对应，但语义不同）：
 * Vue 的 ref/reactive 是 Proxy，跨 contextBridge 传参时就会被 V8 序列化拒绝
 * （An object could not be cloned）——发生在进入 preload 的 isolated world 之前，
 * 所以 preload 内的 toPlain 救不了；必须在调用 window.api 之前脱壳。
 *
 * 与 preload 版的差异：函数 / symbol 原样保留——监听注册（onChanged / onDelta）
 * 的回调参数必须原样跨 contextBridge 传递，不能像 IPC 那样丢弃。
 */
export function toPlainArg<T>(value: T): T {
  return plain(value, new WeakMap<object, unknown>()) as T
}

function plain(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (!isPlainLike(value)) return value
  const cached = seen.get(value)
  if (cached !== undefined) return cached
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(plain(item, seen))
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) out[key] = plain(item, seen)
  return out
}

function isPlainLike(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype || proto === Array.prototype
}
