/**
 * IPC 结构化克隆边界（宿主能力，工具无需各自 toRaw）。
 *
 * 根因：Electron 的 ipcRenderer.invoke 用结构化克隆传参，而 Vue 的
 * `ref.value` / `reactive` 是 Proxy，Proxy 无法被克隆，直接抛
 * "An object could not be cloned."。典型现场：Model Console 保存 Provider
 * 时把 `providers.value` 交给 config:set；Badge 的 statRows / recentHtmls、
 * EDM 的表单 data 同理。
 *
 * 处理：在 preload 唯一出口统一脱壳成纯值，渲染层与所有工具（含后期外部
 * 工具包）都不必关心；函数 / symbol / undefined 字段跳过，循环引用不会死循环。
 */
export function toPlain<T>(value: T): T {
  return plain(value, new WeakMap<object, unknown>()) as T
}

/** 内建对象（Date / Map / Set …）本身可被结构化克隆，不要拆成空对象 */
function isPlainLike(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === null || proto === Object.prototype || proto === Array.prototype
}

function plain(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value
  }
  if (!isPlainLike(value)) return value

  const cached = seen.get(value as object)
  if (cached !== undefined) return cached

  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(plain(item, seen))
    return out
  }

  const out: Record<string, unknown> = {}
  seen.set(value as object, out)
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
    out[key] = plain(item, seen)
  }
  return out
}
