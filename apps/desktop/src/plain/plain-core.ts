/**
 * IPC / contextBridge 结构化克隆脱壳 · 唯一核心实现（B7/N3 · P0-8 plain 收敛）。
 *
 * 根因：Electron 的 ipcRenderer.invoke 与 contextBridge 都用结构化克隆传参，
 * 而 Vue 的 `ref.value` / `reactive` 是 Proxy，Proxy 无法被克隆，直接抛
 * "An object could not be cloned."。
 *
 * 两处消费语义不同，由 keepFunctions 参数化（此前是两份近乎逐字的实现）：
 * - preload IPC 入参（keepFunctions: false）：函数 / symbol / undefined 字段丢弃；
 * - 渲染层跨 contextBridge 入参（keepFunctions: true）：函数 / symbol 原样保留——
 *   监听注册（onChanged / onDelta）的回调必须原样传递，不能像 IPC 那样丢弃。
 *
 * 内建对象（Date / Map / Set …）本身可被结构化克隆，不拆；循环引用不死循环。
 */
export interface PlainCoreOptions {
  /** true = 保留函数 / symbol 引用（回调注册场景）；false = 丢弃（IPC 纯数据场景） */
  keepFunctions?: boolean
}

export function toPlainCore<T>(value: T, options: PlainCoreOptions = {}): T {
  return plain(value, new WeakMap<object, unknown>(), options.keepFunctions === true) as T
}

/** 内建对象（Date / Map / Set …）本身可被结构化克隆，不要拆成空对象 */
function isPlainLike(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === null || proto === Object.prototype || proto === Array.prototype
}

function plain(value: unknown, seen: WeakMap<object, unknown>, keep: boolean): unknown {
  if (value === null || typeof value !== 'object') {
    if (keep) return value
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value
  }
  if (!isPlainLike(value)) return value

  const cached = seen.get(value as object)
  if (cached !== undefined) return cached

  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(plain(item, seen, keep))
    return out
  }

  const out: Record<string, unknown> = {}
  seen.set(value as object, out)
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!keep && (item === undefined || typeof item === 'function' || typeof item === 'symbol')) continue
    out[key] = plain(item, seen, keep)
  }
  return out
}
